// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads.
// Uses env: RINGY_CALL_DETAIL_URL (must be .../get-calls/call-detail) + RINGY_API_KEY_CALL_DETAIL

export default async function handler(req) {
  try {
    const ET_TZ = "America/New_York";
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL env var" });
    }

    // ---- Week window in ET (Fri 00:00:00 to Fri 00:00:00 next week) ----
    const now = new Date();
    const nowET = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
    const day = nowET.getDay();                  // Sun=0…Sat=6
    const sinceFri = (day + 2) % 7;              // distance back to Friday
    const startET = new Date(nowET); startET.setHours(0,0,0,0); startET.setDate(startET.getDate() - sinceFri);
    const endET   = new Date(startET); endET.setDate(endET.getDate() + 7);

    // Ringy docs show "UTC, YYYY-MM-DD HH:mm:ss"
    const startStr = toRingyUTC(startET);
    const endStr   = toRingyUTC(endET);

    // ---- Pull pages (POST JSON body) ----
    let page = 1, pageSize = 200;
    const rows = [];
    while (true) {
      const body = {
        apiKey: RINGY_API_KEY_CALL_DETAIL,
        startDate: startStr,    // UTC "YYYY-MM-DD HH:mm:ss"
        endDate: endStr,        // UTC "YYYY-MM-DD HH:mm:ss"
        page,
        pageSize
      };

      const r = await fetch(RINGY_CALL_DETAIL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!r.ok) {
        // Give concrete hints so debugging is easy
        const txt = await safeText(r);
        return json(502, {
          error: "fetch failed",
          message: "Ringy call-detail returned " + r.status,
          hint: "Ensure URL ends with /get-calls/call-detail and we POST JSON {apiKey,startDate,endDate,page,pageSize}",
          body: txt,
          startDate: startStr,
          endDate: endStr
        });
      }

      const data = await r.json().catch(()=>null);
      const items =
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data?.data)  && data.data)  ||
        (Array.isArray(data)        && data)       || [];

      rows.push(...items);

      if (items.length < pageSize) break;
      page += 1;
      if (page > 25) break; // safety
    }

    // ---- Aggregate ----
    const per = new Map(); // key = name/email (lowercase)
    let team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const x of rows) {
      const name  = pickStr(x.user_name, x.userName, x.agent, x.agentName, x.ownerName) || "";
      const email = pickStr(x.userEmail, x.agentEmail, x.email) || "";
      const key   = (email || name).trim().toLowerCase() || "unknown";

      // Calls: usually one row = one call
      const calls = 1;

      // Talk minutes: try several fields (seconds or minutes)
      const talkMin = minutes(
        x.talkMinutes, x.talk_time_min, x.talk_time, x.talk_min,
        x.duration, x.durationSec, x.durationSeconds
      );

      // Logged minutes: total call time if provided
      const loggedMin = minutes(
        x.loggedMinutes, x.totalMinutes, x.durationMin, x.totalDuration, x.call_duration
      );

      // Leads / sold rarely present in call detail
      const leads = Number(x.leads||0);
      const sold  = Number(x.sold||0);

      const cur = per.get(key) || { name: name || email || "Unknown", email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls     += calls;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      cur.sold      += sold;
      if (!cur.name && name) cur.name = name;
      if (!cur.email && email) cur.email = email;
      per.set(key, cur);

      team.calls     += calls;
      team.talkMin   += talkMin;
      team.loggedMin += loggedMin;
      team.leads     += leads;
      team.sold      += sold;
    }

    return json(200, {
      startDate: startStr,
      endDate:   endStr,
      team,
      perAgent: Array.from(per.values()).sort((a,b)=> b.calls - a.calls)
    });

  } catch (err) {
    return json(500, { error: "fetch failed", message: String(err?.message||err), perAgent: [], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
  }
}

/* ---------- helpers ---------- */
function json(status, body){
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
// Convert a local Date to "YYYY-MM-DD HH:mm:ss" in UTC
function toRingyUTC(d){
  const z = new Date(d);
  const yyyy = z.getUTCFullYear();
  const mm   = String(z.getUTCMonth()+1).padStart(2,"0");
  const dd   = String(z.getUTCDate()).padStart(2,"0");
  const HH   = String(z.getUTCHours()).padStart(2,"0");
  const MM   = String(z.getUTCMinutes()).padStart(2,"0");
  const SS   = String(z.getUTCSeconds()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      // assume numbers > 600 are seconds, otherwise minutes
      return v > 600 ? Math.round(v/60) : v;
    }
    if (typeof v === "string"){
      const h = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (h) return Number(h[1])*60 + Number(h[2]);
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : n;
    }
  }
  return 0;
}
async function safeText(r){ try { return await r.text(); } catch { return ""; } }
