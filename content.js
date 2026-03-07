// Wait for the DOM to be fully prepared before running the scrape logic
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // If DOM is already loaded (e.g., dynamically rendered single-page apps), run immediately
    // For Amazon, we might need a slight delay to ensure dynamic pricing elements load
    setTimeout(init, 1000);
}

function init() {
    // ----------------------------------------------------
    // 1. The "Receptionist" Logic
    // ----------------------------------------------------
    if (!window.location.hostname.includes("amazon")) {
        return;
    }

    // Only add the button on product pages
    if (document.querySelector("#add-to-cart-button") || document.querySelector("#buy-now-button")) {
        injectTrackButton();
    }
}

function injectTrackButton() {
    // Check if button already exists
    if (document.getElementById("shophub-track-btn")) return;

    const btn = document.createElement("button");
    btn.id = "shophub-track-btn";
    btn.innerText = "🚀 Track with Shop Hub";
    btn.style.cssText = `
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        color: white;
        border: none;
        padding: 12px 20px;
        font-size: 16px;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        width: 100%;
        margin-top: 10px;
        margin-bottom: 10px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        transition: transform 0.2s, box-shadow 0.2s;
    `;

    btn.onmouseover = () => {
        btn.style.transform = "translateY(-1px)";
        btn.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1)";
    };
    btn.onmouseout = () => {
        btn.style.transform = "translateY(0)";
        btn.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1)";
    };

    btn.onclick = () => {
        btn.disabled = true;
        btn.innerText = "⏳ Checking Limit...";
        checkLimitAndScrape((success, msg) => {
            if (success === true && !msg) {
                // Tracking in progress or finished
            } else if (success === "tracked") {
                btn.innerText = "✅ Tracked Successfully!";
                btn.style.background = "#10b981";
            } else {
                btn.innerText = "❌ Error";
                btn.style.background = "#ef4444";
                alert(msg || "Failed to track product.");
                btn.disabled = false;
                btn.innerText = "🚀 Track with Shop Hub";
            }
        });
    };

    // Find the buy box or injection point
    const buyBox = document.querySelector("#desktop_buybox") ||
        document.querySelector("#buybox_feature_div") ||
        document.querySelector("#container");

    if (buyBox) {
        buyBox.prepend(btn);
    }
}

function checkLimitAndScrape(callback) {
    chrome.storage.local.get(['searchCount', 'startDate'], function (result) {
        let searchCount = result.searchCount || 0;
        let startDate = result.startDate || Date.now();

        const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        if (now - startDate >= THIRTY_DAYS_IN_MS) {
            searchCount = 0;
            startDate = now;
        }

        if (searchCount < 10) {
            searchCount++;
            chrome.storage.local.set({
                searchCount: searchCount,
                startDate: startDate
            }, function () {
                performAmazonScrape((scrapSuccess, scrapMsg) => {
                    if (scrapSuccess) {
                        callback("tracked");
                    } else {
                        callback(false, scrapMsg);
                    }
                });
            });
        } else {
            callback(false, "Limit reached: Upgrade to Pro.");
        }
    });
}

function performAmazonScrape(callback) {
    const titleElement = document.querySelector("#productTitle");
    let cleanedTitle = titleElement ? titleElement.textContent.trim() : "Title not found";

    const priceWholeElement = document.querySelector(".a-price-whole");
    const priceFractionElement = document.querySelector(".a-price-fraction");

    let cleanedPrice = null;

    if (priceWholeElement && priceFractionElement) {
        let rawPriceString = priceWholeElement.textContent + priceFractionElement.textContent;
        rawPriceString = rawPriceString.replace(/[^0-9.]/g, '');
        cleanedPrice = parseFloat(rawPriceString);
    }

    if (!cleanedPrice) {
        console.error("Shop Hub: Could not find price.");
        if (callback) callback(false, "Could not extract price.");
        return;
    }

    const data = {
        productName: cleanedTitle,
        price: cleanedPrice,
        store: "Amazon",
        url: window.location.href
    };

    console.log("--- Shop Hub: Sending to Backend ---", data);

    fetch('http://localhost:5000/api/prices', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
        .then(response => {
            if (!response.ok) throw new Error('API request failed');
            return response.json();
        })
        .then(result => {
            console.log("--- Shop Hub: Success ---", result);
            if (callback) callback(true);
        })
        .catch(error => {
            console.error("--- Shop Hub: Error ---", error);
            if (callback) callback(false, "Backend connection failed. Is the server running?");
        });
}
