// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads.
// Uses env: RINGY_CALL_DETAIL_URL (base endpoint like https://app.ringy.com/api/public/external/get-calls)
//           RINGY_API_KEY_CALL_DETAIL

const ET_TZ = "America/New_York";

export default async function handler(req, context) {
  try {
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;
    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL" });
    }

    // Compute week window (ET): Fri 12:00am → next Fri 12:00am
    const { startISO, endISO } = weekWindowISO();

    // Try several endpoint/param patterns. Ringy varies by account:
    //   Paths: .../get-calls            OR .../get-calls/call-detail
    //   Params: startDate/endDate OR fromDate/toDate OR start/end OR dateFrom/dateTo
    const base = stripSlash(RINGY_CALL_DETAIL_URL);
    const paths = unique([
      base,
      base.endsWith("/call-detail") ? base : base + "/call-detail",
    ]);

    const paramSets = [
      { startDate: startISO, endDate: endISO },
      { fromDate: startISO, toDate: endISO },
      { start: startISO, end: endISO },
      { dateFrom: startISO, dateTo: endISO },
    ];

    // Some APIs also take paging; we’ll first try without paging (most return the whole range),
    // then, if we get a short “data/items” page, we’ll keep paging.
    const hints = [];
    let allRows = [];

    outer: for (const p of paths) {
      for (const params of paramSets) {
        const first = await fetchOne(p, params, RINGY_API_KEY_CALL_DETAIL).catch(() => null);
        if (!first || !first.ok) {
          const code = first?.status || 0;
          hints.push(`${toHintPath(p, params)} ${code}`);
          continue;
        }

        const { list, pageSize } = await toList(first);
        allRows.push(...list);

        // If a page-size-like number returned, try paging (up to 25 pages)
        if (pageSize && list.length >= pageSize) {
          let page = 2;
          while (true) {
            const nextResp = await fetchOne(p, { ...params, page: String(page), pageSize: String(pageSize) }, RINGY_API_KEY_CALL_DETAIL).catch(()=>null);
            if (!nextResp?.ok) break;
            const { list: nextList } = await toList(nextResp);
            if (!nextList.length) break;
            allRows.push(...nextList);
            if (nextList.length < pageSize) break;
            if (++page > 25) break;
          }
        }

        // We got something; stop trying other patterns
        break outer;
      }
    }

    if (!allRows.length) {
      return json(502, {
        error: "fetch failed",
        message: "All parameter/endpoint patterns returned 400/404.",
        hints,
        perAgent: [],
        team: { calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 }
      });
    }

    // Aggregate
    const per = new Map(); // key = lower(name/email)
    const team = { calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };

    for (const x of allRows) {
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName);
      const email = pickStr(x.agentEmail, x.userEmail);
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      const calls     = toNum(x.calls, 1); // many APIs = 1 call per row
      const talkMin   = toMinutes(x.talkTimeMin, x.talkMinutes, x.talk_time_min, x.talk_time, x.talkSeconds);
      const loggedMin = toMinutes(x.loggedMinutes, x.totalMinutes, x.durationMin, x.duration, x.durationSeconds);
      const leads     = toNum(x.leads, 0);
      const sold      = toNum(x.sold, 0);

      const cur = per.get(key) || { name: name || email, email, calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };
      cur.calls     += calls;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      cur.sold      += sold;
      if (!cur.name && name)  cur.name = name;
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
      endDate: endISO,
      team,
      perAgent: Array.from(per.values()).sort((a,b)=>b.calls - a.calls),
    });

  } catch (err) {
    return json(500, {
      error: "fetch failed",
      message: String(err?.message || err),
      perAgent: [],
      team: { calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 }
    });
  }
}

/* ---------------- helpers ---------------- */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function stripSlash(s){ return String(s||"").replace(/\/+$/,""); }

function weekWindowISO() {
  const now = new Date();
  const nowET = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
  const day = nowET.getDay();                 // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;             // distance back to Friday
  const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate() + 7);
  return { startISO: toISO(start), endISO: toISO(end) };
}

function toISO(d){ return new Date(d).toISOString().slice(0,19)+"Z"; }

function toNum(...vals){
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function toMinutes(...vals){
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      // Heuristic: big number may be seconds
      return v > 600 ? Math.round(v/60) : Math.max(0, v);
    }
    if (typeof v === "string") {
      const h = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (h) return +h[1]*60 + +h[2];
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : Math.max(0, n);
    }
  }
  return 0;
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }

async function fetchOne(pathBase, params, key){
  const u = new URL(pathBase);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  // Some accounts require header names exactly:
  const r = await fetch(u.toString(), {
    headers: {
      "x-api-key": key,
      "accept": "application/json"
    }
  });
  return r;
}

async function toList(resp){
  const data = await resp.json().catch(()=> ({}));
  // Normalize array shape
  const list = Array.isArray(data?.items) ? data.items
            : Array.isArray(data?.data)  ? data.data
            : Array.isArray(data)        ? data
            : [];
  // Try to discover page size hint
  const pageSize = toNum(data?.pageSize, data?.limit, data?.perPage, 0) || (list.length || 0);
  return { list, pageSize: pageSize || 0 };
}

function toHintPath(pathBase, params){
  const p = new URL(pathBase, "https://x/");
  const used = Object.keys(params).join("/");
  // show like “…/get-calls/call-detail?startDate/endDate”
  return p.pathname + "?" + used;
}

function unique(arr){ return [...new Set(arr)]; }
