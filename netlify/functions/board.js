
// Board merger: combines /api/sales and /api/calls and adds display metadata
const { cors, memo, NAME_MAP, headshotFor } = require("./_lib.js");

async function getJson(path) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  const url = `${base}/api/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200 };
  const gate = cors(event); if (!gate.ok) return gate;

  try {
    const data = await memo(`board`, 8000, async () => {
      const [sales, calls] = await Promise.all([ getJson("sales"), getJson("calls") ]);

      const agents = {};
      for (const s of (sales.list || [])) {
        const key = s.agent;
        agents[key] = agents[key] || { agent: key };
        agents[key].salesCount = s.salesCount || 0;
        agents[key].av = Math.round(s.av || 0);
        agents[key].monthly = Math.round(s.monthly || 0);
      }

      for (const c of (calls.list || [])) {
        const key = c.agent;
        agents[key] = agents[key] || { agent: key };
        agents[key].calls = c.calls || 0;
        agents[key].talkTimeMins = c.talkTimeMins || 0;
        agents[key].talkPerCallSecs = c.talkPerCallSecs || 0;
      }

      // Normalize names, attach headshots
      const out = Object.values(agents).map(a => {
        const display = NAME_MAP[a.agent] || a.agent;
        return { ...a, display, headshot: headshotFor(display) };
      });

      // Rankings
      const rankBy = (arr, key) => [...arr].sort((a,b)=> (b[key]||0)-(a[key]||0)).map((x,i)=>({name:x.display, i:i+1}));
      const rAV    = rankBy(out, "av");
      const rSales = rankBy(out, "salesCount");
      const rCalls = rankBy(out, "calls");
      const rTalk  = rankBy(out, "talkTimeMins");

      return { agents: out, rank: { av: rAV, sales: rSales, calls: rCalls, talk: rTalk } };
    });

    return { statusCode: 200, headers: gate.headers, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 502, headers: gate.headers, body: JSON.stringify({ error: e.message }) };
  }
};
