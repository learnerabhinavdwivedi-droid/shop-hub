require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Product = require('./models/Product');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection & Mock Setup
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/shophub';
let isUsingMock = false;
const mockDb = [
    {
        productName: "apple iphone 16 pro max, 256gb, desert titanium",
        store: "amazon",
        url: "http://localhost:5000/preview",
        priceHistory: [
            { price: 1299.00, date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            { price: 1250.00, date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
            { price: 1220.00, date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) }
        ]
    }
];

mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error. Switching to IN-MEMORY MOCK.');
        isUsingMock = true;
    });

// --- Static Routes ---

// Serve Dashboard (Root)
app.get(['/', '/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Serve Preview Demo
app.get('/preview', (req, res) => {
    res.sendFile(path.join(__dirname, '../preview_demo.html'));
});

// --- API Routes ---

/**
 * @route   GET /api/analysis/all
 * @desc    Get all analyzed products for the Dashboard
 */
app.get('/api/analysis/all', async (req, res) => {
    try {
        let products = isUsingMock ? [...mockDb] : await Product.find({});

        const analyzed = products.map(product => {
            const total = product.priceHistory.reduce((sum, record) => sum + record.price, 0);
            const averagePrice = total / product.priceHistory.length;
            const latestPrice = product.priceHistory[product.priceHistory.length - 1].price;
            const isGoodDeal = latestPrice <= (averagePrice * 0.9);
            const suggestion = isGoodDeal ? "Buy" : "Wait";

            return {
                productName: product.productName,
                store: product.store || 'universal',
                currentPrice: latestPrice,
                historicalAverage: averagePrice.toFixed(2),
                suggestion
            };
        });
        res.json(analyzed);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// Helper to extract store name from URL
function getStoreFromUrl(url) {
    try {
        const domain = new URL(url).hostname.replace('www.', '');
        const parts = domain.split('.');
        return parts.length > 1 ? parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1) : 'Store';
    } catch (e) {
        return 'Online Store';
    }
}

/**
 * @route   POST /api/prices/analyze-url
 * @desc    Simulate scraping from ANY URL and track it
 */
app.post('/api/prices/analyze-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const storeName = getStoreFromUrl(url);
        const products_pool = [
            "Premium Wireless Headphones", "E-Reader Paperwhite Edition",
            "Flagship Smartphone Ultra", "Ergonomic Productivity Mouse",
            "Mechanical Gaming Keyboard", "4K Ultra HDR Monitor"
        ];

        const randomTitle = products_pool[Math.floor(Math.random() * products_pool.length)];
        const randomPrice = (Math.random() * (500 - 50) + 50).toFixed(2);
        const histPrice = (parseFloat(randomPrice) * (1.1 + Math.random() * 0.3)).toFixed(2);

        const normalizedName = randomTitle.toLowerCase().trim();

        if (isUsingMock) {
            let product = mockDb.find(p => p.productName === normalizedName && p.store === storeName.toLowerCase());
            if (!product) {
                product = {
                    productName: normalizedName,
                    store: storeName.toLowerCase(),
                    url: url,
                    priceHistory: [
                        { price: parseFloat(histPrice), date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                        { price: parseFloat(randomPrice), date: new Date() }
                    ]
                };
                mockDb.push(product);
            }
            return res.json({ message: `Tracked on ${storeName} (Simulated)`, product });
        }
        return res.status(501).json({ error: 'Real URL scraping requires backend service.' });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

/**
 * @route   POST /api/prices
 * @desc    Receive price data from Extension
 */
app.post('/api/prices', async (req, res) => {
    try {
        const { productName, price, store, url } = req.body;
        if (!productName || !price) return res.status(400).json({ error: 'Missing data' });
        const normalizedName = productName.toLowerCase().trim();

        if (isUsingMock) {
            let product = mockDb.find(p => p.productName === normalizedName);
            if (product) product.priceHistory.push({ price: parseFloat(price), date: new Date() });
            else {
                product = { productName: normalizedName, store, url, priceHistory: [{ price: parseFloat(price), date: new Date() }] };
                mockDb.push(product);
            }
            return res.json({ message: 'Mock Tracked', product });
        }

        let product = await Product.findOne({ productName: normalizedName });
        if (product) {
            product.priceHistory.push({ price: parseFloat(price), date: new Date() });
            await product.save();
        } else {
            product = new Product({ productName: normalizedName, store, url, priceHistory: [{ price: parseFloat(price), date: new Date() }] });
            await product.save();
        }
        res.json({ message: 'Product updated', product });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

/**
 * @route   GET /api/analysis/:productName
 * @desc    Get analysis for a specific product
 */
app.get('/api/analysis/:productName', async (req, res) => {
    try {
        const productName = req.params.productName.toLowerCase().trim();
        let product = isUsingMock ? mockDb.find(p => p.productName === productName) : await Product.findOne({ productName });

        if (!product || product.priceHistory.length === 0) return res.status(404).json({ error: 'No history' });

        const total = product.priceHistory.reduce((sum, r) => sum + r.price, 0);
        const avg = total / product.priceHistory.length;
        const latest = product.priceHistory[product.priceHistory.length - 1].price;
        const suggestion = latest <= (avg * 0.9) ? "Buy" : "Wait";

        res.json({ productName: product.productName, currentPrice: latest, historicalAverage: avg.toFixed(2), suggestion });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
