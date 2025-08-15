
// Sales aggregation: sold products → owner via get-lead → AV ×12
const { cors, memo, fridayWindowET_Now, fmtUtcSQL } = require("./_lib.js");

const SOLD_URL = "https://app.ringy.com/api/public/external/get-lead-sold-products";
const LEAD_URL = process.env.RINGY_LEAD_LOOKUP_URL || "https://app.ringy.com/api/public/external/get-lead";

async function postJson(url, body) {
  const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function resolveOwner(leadId, apiKey) {
  if (!leadId || !apiKey) return null;
  try {
    const L = await postJson(LEAD_URL, { apiKey, leadId });
    return L?.ownerName || L?.assignedTo || L?.user_name || L?.userName || L?.agent || L?.agentName || null;
  } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200 };
  const gate = cors(event); if (!gate.ok) return gate;

  try {
    const range = fridayWindowET_Now();
    const startDate = fmtUtcSQL(range.startUtc);
    const endDate   = fmtUtcSQL(range.endUtc);

    const cacheKey = `sold:${startDate}:${endDate}:${Math.floor(Date.now()/10000)}`;
    const payload = await memo(cacheKey, 10_000, async () => {
      const soldKey = process.env.RINGY_API_KEY_SOLD;
      if (!soldKey) throw new Error("Missing RINGY_API_KEY_SOLD");

      const rows = await postJson(SOLD_URL, { apiKey: soldKey, startDate, endDate, limit: 5000 });
      const data = Array.isArray(rows) ? rows : (rows?.data || []);

      // Resolve owners with per-id lookups (safe concurrency)
      const leadKey = process.env.RINGY_API_KEY_LEADS;
      const leadIds = Array.from(new Set(data.map(x => x.leadId).filter(Boolean)));
      const owners = {};
      const CONC = 8; let i = 0;
      async function worker() {
        while (i < leadIds.length) {
          const id = leadIds[i++];
          owners[id] = await resolveOwner(id, leadKey) || "Unknown";
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC, leadIds.length) }, worker));

      const byAgent = {};
      for (const s of data) {
        const agent = s.leadId ? (owners[s.leadId] || "Unknown") : (s.user_name || "Unknown");
        const monthly = Number(s.amount || 0); // 'amount' treated as monthly
        const av = monthly * 12;
        if (!byAgent[agent]) byAgent[agent] = { agent, salesCount: 0, monthly: 0, av: 0 };
        byAgent[agent].salesCount += 1;
        byAgent[agent].monthly += monthly;
        byAgent[agent].av += av;
      }

      const list = Object.values(byAgent)
        .map(x => ({ ...x, monthly: Math.round(x.monthly), av: Math.round(x.av) }))
        .sort((a,b)=> (b.av||0)-(a.av||0));

      return {
        startDateUtc: startDate,
        endDateUtc: endDate,
        amountBasis: "monthly",
        list
      };
    });

    return { statusCode: 200, headers: gate.headers, body: JSON.stringify(payload) };
  } catch (e) {
    return { statusCode: 502, headers: gate.headers, body: JSON.stringify({ error: e.message }) };
  }
};
