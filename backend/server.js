require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Product = require('./models/Product');
const path = require('path');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

// Helper: Fetch OG metadata (title + image) from a URL
async function fetchPageMeta(url) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ title: null, image: null }), 6000);
        try {
            const mod = url.startsWith('https') ? https : http;
            mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    clearTimeout(timeout);
                    return fetchPageMeta(res.headers.location).then(resolve);
                }
                let html = '';
                res.on('data', chunk => { html += chunk; if (html.length > 300000) res.destroy(); });
                res.on('end', () => {
                    clearTimeout(timeout);
                    try {
                        const $ = cheerio.load(html);
                        const title = $('meta[property="og:title"]').attr('content')
                            || $('meta[name="twitter:title"]').attr('content')
                            || $('title').text()
                            || null;
                        const image = $('meta[property="og:image"]').attr('content')
                            || $('meta[name="twitter:image"]').attr('content')
                            || null;
                        resolve({ title: title ? title.trim() : null, image });
                    } catch (e) { resolve({ title: null, image: null }); }
                });
                res.on('error', () => { clearTimeout(timeout); resolve({ title: null, image: null }); });
            }).on('error', () => { clearTimeout(timeout); resolve({ title: null, image: null }); });
        } catch (e) { clearTimeout(timeout); resolve({ title: null, image: null }); }
    });
}

// Helper: Extract product name from URL path (fallback when OG tags blocked)
function extractTitleFromUrl(url) {
    try {
        const pathname = new URL(url).pathname;
        const segments = pathname.split('/').filter(s => s.length > 5);
        if (segments.length === 0) return null;
        const best = segments.reduce((a, b) => {
            const aScore = (a.match(/-/g) || []).length;
            const bScore = (b.match(/-/g) || []).length;
            return bScore > aScore ? b : a;
        });
        let cleaned = best.replace(/[-_]/g, ' ').replace(/\b[a-f0-9]{10,}\b/gi, '').trim();
        if (cleaned.length < 5) return null;
        return cleaned.split(' ').filter(w => w.length > 0).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    } catch (e) { return null; }
}

// Helper: Check if a title is a junk/captcha page
function isJunkTitle(title) {
    if (!title) return true;
    const lower = title.toLowerCase();
    const junkWords = ['captcha', 'recaptcha', 'robot', 'verify', 'access denied', 'blocked', 'please wait', 'error', 'not found', '404', '403'];
    return junkWords.some(w => lower.includes(w)) || title.length < 4;
}

// Curated fallback images that always work
const FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=400&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=400&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?q=80&w=400&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1491553895911-0055eca6402d?q=80&w=400&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1572635196237-14b3f281503f?q=80&w=400&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560343090-f0409e92791a?q=80&w=400&auto=format&fit=crop'
];

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
        imageUrl: "https://images.unsplash.com/photo-1727192629344-97217596a5ca?q=80&w=600&auto=format&fit=crop",
        priceHistory: [
            { price: 129000.00, date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            { price: 125000.00, date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
            { price: 119999.00, date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) }
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

// Serve Deep Analysis Page
app.get('/analysis', (req, res) => {
    res.sendFile(path.join(__dirname, 'analysis.html'));
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
                url: product.url || '#',
                currentPrice: latestPrice,
                historicalAverage: averagePrice.toFixed(2),
                imageUrl: product.imageUrl || 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80&w=300',
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

        // Extract real product data from the URL
        const pageMeta = await fetchPageMeta(url);

        // Smart title: OG title (if not junk) > URL path extraction > generic fallback
        const urlTitle = extractTitleFromUrl(url);
        const ogTitle = (!isJunkTitle(pageMeta.title)) ? pageMeta.title : null;
        const productTitle = ogTitle || urlTitle || `Product from ${storeName}`;
        const productImage = pageMeta.image || FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];

        const randomPrice = (Math.random() * (50000 - 5000) + 5000).toFixed(2);
        const histPrice = (parseFloat(randomPrice) * (1.1 + Math.random() * 0.3)).toFixed(2);

        const normalizedName = productTitle.toLowerCase().trim();
        const priceHistory = [
            { price: parseFloat(histPrice), date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            { price: parseFloat(randomPrice), date: new Date() }
        ];

        if (isUsingMock) {
            let product = mockDb.find(p => p.productName === normalizedName && p.store === storeName.toLowerCase());
            if (!product) {
                product = {
                    productName: normalizedName,
                    store: storeName.toLowerCase(),
                    url: url,
                    imageUrl: productImage,
                    priceHistory: priceHistory
                };
                mockDb.push(product);
            }
            return res.json({ message: `Tracked on ${storeName} (Simulated)`, product });
        }

        // Live Mode (MongoDB)
        let product = await Product.findOne({ productName: normalizedName, store: storeName.toLowerCase() });
        if (!product) {
            product = new Product({
                productName: normalizedName,
                store: storeName.toLowerCase(),
                url: url,
                imageUrl: productImage,
                priceHistory: priceHistory
            });
            await product.save();
        }
        return res.json({ message: `Tracked on ${storeName} (Simulated)`, product });
    } catch (err) {
        console.error("Analysis error:", err);
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

        res.json({
            productName: product.productName,
            currentPrice: latest,
            historicalAverage: avg.toFixed(2),
            suggestion,
            url: product.url || '#',
            imageUrl: product.imageUrl || 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80&w=300',
            priceHistory: product.priceHistory
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

/**
 * @route   DELETE /api/products/clear
 * @desc    Clear all tracked products (for cleaning old data)
 */
app.delete('/api/products/clear', async (req, res) => {
    try {
        if (isUsingMock) {
            mockDb.length = 0;
            return res.json({ message: 'Mock database cleared' });
        }
        await Product.deleteMany({});
        res.json({ message: 'All products cleared from database' });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
