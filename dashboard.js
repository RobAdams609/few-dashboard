// Rotate Rule of the Day
const rules = [
  "1. Do not be entitled. Earn everything. Choose hard work over handouts… always.",
  "2. To get, give. Give without remembering; receive without forgetting.",
  "3. Bring The Few Energy. Exude grit, gratitude, and go in every moment.",
  "4. Get comfortable being uncomfortable. Lean into discomfort & grow.",
  "5. If you risk nothing, you risk everything. Regret is terrifying.",
  "6. Luck favors hard workers. You make your own luck.",
  "7. Your goal is growth to the grave. Breathe & keep growing.",
  "8. Plan your day. If you have no plan, expect no progress.",
  "9. Choose effort over your excuses and emotions.",
  "10. Restore the dignity of hard work.",
  "Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];
const startDate = new Date("2025-01-01");
const today     = new Date();
const daysSince = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
document.getElementById("rule-of-day").textContent = rules[daysSince % rules.length];

// Fetch and render metrics
async function fetchMetrics() {
  try {
    const res  = await fetch("/.netlify/functions/metrics");
    const data = await res.json();
    document.getElementById("sales-count").textContent = data.totalSales;
    document.getElementById("av-count").textContent    = `$${data.totalAV}`;
    updateTicker([
      { text: `Last Deal: ${data.totalSales} sold, AV $${data.totalAV}` }
    ]);
  } catch {
    updateTicker([{ text: "⚠️ Metrics unavailable" }]);
  }
}
fetchMetrics();
setInterval(fetchMetrics, 15000);

//