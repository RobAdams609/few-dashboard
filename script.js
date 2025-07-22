
const rules = [
    "1. Do not be entitled. Earn everything. Choose hard work over handouts… always.",
    "2. To get, give. Give without remembering, receive without forgetting.",
    "3. Bring The Few Energy. Exude grit, gratitude, and go every day.",
    "4. Get comfortable being uncomfortable. Learn, grow, and lead.",
    "5. If you risk nothing, you risk everything. Risk results in reward.",
    "6. Luck favors hard workers. Stay receptive, ready, and resilient.",
    "7. Your goal is growth to the grave. Live in the moment and grow.",
    "8. Plan your day. No plan? No progress.",
    "9. Choose effort over excuses and emotions.",
    "10. Restore the dignity of hard work. Be the example.",
    "Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

const agents = [
    { name: "Ajani", av: 2800, calls: 60, talk: 2400, sales: 8 },
    { name: "Rob", av: 2400, calls: 45, talk: 1800, sales: 6 },
    { name: "Phil", av: 1200, calls: 30, talk: 900, sales: 3 }
];

function updateRuleOfDay() {
    const index = Math.floor((new Date().getHours() % 24) / 3);
    document.getElementById("rule-of-day").textContent = rules[index];
}

function updateMetricsView() {
    const container = document.getElementById("metrics-view");
    const totalSales = agents.reduce((sum, a) => sum + a.sales, 0);
    const totalAV = agents.reduce((sum, a) => sum + a.av, 0);
    container.innerHTML = `<div><button>Sales: ${totalSales}</button> <button>AV: $${totalAV}</button></div><br>`;
    agents.forEach(agent => {
        container.innerHTML += `<div><b>${agent.name}:</b> $${agent.av} AV • ${agent.calls} Calls • ${agent.talk} min Talk • ${agent.sales} Sales</div>`;
    });
}

function updateSalesTicker() {
    const ticker = document.getElementById("sales-ticker");
    ticker.textContent = agents.map(a => `${a.name} closed $${a.av}`).join(" • ");
}

updateRuleOfDay();
updateMetricsView();
updateSalesTicker();
