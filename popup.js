document.addEventListener('DOMContentLoaded', async () => {
    updateUI();

    document.getElementById('open-dashboard').onclick = () => {
        chrome.tabs.create({ url: 'http://localhost:5000' });
    };
});

function fetchAnalysis(productTitle) {
    const analysisCard = document.getElementById('analysis-card');
    const avgPriceElem = document.getElementById('avg-price');
    const currPriceElem = document.getElementById('curr-price');
    const suggestionElem = document.getElementById('suggestion');

    fetch(`http://localhost:5000/api/analysis/${encodeURIComponent(productTitle)}`)
        .then(response => {
            if (!response.ok) throw new Error('Not found');
            return response.json();
        })
        .then(data => {
            analysisCard.style.display = 'block';
            avgPriceElem.textContent = `$${data.historicalAverage}`;
            currPriceElem.textContent = `$${data.currentPrice}`;
            suggestionElem.textContent = data.suggestion;
            suggestionElem.className = `suggestion-text ${data.suggestion.toLowerCase()}`;
        })
        .catch(err => {
            analysisCard.style.display = 'none';
        });
}

function updateUI() {
    chrome.storage.local.get(['searchCount'], (result) => {
        const count = result.searchCount || 0;
        const limit = 10;
        const percentage = (count / limit) * 100;

        const usageBar = document.getElementById('usage-bar');
        const usageText = document.getElementById('usage-text');

        if (usageBar) usageBar.style.width = `${Math.min(percentage, 100)}%`;
        if (usageText) usageText.textContent = `${count}/10 Products`;
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab.url && (tab.url.includes("amazon.com") || tab.url.includes("amazon.in"))) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => document.querySelector("#productTitle")?.textContent.trim()
            }, (results) => {
                const title = results[0]?.result;
                if (title) fetchAnalysis(title);
            });
        }
    });
}
