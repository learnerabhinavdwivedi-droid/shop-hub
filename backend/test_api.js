// Node.js 18+ has built-in fetch
async function testBackend() {
    const testData = {
        productName: "Test Product " + Date.now(),
        price: 99.99,
        store: "Amazon",
        url: "https://www.amazon.com/dp/B0000000"
    };

    try {
        console.log("Testing POST /api/prices...");
        const postRes = await fetch('http://localhost:5000/api/prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });
        const postJson = await postRes.json();
        console.log("POST Result:", postJson);

        console.log("\nTesting GET /api/analysis...");
        const getRes = await fetch(`http://localhost:5000/api/analysis/${encodeURIComponent(testData.productName)}`);
        const getJson = await getRes.json();
        console.log("GET Result:", getJson);
    } catch (err) {
        console.error("Test Failed:", err.message);
    }
}

testBackend();
