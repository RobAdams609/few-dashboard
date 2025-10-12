// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads.
// Uses env: RINGY_CALL_DETAIL_URL (full URL, e.g. https://api.ringy.com/v2/calls)
//          RINGY_API_KEY_CALL_DETAIL (Call Detail API key)

export default async function handler(req, context) {
  try {
    const ET_TZ = "America/New_York";
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL env var" });
    }

    const headers = {
      "x-api-key": RINGY_API_KEY_CALL_DETAIL,
      "accept": "application/json",
    };

    // Week window (ET)
    const [startISO, endISO] = weekRangeISO(ET_TZ);

    // We’ll try several param shapes until one works
    const PAGE_SIZE = 200;
    const patterns = [
      // common
      ({ page }) => ({ startDate: startISO, endDate: endISO, page, pageSize: PAGE_SIZE }),
      // sometimes no pagination
      () => ({ startDate: startISO, endDate: endISO }),
      // start/end
      ({ page }) => ({ start: startISO, end: endISO, page, pageSize: PAGE_SIZE }),
      () => ({ start: startISO, end: endISO }),
      // from/to
      ({ page }) => ({ from: startISO, to: endISO, page, pageSize: PAGE_SIZE }),
      () => ({ from: startISO, to: endISO }),
      // dateFrom/dateTo + offset/limit
      ({ page }) => ({ dateFrom: startISO, dateTo: endISO, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
      () => ({ dateFrom: startISO, dateTo: endISO }),
    ];

    const rows = await fetchWithFallback(RINGY_CALL_DETAIL_URL, headers, patterns, PAGE_SIZE);

    // Aggregate -> perAgent + team
    const per = new Map(); // key = agent email/name (lower), value agg
    let team = { calls: 0, talkMin: 0, loggedMin: 0, leads: 0 };

    for (const x of rows) {
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName) || "";
      const email = pickStr(x.agentEmail, x.userEmail) || "";
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      const calls     = num(x.calls, 1); // many APIs are 1 row = 1 call
      const talkMin   = minutes(x.talkTimeMin, x.talkMinutes, x.talk_time_min, x.talk_time);
      const loggedMin = minutes(x.loggedMinutes, x.totalMinutes, x.durationMin, x.duration);
      const leads     = num(x.leads, 0);

      const cur = per.get(key) || { name: name || email, email, calls: 0, talkMin: 0, loggedMin: 0, leads: 0 };
      cur.calls     += calls;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      if (!cur.name && name)  cur.name  = name;
      if (!cur.email && email) cur.email = email;
      per.set(key, cur);

      team.calls     += calls;
      team.talkMin   += talkMin;
      team.loggedMin += loggedMin;
      team.leads     += leads;
    }

    return json(200, {
      startDate: startISO,
      endDate:   endISO,
      team,
      perAgent: Array.from(per.values()).sort((a,b)=> (b.calls - a.calls)),
    });

  } catch (err) {
    return json(500, { error: "fetch failed", message: String(err?.message || err), perAgent: [], team:{calls:0,talkMin:0,loggedMin:0,leads:0} });
  }
}

/* ---------- helpers ---------- */
function json(status, body){
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
function toISO(d){ return new Date(d).toISOString().slice(0,19) + "Z"; }
function weekRangeISO(tz){
  const now = new Date();
  const nowET = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const day = nowET.getDay();                // Sun=0..Sat=6
  const sinceFri = (day + 2) % 7;
  const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [toISO(start), toISO(end)];
}
function num(...vals){ for (const v of vals){ const n=Number(v); if (Number.isFinite(n)) return n; } return 0; }
function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
    if (typeof v === "string"){
      const m = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (m) return Number(m[1])*60 + Number(m[2]);
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : n; // seconds → minutes
    }
  }
  return 0;
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }

async function fetchWithFallback(baseUrl, headers, patterns, PAGE_SIZE){
  const rows = [];
  let gotGoodPattern = false;

  for (const makeParams of patterns){
    let page = 1;
    let anyForThisPattern = false;
    const acc = [];

    while (true){
      const paramsObj = makeParams({ page });
      const url = new URL(baseUrl);
      Object.entries(paramsObj).forEach(([k,v]) => url.searchParams.set(k, String(v)));

      const r = await fetch(url.toString(), { headers });
      if (!r.ok){
        // If the first page fails, try the next pattern
        if (page === 1) break;
        // If later page fails, stop this pattern
        break;
      }

      const data = await r.json().catch(()=> ({}));
      const list = Array.isArray(data?.items) ? data.items
                : Array.isArray(data?.data)  ? data.data
                : Array.isArray(data)        ? data
                : [];

      acc.push(...list);
      anyForThisPattern = true;

      if (!("page" in paramsObj) && !("offset" in paramsObj)) {
        // no pagination in this pattern
        break;
      }
      if (list.length < PAGE_SIZE) break;
      page += 1;
      if (page > 25) break; // safety
    }

    if (anyForThisPattern){
      rows.push(...acc);
      gotGoodPattern = true;
      break;
    }
  }

  if (!gotGoodPattern){
    throw new Error("All parameter patterns returned errors (400/404).");
  }
  return rows;
}
