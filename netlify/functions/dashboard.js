const axios = require("axios");

const HEADSHOT_MAP = {
  "Ajani": "Ajani",
  "Anna": "Anna",
  "Eli": "Eli",
  "F C": "Fabricio",
  "Fraitzline": "Fraitzline",
  "Joseph": "Joseph",
  "Marie": "Marie Saint Cyr",
  "Baxter": "Philip Baxter",
  "Robert Adams": "Robert Adams",
  "Michelle Landis": "Michelle Landis"
};

const SALES_API = "https://app.ringy.com/api/public/external/get-lead-sold-products";
const CALL_API = "https://app.ringy.com/api/public/external/get-recordings";
const SALES_KEY = "RGYiqo808w4kv7of0t7rxgn45g8xl11n";
const CALL_KEY = "RGY60brwg9qq24bfrqfj0x11rbnlpap";

const START_DATE = new Date();
START_DATE.setDate(START_DATE.getDate() - 6);
const END_DATE = new Date();
const format = d => d.toISOString().split("T")[0];

exports.handler = async function () {
  try {
    const [salesRes, callsRes] = await Promise.all([
      axios.post(SALES_API, {
        apiKey: SALES_KEY,
        startDate: format(START_DATE),
        endDate: format(END_DATE)
      }),
      axios.post(CALL_API, {
        apiKey: CALL_KEY,
        startDate: format(START_DATE),
        endDate: format(END_DATE)
      })
    ]);

    const sales = salesRes.data || [];
    const calls = callsRes.data || [];

    const stats = {};
    const ticker = [];

    // Aggregate sales
    for (const s of sales) {
      const name = s.agent_name;
      const av = parseFloat(s.lead_av) || 0;
      if (!stats[name]) stats[name] = { av: 0, calls: 0, talkTime: 0, sales: 0 };
      stats[name].av += av;
      stats[name].sales += 1;
      ticker.push(`${name} closed $${av.toFixed(0)}`);
    }

    // Aggregate calls
    for (const c of calls) {
      const name = c.user_name;
      const talkTime = parseInt(c.duration) || 0;
      if (!stats[name]) stats[name] = { av: 0, calls: 0, talkTime: 0, sales: 0 };
      stats[name].calls += 1;
      stats[name].talkTime += talkTime;
    }

    const agentStats = Object.entries(stats).map(([name, d]) => ({
      name,
      ...d,
      headshot: HEADSHOT_MAP[name] || null
    }));

    // Sort agents for ticker and ranking
    const sortedAV = [...agentStats].sort((a, b) => b.av - a.av);
    const sortedCalls = [...agentStats].sort((a, b) => b.calls - a.calls);
    const sortedTalk = [...agentStats].sort((a, b) => b.talkTime - a.talkTime);
    const sortedSales = [...agentStats].sort((a, b) => b.sales - a.sales);

    return {
      statusCode: 200,
      body: JSON.stringify({
        agentStats,
        salesTicker: ticker.join(" • "),
        topAV: sortedAV.slice(0, 3),
        topCalls: sortedCalls.slice(0, 3),
        topTalk: sortedTalk.slice(0, 3),
        topSales: sortedSales.slice(0, 3),
        principleOfTheDay: getRotatingPrinciple()
      })
    };
  } catch (err) {
    console.error("API fetch failed", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to load dashboard data" })
    };
  }
};

function getRotatingPrinciple() {
  const principles = [
    "1. Everyone wants to eat, but FEW will hunt.",
    "2. Show up early, stay late.",
    "3. Never let comfort cost you opportunity.",
    "4. Get comfortable being uncomfortable.",
    "5. The work is the shortcut.",
    "6. Lead from the front.",
    "7. You can't cheat the grind.",
    "8. Make your presence known.",
    "9. No zero days.",
    "10. Dignity of hard work. Be the example.",
    "Bonus: Everybody wants to eat, but FEW will hunt."
  ];
  const index = Math.floor((Date.now() / (1000 * 60 * 60 * 3)) % principles.length);
  return principles[index];
}
