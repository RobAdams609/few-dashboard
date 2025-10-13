// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads/sold (0 if not provided).
// Uses env vars:
//   RINGY_CALL_DETAIL_URL      = https://app.ringy.com/api/public/external/get-calls/call-detail
//   RINGY_API_KEY_CALL_DETAIL  = <your "Call data" API key>

export default async function handler(req, ctx) {
  try {
    const {
      RINGY_CALL_DETAIL_URL,
      RINGY_API_KEY_CALL_DETAIL,
    } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL" });
    }

    // Week window in Eastern Time, but send to Ringy in UTC "YYYY-MM-DD HH:mm:ss"
    const ET_TZ = "America/New_York";
    const [startET, endET] = weekRangeET(ET_TZ);
    const startUTC = toUtcString(startET);
    const endUTC   = toUtcString(endET);

    // Ringy expects POST JSON, not GET query params.
    // Some tenants cap responses; include a big limit. If Ringy later supports paging, you can loop.
    const body = {
      apiKey: RINGY_API_KEY_CALL_DETAIL,
      startDate: startUTC,  // "YYYY-MM-DD HH:mm:ss" UTC
      endDate:   endUTC,
      limit: 5000
    };

    const r = await fetch(RINGY_CALL_DETAIL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const text = await safeText(r);
      return json(502, { error: "upstream error", status: r.status, body: text });
    }

    const data = await r.json().catch(() => ({}));
    // Normalize rows
    const rows = Array.isArray(data?.items) ? data.items
               : Array.isArray(data?.data)  ? data.data
               : Array.isArray(data)        ? data
               : [];

    // Aggregate by agent name/email coming from Ringy.
    const per = new Map(); // key = (email||name).toLowerCase()
    const team = { calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };

    for (const x of rows) {
      // Try all likely name/email fields Ringy may return.
      const name  = pickStr(x.agent, x.agentName, x.user, x.userName, x.ownerName, x.assigneeName);
      const email = pickStr(x.agentEmail, x.userEmail, x.ownerEmail);
      const key   = (email || name || "").trim().toLowerCase();
      if (!key) continue;

      const talkMin   = minutes(
        x.talkMinutes, x.talk_time_min, x.talk_time,
        x.talkSeconds, x.talk_secs, x.talkSec, x.talkDurationSeconds
      );
      const loggedMin = minutes(
        x.loggedMinutes, x.totalMinutes, x.durationMin,
        x.duration, x.durationSeconds, x.callLengthSeconds
      );

      const cur = per.get(key) || { name: name || email || "Unknown", email, calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };
      cur.calls     += 1;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      if (!cur.name && name)  cur.name  = name;
      if (!cur.email && email) cur.email = email;
      per.set(key, cur);

      team.calls     += 1;
      team.talkMin   += talkMin;
      team.loggedMin += loggedMin;
    }

    return json(200, {
      startDate: startUTC,
      endDate:   endUTC,
      team: {
        calls: Math.round(team.calls),
        talkMin: Math.round(team.talkMin),
        loggedMin: Math.round(team.loggedMin),
        leads: 0,
        sold: 0
      },
      perAgent: Array.from(per.values()).sort((a,b)=> b.calls - a.calls),
    });

  } catch (err) {
    return json(500, { error: "fetch failed", message: String(err?.message || err), perAgent: [], team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0} });
  }
}

/* ---------- helpers ---------- */
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }});
}
function weekRangeET(tz) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const day = now.getDay();                 // Sun=0..Sat=6
  const sinceFri = (day + 2) % 7;           // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate() + 7);
  return [start, end];
}
function toUtcString(d) { // "YYYY-MM-DD HH:mm:ss"
  const iso = new Date(d).toISOString().slice(0,19); // "YYYY-MM-DDTHH:mm:ss"
  return iso.replace("T"," ");
}
function pickStr(...vals){ for (const v of vals) if (v && typeof v === "string") return v; return ""; }
function minutes(...vals){
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      // if it looks like seconds, convert; if minutes, keep.
      return v > 600 ? Math.round(v/60) : Math.round(v);
    }
    if (typeof v === "string") {
      const hm = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (hm) return Number(hm[1])*60 + Number(hm[2]);
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : Math.round(n);
    }
  }
  return 0;
}
async function safeText(r){ try { return await r.text(); } catch { return ""; } }
