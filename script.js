let rules = [
  "1. Do not be entitled. Earn everything.",
  "2. To get, give.",
  "3. Bring The Few Energy.",
  "4. Get comfortable being uncomfortable.",
  "5. Risk = reward.",
  "6. Luck favors hard workers.",
  "7. Growth to the grave.",
  "8. Plan your day.",
  "9. Choose effort.",
  "10. Dignity of hard work.",
  "Bonus: Few will hunt."
];

function getTimedRule() {
  const now = new Date();
  const hourBlock = Math.floor(now.getHours() / 3);
  document.getElementById("rule-of-day").textContent = rules[hourBlock % rules.length];
}

function fetchMetrics() {
  fetch("/.netlify/functions/dashboard")
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById("metrics-view");
      container.innerHTML = "";
      data.agentStats.forEach(agent => {
        container.innerHTML += `<p><strong>${agent.name}:</strong> $${agent.av} AV • ${agent.calls} Calls • ${agent.talkTime} min Talk • ${agent.sales} Sales</p>`;
      });
      document.getElementById("ticker").textContent = data.salesTicker;
    });
}

getTimedRule();
fetchMetrics();
setInterval(fetchMetrics, 60000);