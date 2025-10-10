// netlify/functions/calls_by_agent.js
// Per-agent weekly Calls/Talk pulled from each agent's Ringy *Call Data* API key

export const handler = async () => {
  // Ringy endpoint for Call Data (same family as your existing calls_diag)
  const RINGY_URL = "https://app.ringy.com/api/public/external/get-call-data";

  // === Agents that have a Call Data key right now ===
  // (Add more when you have them — copy a line and change name,email,key)
  const AGENTS = [
    {
      name: "Eli Thermilus",
      email: "eli.thermilushealthadvisor@gmail.com",
      key: "RGYuoaefvu4z3tobog3xzjy19ez5u9so", // Call Data
    },
    {
      name: "Anna Gleason",
      email: "anna.ushealthadvisors@gmail.com",
      key: "RGYh6n5ela0h3rnxynoedw7sc6n17md0", // Call Data
    },
  ];

  // Week window: Fri 12:00AM ET → next Thu 11:59:59 PM ET, sent to Ringy as UTC
  const pad = n => String(n).padStart(2,"0");
  const toUtcParts = (dET) => ({
    Y: dET.getUTCFullYear(),
    M: pad(dET.getUTCMonth()+1),
    D: pad(dET.getUTCDate()),
    h: pad(dET.getUTCHours()),
    m: pad(dET.getUTCMinutes()),
    s: pad(dET.getUTCSeconds()),
  });
  const toET = (d) => new Date(new Date(d).toLocaleString("en-US",{timeZone:"America/New_York"}));
  const weekRangeET = () => {
    const now = toET(new Date());
    const day = now.getDay();              // 0..6
    const sinceFri = (day + 2) % 7;        // Fri=0
    const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-sinceFri);
    const end   = new Date(start); end.setDate(end.getDate()+7);
    return [start, end];
  };
  const utcStr = (d) => {
    const p = toUtcParts(new Date(d.toUTCString()));
    return `${p.Y}-${p.M}-${p.D} ${p.h}:${p.m}:${p.s}`;
  };
  const [startET, endET] = weekRangeET();
  const startDate = utcStr(startET);
  const endDate   = utcStr(endET);

  async function pullAgent(a){
    try {
      const body = { apiKey: a.key, startDate, endDate, limit: 5000 };
      const res  = await fetch(RINGY_URL, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Ringy ${res.status}`);
      const rows = await res.json();

      // Count every row as a Call; talk min from duration-like fields
      let calls = 0, talkMin = 0;
      (Array.isArray(rows) ? rows : []).forEach(r=>{
        calls += 1;
        const sec = Number(r.duration ?? r.callDuration ?? r.talk_time_seconds ?? 0);
        talkMin += sec/60;
      });

      return {
        name: a.name,
        email: a.email,
        calls,
        talkMin: Math.round(talkMin),
        loggedMin: Math.round(talkMin), // if you later want a different field, we can swap
      };
    } catch (e){
      return { name:a.name, email:a.email, calls:0, talkMin:0, loggedMin:0, error: String(e.message||e) };
    }
  }

  const results = await Promise.all(AGENTS.map(pullAgent));

  const team = results.reduce((acc,r)=>({
    calls: acc.calls + (r.calls||0),
    talkMin: acc.talkMin + (r.talkMin||0),
    loggedMin: acc.loggedMin + (r.loggedMin||0),
  }), { calls:0, talkMin:0, loggedMin:0 });

  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ startDate, endDate, agents: results, team }, null, 2),
  };
};
