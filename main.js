const agentStats = [
  { name: "Ajani", av: 2800, calls: 60, talkTime: 2400, sales: 8 },
  { name: "Rob", av: 2400, calls: 45, talkTime: 1800, sales: 6 },
  { name: "Phil", av: 1200, calls: 30, talkTime: 900, sales: 3 }
];

const rules = [
  "1. Do not be entitled. Earn everything.",
  "2. Give without remembering. Receive without forgetting.",
  "3. Bring The Few Energy. Go every day.",
  "4. Get comfortable being uncomfortable.",
  "5. Risk = reward.",
  "6. Luck favors hard workers.",
  "7. Growth to the grave. Live in the moment.",
  "8. No plan? No progress.",
  "9. Choose effort over excuses.",
  "10. Dignity of hard work. Be the example.",
  "Bonus: Everybody wants to eat, but FEW will hunt."
];

function render() {
  const sortedStats = agentStats.sort((a, b) => b.av - a.av);
  const metricsView = document.getElementById("metrics-view");
  const salesCount = sortedStats.reduce((sum, a) => sum + a.sales, 0);
  const totalAV = sortedStats.reduce((sum, a) => sum + a.av, 0);
  document.getElementById("sales-count").textContent = `Sales: ${salesCount}`;
  document.getElementById("total-av").textContent = `AV: $${totalAV}`;

  metricsView.innerHTML = sortedStats.map(a =>
    `<p><strong>${a.name}:</strong> $${a.av} AV • ${a.calls} Calls • ${a.talkTime} min Talk • ${a.sales} Sales</p>`
  ).join("");

  document.getElementById("ticker").textContent =
    sortedStats.map(a => `${a.name} closed $${a.av}`).join(" • ");

  const ruleIndex = Math.floor(Date.now() / 1000 / 60 / 60) % rules.length;
  document.getElementById("rule-of-day").textContent = rules[ruleIndex];
}

render();