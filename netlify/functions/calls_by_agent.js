// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads, sold.
// Uses ONLY two env vars you already have:
//   RINGY_CALL_DETAIL_URL   e.g. https://api.ringy.com/v2/calls
//   RINGY_API_KEY_CALL_DETAIL

export default async function handler() {
  try {
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;
    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL" });
    }

    // ----- Weekly window in Eastern Time -----
    const ET_TZ = "America/New_York";
    const nowET = toET(new Date(), ET_TZ);
    const sinceFri = (nowET.getDay() + 2) % 7; // distance back to Friday
    const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
    const end   = new Date(start); end.setDate(end.getDate() + 7);
    const startISO = toISO(start);
    const endISO   = toISO(end);

    // ----- Build & try multiple param/header patterns until one works -----
    const PARAMS = [
      { startKey: "startDate", endKey: "endDate" },
      { startKey: "fromDate",  endKey: "toDate"  },
      { startKey: "start",     endKey: "end"     },
      { startKey: "dateFrom",  endKey: "dateTo"  },
    ];
    const HEADERS = [
      { "x-api-key": RINGY_API_KEY_CALL_DETAIL, "accept": "application/json" },
      { "authorization": `Bearer ${RINGY_API_KEY_CALL_DETAIL}`, "accept": "application/json" },
    ];

    const pageSize = 200;
    let rows = [];
    const errors = [];

    let ok = false;
    for (const p of PARAMS) {
      for (const h of HEADERS) {
        rows = [];
        let page = 1;

        while (true) {
          const url = new URL(RINGY_CALL_DETAIL_URL);
          url.searchParams.set(p.startKey, startISO);
          url.searchParams.set(p.endKey,   endISO);
          url.searchParams.set("page",     String(page));
          url.searchParams.set("pageSize", String(pageSize));

          const r = await fetch(url.toString(), { headers: h });
          if (!r.ok) {
            errors.push(`${url.pathname}?${p.startKey}/${p.endKey} -> ${r.status}`);
            rows = [];
            break; // try next header/param combo
          }

          // various Ringy shapes: {items:[]}, {data:[]}, or []
          const data = await r.json().catch(() => ({}));
          const list = Array.isArray(data?.items) ? data.items
                    : Array.isArray(data?.data)  ? data.data
                    : Array.isArray(data)        ? data
                    : [];
          rows.push(...list);

          if (list.length < pageSize) { ok = true; break; }
          page += 1;
          if (page > 50) { ok = true; break; } // safety
        }
        if (ok) break;
      }
      if (ok) break;
    }

    if (!ok) {
      return json(502, {
        error: "fetch failed",
        message: `All parameter patterns returned errors (400/404).`,
        hints: errors.slice(-6), // last few tries
        perAgent: [],
        team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }
      });
    }

    // ----- Aggregate per agent -----
    const per = new Map(); // key=email||name (lower)
    const team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const x of rows) {
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName);
      const email = pickStr(x.agentEmail, x.userEmail);
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      // many APIs are "one row = one call"
      const calls     = num(x.calls, 1);
      const talkMin   = minutes(
        x.talkTimeMin, x.talkMinutes, x.talk_time_min, x.talk_time,
        x.talkSeconds
      );
      const loggedMin = minutes(
        x.loggedMinutes, x.totalMinutes, x.durationMin, x.duration,
        x.totalSeconds
      );
      const leads     = num(x.leads, 0);
      const sold      = num(x.sold, 0);

      const cur = per.get(key) || { name: name || email, email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls     += calls;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      cur.sold      += sold;
      if (!cur.name && name)  cur.name  = name;
      if (!cur.email && email)cur.email = email;
      per.set(key, cur);

      team.calls     += calls;
      team.talkMin   += talkMin;
      team.loggedMin += loggedMin;
      team.leads     += leads;
      team.sold      += sold;
    }

    return json(200, {
      startDate: startISO,
      endDate:   endISO,
      team: {
        calls: Math.round(team.calls),
        talkMin: Math.round(team.talkMin),
        loggedMin: Math.round(team.loggedMin),
        leads: Math.round(team.leads),
        sold: Math.round(team.sold),
      },
      perAgent: Array.from(per.values()).sort((a,b)=> b.calls - a.calls)
    });

  } catch (err) {
    return json(500, { error: "fetch failed", message: String(err?.message || err), perAgent: [], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
  }
}

/* ---------- helpers ---------- */
function json(status, body){
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
function toET(d, tz){ return new Date(new Date(d).toLocaleString("en-US",{ timeZone: tz })); }
function toISO(d){ return new Date(d).toISOString().slice(0,19) + "Z"; }
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
function num(...vals){ for (const v of vals){ const n=Number(v); if (Number.isFinite(n)) return n; } return 0; }
function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v > 600 ? Math.round(v/60) : v);
    if (typeof v === "string"){
      const m = v.match(/^(\d+):(\d{2})$/);         // "h:mm"
      if (m) return Number(m[1])*60 + Number(m[2]);
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : n; // seconds → minutes
    }
  }
  return 0;
}
