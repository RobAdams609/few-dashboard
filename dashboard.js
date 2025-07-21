const rules = [
    "1. Outwork everyone. Grind now, shine later.",
    "2. Discipline over motivation. Show up daily.",
    "3. Average is overcrowded. Be uncommon.",
    "4. Get comfortable being uncomfortable. Lean into discomfort & grow.",
    "5. You’re owed nothing. Earn everything.",
    "6. Attack the day or the day attacks you.",
    "7. No zero days. One step forward, always.",
    "8. Sacrifice leisure for legacy.",
    "9. Hunt results. Track, reflect, improve.",
    "10. Confidence comes from earned competence.",
    "11. Be the standard. Don’t follow one."
];

let currentView = 0;
const views = ['sales', 'calls', 'talkTime', 'av'];

function getRandomRule() {
    const rule = rules[Math.floor(Math.random() * rules.length)];
    document.getElementById("rule-of-day").textContent = rule;
}

function renderView(view, data) {
    const container = document.getElementById("metrics-view");
    container.innerHTML = "";

    if (view === 'sales') {
        container.innerHTML = `Sales Today: ${data.sales}<br>AV Today: $${data.av}`;
    } else if (view === 'calls') {
        container.innerHTML = `Calls Today: ${data.calls}`;
    } else if (view === 'talkTime') {
        container.innerHTML = `Talk Time: ${data.talkTime} mins`;
    }
}

function updateTicker(sales) {
    const ticker = document.getElementById("ticker");
    ticker.textContent = sales.map(s => `🔥 ${s.agent} sold $${s.amount * 12} 🔥`).join(" | ");
}

async function fetchMetrics() {
    const res = await fetch("/.netlify/functions/metrics");
    const data = await res.json();
    renderView(views[currentView], data.metrics);
    updateTicker(data.sales);
}

setInterval(() => {
    currentView = (currentView + 1) % views.length;
    fetchMetrics();
}, 30000);

getRandomRule();
fetchMetrics();
setInterval(fetchMetrics, 60000);