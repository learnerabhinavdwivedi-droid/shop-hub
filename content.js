// Shop Hub Universal Content Script
// Detects products and prices across any shopping site using Metadata & Selectors

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 1000);
}

function init() {
    // Basic heuristics to check if we are on a product page
    if (isProductPage()) {
        injectTrackButton();
    }
}

function isProductPage() {
    // Check for "Add to Cart", "Buy Now", or price presence
    const commonKeywords = ["add to cart", "buy now", "add to bag", "buy it now", "buy"];
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a.button'));
    const hasBuyButton = buttons.some(btn =>
        commonKeywords.some(kw => (btn.innerText || btn.value || "").toLowerCase().includes(kw))
    );

    // Check for product metadata
    const hasProductMeta = !!(
        document.querySelector('meta[property="og:type"][content="product"]') ||
        document.querySelector('script[type="application/ld+json"]') ||
        document.querySelector('[itemtype*="Product"]')
    );

    return hasBuyButton || hasProductMeta;
}

function getProductData() {
    let title = "Product Name Not Found";
    let price = null;
    let store = window.location.hostname.replace('www.', '').split('.')[0];
    store = store.charAt(0).toUpperCase() + store.slice(1);

    // 1. Try Metadata (Most Reliable for Universality)
    const metaTitle = document.querySelector('meta[property="og:title"]') ||
        document.querySelector('meta[name="twitter:title"]');
    if (metaTitle) title = metaTitle.content;

    const metaPrice = document.querySelector('meta[property="product:price:amount"]') ||
        document.querySelector('meta[property="og:price:amount"]') ||
        document.querySelector('meta[name="twitter:data1"]'); // Often used for price
    if (metaPrice) {
        const p = parseFloat(metaPrice.content.replace(/[^0-9.]/g, ''));
        if (!isNaN(p)) price = p;
    }

    // 2. Try JSON-LD (Schema.org)
    if (!price || title === "Product Name Not Found") {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let script of scripts) {
            try {
                const data = JSON.parse(script.textContent);
                const items = Array.isArray(data) ? data : [data];
                for (let item of items) {
                    if (item['@type'] === 'Product' || item['@type']?.includes('Product')) {
                        if (title === "Product Name Not Found" && item.name) title = item.name;
                        if (!price && item.offers) {
                            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                            if (offer.price) price = parseFloat(offer.price.toString().replace(/[^0-9.]/g, ''));
                        }
                    }
                }
            } catch (e) { }
        }
    }

    // 3. Fallback to common selectors (Site Specific)
    if (!price || title === "Product Name Not Found") {
        const selectors = {
            Amazon: { title: "#productTitle", price: ".a-price-whole" },
            Ebay: { title: ".x-item-title__mainTitle", price: ".x-price-primary" },
            Walmart: { title: "h1", price: "[data-automation-id='product-price']" },
            Flipkart: { title: ".B_NuCI", price: "._30jeq3" }
        };

        const rules = selectors[store] || { title: "h1", price: ".price, [class*='price']" };

        if (title === "Product Name Not Found") {
            const el = document.querySelector(rules.title);
            if (el) title = el.innerText.trim();
        }

        if (!price) {
            const el = document.querySelector(rules.price);
            if (el) {
                const p = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
                if (!isNaN(p)) price = p;
            }
        }
    }

    return { productName: title, price, store, url: window.location.href };
}

function injectTrackButton() {
    if (document.getElementById("shophub-track-btn")) return;

    const btn = document.createElement("button");
    btn.id = "shophub-track-btn";
    btn.innerText = "🚀 Track with Shop Hub";
    btn.style.cssText = `
        background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
        color: white;
        border: none;
        padding: 14px 24px;
        font-size: 16px;
        font-weight: 700;
        border-radius: 12px;
        cursor: pointer;
        width: 100%;
        margin: 15px 0;
        box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.3);
        transition: all 0.3s ease;
        z-index: 999999;
        display: block;
    `;

    btn.onclick = () => {
        const data = getProductData();
        if (!data.price) {
            alert("Shop Hub: Could not detect the price on this page. Try scrolling or refreshing.");
            return;
        }

        btn.disabled = true;
        btn.innerText = "⏳ Adding to Tracker...";

        checkLimitAndScrape(data, (success, msg) => {
            if (success === "tracked") {
                btn.innerText = "✅ Successfully Tracked!";
                btn.style.background = "#10b981";
                btn.style.boxShadow = "0 10px 15px -3px rgba(16, 185, 129, 0.3)";
            } else {
                btn.innerText = "❌ Error";
                btn.style.background = "#ef4444";
                alert(msg || "Failed to track product.");
                btn.disabled = false;
                btn.innerText = "🚀 Track with Shop Hub";
            }
        });
    };

    // Find best injection point
    const injectionPoint =
        document.querySelector("#desktop_buybox") ||
        document.querySelector("#buybox_feature_div") ||
        document.querySelector(".buy-box") ||
        document.querySelector("[class*='buybox']") ||
        document.querySelector("[data-automation-id='atc-and-buy-now-container']") ||
        document.querySelector("h1")?.parentElement;

    if (injectionPoint) {
        if (injectionPoint.tagName === "H1") {
            injectionPoint.after(btn);
        } else {
            injectionPoint.prepend(btn);
        }
    }
}

function checkLimitAndScrape(data, callback) {
    chrome.storage.local.get(['searchCount', 'startDate'], function (result) {
        let searchCount = result.searchCount || 0;
        let startDate = result.startDate || Date.now();

        if (Date.now() - startDate >= (30 * 24 * 60 * 60 * 1000)) {
            searchCount = 0;
            startDate = Date.now();
        }

        if (searchCount < 10) {
            searchCount++;
            chrome.storage.local.set({ searchCount, startDate }, function () {
                sendToBackend(data, (ok, msg) => {
                    if (ok) callback("tracked");
                    else callback(false, msg);
                });
            });
        } else {
            callback(false, "Free tier limit reached (10 products/month).");
        }
    });
}

function sendToBackend(data, callback) {
    fetch('https://shop-hub-backend-h0kv.onrender.com/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
        .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
        .then(res => callback(true))
        .catch(err => {
            console.error("Shop Hub Backend Error:", err);
            callback(false, "Backend connection failed. Is the server running at localhost:5000?");
        });
}

