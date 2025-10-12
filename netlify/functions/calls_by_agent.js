// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads.
// Uses env:
//   RINGY_CALL_DETAIL_URL  (ex: https://api.ringy.com/api/public/external/get-calls)
//   RINGY_API_KEY_CALL_DETAIL

export default async function handler(req, ctx) {
  try {
    const ET_TZ = "America/New_York";
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL env var" });
    }

    // Week window (ET): Friday 00:00 → next Friday 00:00
    const nowET = toET(new Date());
    const day = nowET.getDay();                // Sun=0 … Sat=6
    const sinceFri = (day + 2) % 7;            // distance back to Friday
    const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
    const end   = new Date(start); end.setDate(end.getDate() + 7);

    // Try common Ringy param names until one works (some accounts vary)
    const attempts = [
      { from: "dateFrom", to: "dateTo" },
      { from: "fromDate", to: "toDate" },
      { from: "start",    to: "end"    },
      { from: "startDate",to: "endDate"}
    ];

    let rows = null;
    const hints = [];

    for (const p of attempts) {
      const url = new URL(RINGY_CALL_DETAIL_URL);
      url.searchParams.set(p.from, toISO(start));
      url.searchParams.set(p.to,   toISO(end));
      url.searchParams.set("page", "1");
      url.searchParams.set("pageSize", "200");

      const out = [];
      let page = 1;
      while (true) {
        url.searchParams.set("page", String(page));
        const r = await fetch(url.toString(), {
          headers: {
            "x-api-key": RINGY_API_KEY_CALL_DETAIL,
            "accept": "application/json"
          }
        });

        if (!r.ok) {
          hints.push(`${url.pathname}?${p.from}/${p.to} -> ${r.status}`);
          rows = null;
          break; // try next param pattern
        }

        const data = await r.json().catch(() => ({}));
        const list = Array.isArray(data?.items) ? data.items
                  : Array.isArray(data?.data)  ? data.data
                  : Array.isArray(data)        ? data
                  : [];

        out.push(...list);
        if (list.length < 200) { rows = out; break; }
        page += 1;
        if (page > 25) { rows = out; break; } // safety
      }
      if (rows && Array.isArray(rows)) break;
    }

    if (!rows) {
      return json(502, { error:"fetch failed", message:"All parameter patterns returned errors (400/404).", hints, perAgent:[], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
    }

    // Aggregate per agent
    const per = new Map();
    const team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const x of rows) {
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName) || "";
      const email = pickStr(x.agentEmail, x.userEmail) || "";
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      const calls     = num(x.calls, 1); // many APIs are 1 call per row
      const talkMin   = minutes(x.talkTimeMin, x.talkMinutes, x.talk_time_min, x.talk_time);
      const loggedMin = minutes(x.loggedMinutes, x.totalMinutes, x.durationMin, x.duration);
      const leads     = num(x.leads, 0);
      const sold      = num(x.sold, 0);

      const cur = per.get(key) || { name: name || email, email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls     += calls;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      cur.sold      += sold;
      if (!cur.name && name)  cur.name  = name;
      if (!cur.email && email) cur.email = email;
      per.set(key, cur);

      team.calls     += calls;
      team.talkMin   += talkMin;
      team.loggedMin += loggedMin;
      team.leads     += leads;
      team.sold      += sold;
    }

    return json(200, {
      startDate: toISO(start),
      endDate:   toISO(end),
      team,
      perAgent: Array.from(per.values()).sort((a,b)=> (b.calls - a.calls))
    });

  } catch (err) {
    return json(500, { error:"fetch failed", message:String(err?.message||err), perAgent:[], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
  }
}

/* helpers */
function json(status, body){
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
function toET(d){ return new Date(new Date(d).toLocaleString("en-US",{ timeZone:"America/New_York" })); }
function toISO(d){ return new Date(d).toISOString().slice(0,19) + "Z"; }
function num(...vals){ for (const v of vals){ const n=Number(v); if (Number.isFinite(n)) return n; } return 0; }
function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
    if (typeof v === "string"){
      const m = v.match(/^(\d+):(\d{2})$/); if (m) return Number(m[1])*60 + Number(m[2]);
      const n = Number(v); if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : n;
    }
  }
  return 0;
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
