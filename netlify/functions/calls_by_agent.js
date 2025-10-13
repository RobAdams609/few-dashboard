// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads, sold (if present).

export default async function handler(req, context) {
  try {
    const ET_TZ = "America/New_York";
    const {
      RINGY_CALL_DETAIL_URL,      // e.g. https://app.ringy.com/api/public/external/get-calls/call-detail
      RINGY_API_KEY_CALL_DETAIL,  // team/org API key (if your account uses x-api-key)
      RINGY_TOKEN,                // org token (if your account uses Bearer)
    } = process.env;

    if (!RINGY_CALL_DETAIL_URL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL env var" });
    }

    // ---- Week window (ET) ----
    const now = new Date();
    const nowET = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
    const day = nowET.getDay();                 // Sun=0…Sat=6
    const sinceFri = (day + 2) % 7;             // distance back to Friday
    const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
    const end   = new Date(start); end.setDate(end.getDate() + 7);

    const startISO = toISO(start);              // 2025-10-10T00:00:00Z
    const endISO   = toISO(end);
    const startYMD = toYMD(start);              // 2025-10-10
    const endYMD   = toYMD(end);

    const headersBase = {
      "accept": "application/json",
    };
    if (RINGY_API_KEY_CALL_DETAIL) headersBase["x-api-key"] = RINGY_API_KEY_CALL_DETAIL;
    if (RINGY_TOKEN) headersBase["authorization"] = `Bearer ${RINGY_TOKEN}`;

    // ---- Pull pages until empty ----
    let page = 1;
    const pageSize = 200;
    const rows = [];
    const errorsTried = [];

    while (true) {
      // Prefer POST with JSON body (many Ringy public/external endpoints expect this)
      const tries = [
        {
          kind: "POST dateFrom/dateTo JSON",
          url: RINGY_CALL_DETAIL_URL,
          init: {
            method: "POST",
            headers: { ...headersBase, "content-type": "application/json" },
            body: JSON.stringify({ dateFrom: startYMD, dateTo: endYMD, page, pageSize }),
          },
        },
        {
          kind: "POST startDate/endDate JSON",
          url: RINGY_CALL_DETAIL_URL,
          init: {
            method: "POST",
            headers: { ...headersBase, "content-type": "application/json" },
            body: JSON.stringify({ startDate: startISO, endDate: endISO, page, pageSize }),
          },
        },
        {
          kind: "GET ?dateFrom/dateTo",
          url: withQS(RINGY_CALL_DETAIL_URL, { dateFrom: startYMD, dateTo: endYMD, page, pageSize }),
          init: { method: "GET", headers: headersBase },
        },
        {
          kind: "GET ?startDate/endDate (ISO)",
          url: withQS(RINGY_CALL_DETAIL_URL, { startDate: startISO, endDate: endISO, page, pageSize }),
          init: { method: "GET", headers: headersBase },
        },
        {
          kind: "GET ?start/end (ISO)",
          url: withQS(RINGY_CALL_DETAIL_URL, { start: startISO, end: endISO, page, pageSize }),
          init: { method: "GET", headers: headersBase },
        },
      ];

      let ok = false, list = null, lastErr = null;

      for (const t of tries) {
        const r = await fetch(t.url, t.init).catch(e => ({ ok:false, status:0, _err:e }));
        if (!r || !r.ok) {
          errorsTried.push(`${t.kind} ${r?.status || 0}`);
          lastErr = r;
          continue;
        }
        // parse response
        const data = await safeJson(r);
        list = Array.isArray(data?.items) ? data.items
             : Array.isArray(data?.data)  ? data.data
             : Array.isArray(data)        ? data
             : Array.isArray(data?.rows)  ? data.rows
             : null;

        if (!list) {
          // sometimes wrapped like { result: { items: [...] } }
          const maybe = data?.result || data?.payload || data?.response;
          list = Array.isArray(maybe?.items) ? maybe.items
               : Array.isArray(maybe?.data)  ? maybe.data
               : Array.isArray(maybe)        ? maybe
               : null;
        }

        if (Array.isArray(list)) { ok = true; break; }
        // if response OK but empty structure, treat as success with empty page
        if (r.ok && (list == null)) { list = []; ok = true; break; }
      }

      if (!ok) {
        // On first page, bail with details so you can see which patterns failed.
        if (page === 1) {
          return json(502, {
            error: "fetch failed",
            message: `All parameter/endpoint patterns returned ${errorsTried.join(" ; ")}`,
            perAgent: [],
            team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }
          });
        }
        // otherwise stop pagination
        break;
      }

      rows.push(...list);
      if (!list || list.length < pageSize) break;
      page += 1;
      if (page > 25) break; // safety
    }

    // ---- Aggregate -> perAgent + team ----
    const per = new Map(); // key = agent name/email (lower), value agg
    const team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const x of rows) {
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName) || "";
      const email = pickStr(x.agentEmail, x.userEmail) || "";
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      const calls     = num(x.calls, 1); // many APIs are 1 row = 1 call
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
    return json(500, {
      error: "fetch failed",
      message: String(err?.message || err),
      perAgent: [],
      team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }
    });
  }
}

/* ---------- helpers ---------- */
function json(status, body){
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
function toISO(d){ return new Date(d).toISOString().slice(0,19) + "Z"; }
function toYMD(d){
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth()+1).padStart(2,"0");
  const day = String(x.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function withQS(base, kv){
  const u = new URL(base);
  Object.entries(kv).forEach(([k,v])=> u.searchParams.set(k, String(v)));
  return u.toString();
}
async function safeJson(r){ try { return await r.json(); } catch { return null; } }
function num(...vals){ for (const v of vals){ const n=Number(v); if (Number.isFinite(n)) return n; } return 0; }
function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
    if (typeof v === "string"){
      const m = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (m) return Number(m[1])*60 + Number(m[2]);
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : n; // seconds -> minutes
    }
  }
  return 0;
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
