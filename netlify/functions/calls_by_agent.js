// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads.
// Uses env vars: RINGY_CALL_DETAIL_URL (must include /call-detail) + RINGY_API_KEY_CALL_DETAIL.

export default async function handler(req, context) {
  try {
    const ET_TZ = "America/New_York";

    const {
      RINGY_CALL_DETAIL_URL,      // e.g. https://app.ringy.com/api/public/external/get-calls/call-detail
      RINGY_API_KEY_CALL_DETAIL,  // API key for call detail
    } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL env var" });
    }

    // Week window (ET)
    const now = new Date();
    const nowET = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
    const day = nowET.getDay();                   // Sun=0…Sat=6
    const sinceFri = (day + 2) % 7;               // distance back to Friday
    const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
    const end   = new Date(start); end.setDate(end.getDate() + 7);
    const startISO = toISO(start);
    const endISO   = toISO(end);

    // Ringy has different param styles across accounts.
    // We will try up to 4 patterns until one returns 200:
    //   1) startDate / endDate
    //   2) dateFrom / dateTo
    //   3) start / end
    //   4) no date params (last resort)
    const patterns = [
      { startKey: "startDate", endKey: "endDate" },
      { startKey: "dateFrom",  endKey: "dateTo"  },
      { startKey: "start",     endKey: "end"     },
      { startKey: null,        endKey: null      },
    ];

    let page = 1, pageSize = 200;
    const rows = [];
    const hints = [];

    while (true) {
      let success = false;
      let lastStatus = null, lastBody = null;

      for (const p of patterns) {
        const url = new URL(RINGY_CALL_DETAIL_URL);
        if (p.startKey && p.endKey) {
          url.searchParams.set(p.startKey, startISO);
          url.searchParams.set(p.endKey,   endISO);
        }
        url.searchParams.set("page",     String(page));
        url.searchParams.set("pageSize", String(pageSize));

        const r = await fetch(url.toString(), {
          headers: {
            "x-api-key": RINGY_API_KEY_CALL_DETAIL,
            "accept": "application/json",
          },
        });

        if (r.ok) {
          const data = await r.json().catch(()=> ({}));
          const list = Array.isArray(data?.items) ? data.items
                    : Array.isArray(data?.data)  ? data.data
                    : Array.isArray(data)        ? data
                    : [];
          rows.push(...list);

          // stop if short page
          if (list.length < pageSize) success = true;
          break;
        } else {
          lastStatus = r.status;
          lastBody   = await safeText(r);
          hints.push(`${url.pathname}${url.search} ${r.status}`);
        }
      }

      if (!success) {
        return json(502, {
          error:   "fetch failed",
          message: "All parameter/endpoint patterns returned 400/404.",
          hints,
          perAgent: [],
          team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 },
        });
      }

      if (rows.length >= page * pageSize) {
        // likely more pages
        page += 1;
        if (page > 25) break; // safety
      } else {
        break;
      }
    }

    // Aggregate
    const per = new Map(); // key = agent name/email (lower), value agg
    let team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const x of rows) {
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName) || "";
      const email = pickStr(x.agentEmail, x.userEmail) || "";
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      const calls     = num(x.calls, 1); // many APIs are 1 per row
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
      startDate: startISO,
      endDate:   endISO,
      team,
      perAgent: Array.from(per.values()).sort((a,b)=> (b.calls - a.calls)),
    });

  } catch (err) {
    return json(500, { error: "fetch failed", message: String(err?.message || err), perAgent: [], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
  }
}

/* ---------- helpers ---------- */
function json(status, body){
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
function toISO(d){ return new Date(d).toISOString().slice(0,19) + "Z"; }
function num(...vals){ for (const v of vals){ const n=Number(v); if (Number.isFinite(n)) return n; } return 0; }
function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
    if (typeof v === "string"){
      const m = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (m) return Number(m[1])*60 + Number(m[2]);
      const n = Number(v);
      if (Number.isFinite(n)){
        // heuristic: big number likely seconds
        return n > 600 ? Math.round(n/60) : n;
      }
    }
  }
  return 0;
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
async function safeText(r){ try{ return await r.text(); }catch{ return ""; } }
