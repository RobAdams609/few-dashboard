// TEAM_SOLD.js — Live Ringy integration for team sales (ET week + overrides, no placeholders)

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
    { name: "Eli Thermilus",       key: "RGYkhe6figc1eosyyddbxr43wk6juhxv" },
  ];

  // ---------- helpers ----------
  const pad = n => String(n).padStart(2, "0");

  // format UTC Date -> "YYYY-MM-DD HH:mm:ss" (Ringy expects UTC strings)
  function toRingyUTCString(dUtc) {
    return `${dUtc.getUTCFullYear()}-${pad(dUtc.getUTCMonth()+1)}-${pad(dUtc.getUTCDate())} ` +
           `${pad(dUtc.getUTCHours())}:${pad(dUtc.getUTCMinutes())}:${pad(dUtc.getUTCSeconds())}`;
  }

  // Turn an ET wall-clock datetime into the correct UTC Date
  function etWallToUTC(year, monthIndex, day, h=0, m=0, s=0) {
    // Build a Date as if it's ET by round-tripping through toLocaleString with ET tz
    const etLocal = new Date(
      new Date(Date.UTC(year, monthIndex, day, h, m, s))
        .toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    return new Date(Date.UTC(
      etLocal.getFullYear(), etLocal.getMonth(), etLocal.getDate(),
      etLocal.getHours(), etLocal.getMinutes(), etLocal.getSeconds()
    ));
  }

  // Current ET week window: Friday 00:00 ET -> next Friday 00:00 ET
  function getEtWeekWindow() {
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const dow   = nowET.getDay();                  // Sun=0..Sat=6
    const sinceFri = (dow + 2) % 7;                // Fri=0
    const startET = new Date(nowET); startET.setHours(0,0,0,0);
    startET.setDate(startET.getDate() - sinceFri); // last Fri 00:00 ET
    const endET = new Date(startET); endET.setDate(endET.getDate() + 7);

    const startUTC = etWallToUTC(startET.getFullYear(), startET.getMonth(), startET.getDate(), 0, 0, 0);
    const endUTC   = etWallToUTC(endET.getFullYear(),   endET.getMonth(),   endET.getDate(),   0, 0, 0);
    return { startUTC, endUTC };
  }

  // Optional override via query params: ?start=YYYY-MM-DD&end=YYYY-MM-DD (interpreted as ET)
  function getOverrideRange(ev) {
    const p = ev?.queryStringParameters || {};
    if (!p.start || !p.end) return null;
    const [sy, sm, sd] = p.start.split("-").map(Number);
    const [ey, em, ed] = p.end.split("-").map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) return null;
    const startUTC = etWallToUTC(sy, sm-1, sd, 0, 0, 0);
    const endUTC   = etWallToUTC(ey, em-1, ed, 0, 0, 0);
    return { startUTC, endUTC };
  }

  // Decide the window (override > ET week)
  const override = getOverrideRange(event);
  const { startUTC, endUTC } = override ?? getEtWeekWindow();
  const startDate = toRingyUTCString(startUTC);
  const endDate   = toRingyUTCString(endUTC);

  // ---------- fetch & rollup ----------
  async function fetchSold(agent) {
    try {
      const body = { apiKey: agent.key, startDate, endDate, limit: 5000 };
      const res  = await fetch(RINGY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return Array.isArray(data)
        ? { agent: agent.name, rows: data }
        : { agent: agent.name, rows: [] };
    } catch (e) {
      return { agent: agent.name, rows: [], error: e?.message || "error" };
    }
  }

  const results  = await Promise.all(AGENTS.map(fetchSold));
  const allSales = results.flatMap(r => r.rows.map(x => ({ ...x, agent: r.agent })));

  const byAgent = {};
  for (const s of allSales) {
    const k = s.agent;
    if (!byAgent[k]) byAgent[k] = { count: 0, amount: 0 };
    byAgent[k].count  += 1;
    byAgent[k].amount += Number(s.amount || 0);
  }

  const perAgent = Object.entries(byAgent)
    .map(([name, v]) => ({ name, sales: v.count, amount: v.amount, av12x: v.amount * 12 }))
    .sort((a,b) => b.amount - a.amount);

  const team = {
    totalSales:  allSales.length,
    totalAmount: allSales.reduce((a,b) => a + Number(b.amount || 0), 0),
    totalAV12x:  allSales.reduce((a,b) => a + Number(b.amount || 0) * 12, 0),
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startDate, endDate, team, perAgent, allSales }, null, 2),
  };
};
