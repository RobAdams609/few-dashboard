
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

const agentStats = [
  { name: "Ajani", av: 2800, calls: 60, talkTime: 2400, sales: 8 },
  { name: "Rob", av: 2400, calls: 45, talkTime: 1800, sales: 6 },
  { name: "Phil", av: 1200, calls: 30, talkTime: 900, sales: 3 }
];

const ticker = document.getElementById("sales-ticker");
const rule = document.getElementById("rule-of-day");

function updateRule() {
  const hour = new Date().getHours();
  const ruleIndex = Math.floor(hour / 3) % rules.length;
  rule.textContent = rules[ruleIndex];
}

function updateMetrics(metric) {
  const container = document.getElementById(metric);
  container.innerHTML = "";
  const sorted = [...agentStats].sort((a, b) => b[metric] - a[metric]);

  sorted.forEach((agent, i) => {
    const div = document.createElement("div");
    div.className = "agent-stats";
    div.innerHTML = `<strong>#${i + 1} ${agent.name}</strong> – ${agent[metric]}`;
    container.appendChild(div);
  });
}

function updateTicker() {
  const entries = agentStats.map(agent => `${agent.name} closed $${agent.av.toLocaleString()}`);
  ticker.textContent = entries.join(" • ");
}

function rotateMetrics() {
  const metrics = ["sales", "av", "calls", "talkTime"];
  let current = 0;
  metrics.forEach(metric => document.getElementById(metric).style.display = "none");

  setInterval(() => {
    metrics.forEach(metric => document.getElementById(metric).style.display = "none");
    updateMetrics(metrics[current]);
    document.getElementById(metrics[current]).style.display = "block";
    current = (current + 1) % metrics.length;
  }, 30000);
}

updateRule();
updateMetrics("sales");
updateTicker();
rotateMetrics();
