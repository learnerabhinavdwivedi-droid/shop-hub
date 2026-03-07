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

// Category-aware product images — matched by keywords in product name
const CATEGORY_IMAGES = {
    phone: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=400&auto=format&fit=crop',
    iphone: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?q=80&w=400&auto=format&fit=crop',
    samsung: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?q=80&w=400&auto=format&fit=crop',
    laptop: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?q=80&w=400&auto=format&fit=crop',
    macbook: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?q=80&w=400&auto=format&fit=crop',
    computer: 'https://images.unsplash.com/photo-1593642702821-c8da6771f0c6?q=80&w=400&auto=format&fit=crop',
    tablet: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?q=80&w=400&auto=format&fit=crop',
    ipad: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?q=80&w=400&auto=format&fit=crop',
    headphone: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=400&auto=format&fit=crop',
    earphone: 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?q=80&w=400&auto=format&fit=crop',
    earbuds: 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?q=80&w=400&auto=format&fit=crop',
    airpods: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?q=80&w=400&auto=format&fit=crop',
    watch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=400&auto=format&fit=crop',
    smartwatch: 'https://images.unsplash.com/photo-1546868871-af0de0ae72be?q=80&w=400&auto=format&fit=crop',
    shoe: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=400&auto=format&fit=crop',
    sneaker: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?q=80&w=400&auto=format&fit=crop',
    boot: 'https://images.unsplash.com/photo-1608256246200-53e635b5b65f?q=80&w=400&auto=format&fit=crop',
    camera: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=400&auto=format&fit=crop',
    tv: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?q=80&w=400&auto=format&fit=crop',
    television: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?q=80&w=400&auto=format&fit=crop',
    monitor: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?q=80&w=400&auto=format&fit=crop',
    keyboard: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?q=80&w=400&auto=format&fit=crop',
    mouse: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?q=80&w=400&auto=format&fit=crop',
    speaker: 'https://images.unsplash.com/photo-1545454675-3531b543be5d?q=80&w=400&auto=format&fit=crop',
    bag: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=400&auto=format&fit=crop',
    backpack: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=400&auto=format&fit=crop',
    shirt: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=400&auto=format&fit=crop',
    jacket: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=400&auto=format&fit=crop',
    dress: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=400&auto=format&fit=crop',
    perfume: 'https://images.unsplash.com/photo-1541643600914-78b084683601?q=80&w=400&auto=format&fit=crop',
    fragrance: 'https://images.unsplash.com/photo-1541643600914-78b084683601?q=80&w=400&auto=format&fit=crop',
    book: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?q=80&w=400&auto=format&fit=crop',
    gaming: 'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?q=80&w=400&auto=format&fit=crop',
    console: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?q=80&w=400&auto=format&fit=crop',
    playstation: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?q=80&w=400&auto=format&fit=crop',
    xbox: 'https://images.unsplash.com/photo-1621259182978-fbf93132d53d?q=80&w=400&auto=format&fit=crop',
    refrigerator: 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?q=80&w=400&auto=format&fit=crop',
    fridge: 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?q=80&w=400&auto=format&fit=crop',
    washing: 'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?q=80&w=400&auto=format&fit=crop',
    furniture: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?q=80&w=400&auto=format&fit=crop',
    chair: 'https://images.unsplash.com/photo-1592078615290-033ee584e267?q=80&w=400&auto=format&fit=crop',
    desk: 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?q=80&w=400&auto=format&fit=crop',
    sunglasses: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?q=80&w=400&auto=format&fit=crop',
    glasses: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?q=80&w=400&auto=format&fit=crop',
    toy: 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?q=80&w=400&auto=format&fit=crop',
    beauty: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?q=80&w=400&auto=format&fit=crop',
    makeup: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?q=80&w=400&auto=format&fit=crop',
    skincare: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?q=80&w=400&auto=format&fit=crop',
    default: 'https://images.unsplash.com/photo-1560343090-f0409e92791a?q=80&w=400&auto=format&fit=crop'
};

// Pick a category-relevant image based on product name keywords
function getCategoryImage(productName) {
    if (!productName) return CATEGORY_IMAGES.default;
    const lower = productName.toLowerCase();
    for (const [keyword, imageUrl] of Object.entries(CATEGORY_IMAGES)) {
        if (keyword !== 'default' && lower.includes(keyword)) {
            return imageUrl;
        }
    }
    return CATEGORY_IMAGES.default;
}

// Generate 12 months of realistic price history
function generateYearlyPriceHistory(basePrice) {
    const history = [];
    for (let i = 11; i >= 0; i--) {
        const variance = 0.85 + Math.random() * 0.3; // ±15% fluctuation
        const price = parseFloat((basePrice * variance).toFixed(2));
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        date.setDate(1 + Math.floor(Math.random() * 20));
        history.push({ price, date });
    }
    // Ensure the last entry is the current price at today's date
    history[history.length - 1].date = new Date();
    return history;
}

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
        imageUrl: "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?q=80&w=600&auto=format&fit=crop",
        priceHistory: generateYearlyPriceHistory(125000)
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
                imageUrl: product.imageUrl || getCategoryImage(product.productName),
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
        const productImage = pageMeta.image || getCategoryImage(productTitle);

        const randomPrice = (Math.random() * (50000 - 5000) + 5000).toFixed(2);

        const normalizedName = productTitle.toLowerCase().trim();
        const priceHistory = generateYearlyPriceHistory(parseFloat(randomPrice));

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
            imageUrl: product.imageUrl || getCategoryImage(product.productName),
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
