// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-phone: calls, talk, logged, leads, sold.
// Works with Ringy "get-calls/call-detail" whether it returns items[] or raw array.
// Derives the agent by phone number (INBOUND -> toPhoneNumber, OUTBOUND -> fromPhoneNumber).

export default async function handler(req, context) {
  try {
    const ET_TZ = "America/New_York";
    const {
      RINGY_CALL_DETAIL_URL,      // e.g. https://app.ringy.com/api/public/external/get-calls/call-detail
      RINGY_API_KEY_CALL_DETAIL,  // team API key for calls
    } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL env var" });
    }

    // ---- Week window (ET)
    const now = new Date();
    const nowET = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
    const day = nowET.getDay();                   // Sun=0…Sat=6
    const sinceFri = (day + 2) % 7;               // distance back to Friday
    const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
    const end   = new Date(start); end.setDate(end.getDate() + 7);
    const startISO = toISO(start);
    const endISO   = toISO(end);

    // ---- Pull pages until empty (try several parameter/verb patterns)
    const rows = [];
    let page = 1, pageSize = 200;

    while (true) {
      const got = await tryAllPatterns({
        baseUrl: RINGY_CALL_DETAIL_URL,
        apiKey: RINGY_API_KEY_CALL_DETAIL,
        startISO, endISO, page, pageSize
      });

      if (!got.ok) {
        // Return the most useful hints only on first page to avoid spam
        if (page === 1) {
          return json(502, { error: "fetch failed", message: got.message, hints: got.hints, perAgent: [], team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 } });
        }
        break;
      }

      rows.push(...got.items);
      if (got.items.length < pageSize) break;
      page += 1;
      if (page > 30) break; // safety
    }

    // ---- Aggregate per phone
    const perPhone = new Map(); // phone10 -> agg
    let team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const x of rows) {
      const dir = (pickStr(x.callDirection, x.direction) || "").toUpperCase(); // INBOUND / OUTBOUND
      const to  = phone10(pickStr(x.toPhoneNumber, x.to_phone, x.toNumber));
      const from= phone10(pickStr(x.fromPhoneNumber, x.from_phone, x.fromNumber));

      const phone = (dir === "INBOUND") ? to : (dir === "OUTBOUND" ? from : (to || from));
      const key   = phone || "unknown";

      const talkMin   = minutes(
        x.talkMinutes, x.talk_time_min, x.talk_time, x.talkMin,
        // general durations (seconds) fallbacks:
        secsToMin(x.duration), secsToMin(x.totalSeconds),
        x.durationMin, x.totalMinutes
      );

      const loggedMin = minutes(
        x.loggedMinutes, x.totalMinutes, x.handleMinutes, secsToMin(x.totalSeconds)
      );

      const calls = 1;
      const leads = num(x.leads, 0);
      const sold  = num(x.sold, 0);

      const cur = perPhone.get(key) || { phone: key, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls     += calls;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      cur.sold      += sold;
      perPhone.set(key, cur);

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
      perPhone: Array.from(perPhone.values()).sort((a,b)=> (b.calls - a.calls)),
      // kept for backwards-compat with older dashboard code:
      perAgent: []
    });

  } catch (err) {
    return json(500, { error: "fetch failed", message: String(err?.message || err), perAgent: [], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
  }
}

/* ---------- fetching patterns ---------- */
async function tryAllPatterns({ baseUrl, apiKey, startISO, endISO, page, pageSize }) {
  const hints = [];

  const GET_params = [
    ["startDate","endDate"],
    ["dateFrom","dateTo"],
    ["start","end"],
  ];

  // --- try GET variants
  for (const [a, b] of GET_params) {
    try {
      const u = new URL(baseUrl);
      u.searchParams.set(a, startISO);
      u.searchParams.set(b, endISO);
      u.searchParams.set("page", String(page));
      u.searchParams.set("pageSize", String(pageSize));

      const r = await fetch(u.toString(), {
        headers: {
          "x-api-key": apiKey,
          "accept": "application/json",
        },
      });

      if (r.ok) {
        const list = await parseList(r);
        if (list) return { ok:true, items:list };
      } else {
        hints.push(`${u.pathname}?${a}/${b} ${r.status}`);
      }
    } catch (e) {
      hints.push(`${baseUrl}?${a}/${b} -> ${String(e.message||e)}`);
    }
  }

  // --- try POST JSON (some tenants require body JSON with apiKey)
  try {
    const r = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        apiKey,
        startDate: startISO,
        endDate: endISO,
        page,
        pageSize
      })
    });

    if (r.ok) {
      const list = await parseList(r);
      if (list) return { ok:true, items:list };
    } else {
      hints.push(`POST ${new URL(baseUrl).pathname} ${r.status}`);
    }
  } catch (e) {
    hints.push(`POST JSON -> ${String(e.message||e)}`);
  }

  return { ok:false, message:"All parameter/endpoint patterns returned 400/404.", hints };
}

async function parseList(r) {
  const data = await r.json().catch(()=>null);
  if (!data) return null;

  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data))  return data.data;
  if (Array.isArray(data))        return data;
  return null;
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
        return n > 600 ? Math.round(n/60) : n; // if it's seconds, convert
      }
    }
  }
  return 0;
}
const secsToMin = s => (Number.isFinite(Number(s)) ? Math.round(Number(s)/60) : 0);
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
function phone10(s){
  const d = String(s||"").replace(/\D+/g, "");
  if (!d) return "";
  return d.slice(-10); // last 10 digits standardized
}
