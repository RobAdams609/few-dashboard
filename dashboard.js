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

let currentView = 0;
const views = ['sales', 'av', 'calls', 'talkTime'];

function getTimedRule() {
  const now = new Date();
  const hourBlock = Math.floor(now.getHours() / 3);
  const index = hourBlock % rules.length;
  document.getElementById("rule-of-day").textContent = rules[index];
}

function renderLeaderboard(metric, agentStats) {
  const container = document.getElementById("metrics-view");
  container.innerHTML = "";

  const sorted = Object.entries(agentStats).sort((a, b) => b[1][metric] - a[1][metric]);

  sorted.forEach(([agent, stats], index) => {
    const div = document.createElement("div");
    let label = "";

    if (index === 0) label = "🥇 ";
    else if (index === 1) label = "🥈 ";
    else if (index === 2) label = "🥉 ";
    else if (index >= sorted.length - 3) label = "💩 ";

    div.innerHTML = `${label}${agent} – ${metric === 'av' ? '$' + stats[metric] : stats[metric]}`;
    if (index < 3) div.style.color = 'lightgreen';
    container.appendChild(div);
  });
}

function updateTicker(agentStats) {
  const ticker = document.getElementById("ticker");
  ticker.style.fontSize = "1.4em";
  const sorted = Object.entries(agentStats).sort((a, b) => b[1].av - a[1].av);
  ticker.textContent = sorted.map(([agent, stats]) => `🔥 ${agent} – $${stats.av} 🔥`).join(" | ");
}

async function fetchMetrics() {
  const res = await fetch("/.netlify/functions/metrics");
  const data = await res.json();

  renderLeaderboard(views[currentView], data.agentStats);
  updateTicker(data.agentStats);
}

setInterval(() => {
  currentView = (currentView + 1) % views.length;
  fetchMetrics();
}, 30000);

getTimedRule();
fetchMetrics();
setInterval(fetchMetrics, 60000);
