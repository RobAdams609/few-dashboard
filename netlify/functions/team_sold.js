// TEAM_SOLD.js — Live Ringy integration for team sales (no placeholders)

export const handler = async (event) => {
  const RINGY_URL = "https://app.ringy.com/api/public/external/get-lead-sold-products";

  // === Agents with real Ringy API keys ===
const AGENTS = [
  { name: "Robert Adams",        key: "RGY2ifvl3xa4k6306xw5fpza2ithhmwc" },
  { name: "Ajani Senior",        key: "RGYlb2wvt0qssa5h5ylcnnqocq07yazk" },
  { name: "Fabricio Navarrete",  key: "RGYsjvbsawketfhk4eysqqbyw0o7uaq3" },
  { name: "Nathan Johnson",      key: "RGYk6m0twda2bsk5sowr6jlt5kyjl5f6" },
  { name: "Sebastian Beltran",   key: "RGY90l97aoh41zv4run7u8foeklcldpt" },
  { name: "Marie Saint Cyr",     key: "RGYx2j7rg5xumzvsexs479bbkmlcv5o0" },
  { name: "Philip Baxter",       key: "RGYajwevlinoiuwxkvbv15gtynz04weh" },
  { name: "Eli Thermilus",       key: "RGYkhe6figc1eosyyddbxr43wk6juhxv" }, // ✅ added
];

  const pad = n => String(n).padStart(2, "0");
  const utcStr = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  // Default to current week: Friday 12:00AM → next Thursday 11:59PM
  const now = new Date();
  const day = now.getUTCDay();
  const diffToFriday = (day + 2) % 7; // Friday start
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToFriday, 0, 0, 0));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const startDate = utcStr(start);
  const endDate = utcStr(end);

  async function fetchSold(agent){
    try{
      const body = { apiKey: agent.key, startDate, endDate, limit: 5000 };
      const res = await fetch(RINGY_URL, { method: "POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!Array.isArray(data)) return { agent: agent.name, rows: [] };
      return { agent: agent.name, rows: data };
    }catch(e){
      return { agent: agent.name, rows: [], error: e.message };
    }
  }

  const results = await Promise.all(AGENTS.map(fetchSold));
  const allSales = results.flatMap(r => r.rows.map(x => ({ ...x, agent: r.agent })));

  const byAgent = {};
  for (const sale of allSales){
    if (!byAgent[sale.agent]) byAgent[sale.agent] = { count: 0, amount: 0 };
    byAgent[sale.agent].count++;
    byAgent[sale.agent].amount += Number(sale.amount || 0);
  }

  const perAgent = Object.entries(byAgent).map(([name, stats]) => ({
    name,
    sales: stats.count,
    amount: stats.amount,
    av12x: stats.amount * 12
  })).sort((a,b)=>b.amount - a.amount);

  const team = {
    totalSales: allSales.length,
    totalAmount: allSales.reduce((a,b)=>a+Number(b.amount||0),0),
    totalAV12x: allSales.reduce((a,b)=>a+Number(b.amount||0)*12,0)
  };

  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ startDate, endDate, team, perAgent, allSales }, null, 2)
  };
};
