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

function getDailyRule() {
  const today = new Date();
  const index = today.getDate() % rules.length;
  const rule = rules[index];
  document.getElementById("rule-of-day").textContent = rule;
}

function renderLeaderboard(metric, agentStats) {
  const container = document.getElementById("metrics-view");
  container.innerHTML = "";

  const sorted = Object.entrie
