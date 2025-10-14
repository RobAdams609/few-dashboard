// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talkMin, loggedMin, leads, sold
export default async function handler(req) {
  try {
    const {
      RINGY_RECORDINGS_URL,          // https://app.ringy.com/api/public/external/get-call-recordings
      RINGY_API_KEY_RECORDINGS,      // your “recordings” API key
    } = process.env;

    if (!RINGY_RECORDINGS_URL || !RINGY_API_KEY_RECORDINGS) {
      return json(500, { error: "Missing RINGY_RECORDINGS_URL or RINGY_API_KEY_RECORDINGS" });
    }

    // === Week window in ET, send times as UTC “YYYY-MM-DD 00:00:00” ===
    const [startET, endET] = weekRangeET();
    const startUTC = toUtcString(startET);
    const endUTC   = toUtcString(endET);

    // === Pull recordings with paging ===
    const perAgent = new Map();
    let page = 1, pageSize = 200, got = 0, totalFetched = 0;

    while (true) {
      const body = {
        apiKey: RINGY_API_KEY_RECORDINGS,
        startDate: startUTC,
        endDate:   endUTC,
        page,
        pageSize
      };

      const r = await fetch(RINGY_RECORDINGS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        // return sample of upstream body to see exact complaint
        const text = await r.text().catch(() => "");
        return json(502, {
          error: "upstream_error",
          message: "Recordings endpoint did not return JSON. Verify URL/permissions.",
          tries: [{ ok: false, status: r.status, sample: text.slice(0, 400) }],
          team: zeroTeam(),
          perAgent: [],
        });
      }

      const data = await r.json().catch(() => ({}));
      const rows = Array.isArray(data?.items) ? data.items
                : Array.isArray(data?.data)  ? data.data
                : Array.isArray(data)        ? data
                : [];

      if (!rows.length) break;

      for (const it of rows) {
        // Try all reasonable fields Ringy might send
        const name  = clean(it.agentName  ?? it.userName ?? it.ownerName ?? "");
        const email = clean(it.agentEmail ?? it.userEmail ?? it.ownerEmail ?? "");
        const durS  = num(it.durationSec ?? it.duration_seconds ?? it.duration ?? 0);
        const loggedMin = num(it.loggedMin ?? 0);   // seldom present; keep as 0 if not
        const leads = num(it.leads ?? 0);
        const sold  = num(it.sold  ?? 0);

        // Key by email if present, otherwise by name
        const key = email || name || "unknown";
        if (!key) continue;

        const cur = perAgent.get(key) || { key, name, email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
        cur.calls    += 1;
        cur.talkMin  += durS / 60;
        cur.loggedMin+= loggedMin;
        cur.leads    += leads;
        cur.sold     += sold;
        // keep best label
        if (!cur.name && name) cur.name = name;
        if (!cur.email && email) cur.email = email;

        perAgent.set(key, cur);
      }

      got = rows.length;
      totalFetched += got;
      if (got < pageSize) break;  // no more pages
      page++;
    }

    // Summarize team
    let team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    for (const v of perAgent.values()) {
      team.calls    += v.calls;
      team.talkMin  += v.talkMin;
      team.loggedMin+= v.loggedMin;
      team.leads    += v.leads;
      team.sold     += v.sold;
    }

    // Output in the format your dashboard expects
    const out = Array.from(perAgent.values()).map(v => ({
      name:  v.name || "Unknown",
      email: v.email || "",
      calls: v.calls,
      talkMin: Math.round(v.talkMin),
      loggedMin: Math.round(v.loggedMin),
      leads: v.leads,
      sold: v.sold,
    }));

    return json(200, {
      startDate: startUTC,
      endDate:   endUTC,
      team,
      perAgent: out,
      meta: { totalFetched }
    });

  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}

/* ---------- helpers ---------- */
function json(status, obj){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json" }
  });
}
function clean(s){ return String(s||"").trim(); }
function num(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }

const ET_TZ = "America/New_York";
function toET(d){ return new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ })); }
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();               // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;         // days since last Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}
function toUtcString(d){
  // YYYY-MM-DD 00:00:00 in UTC (Ringy expects this style)
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day} 00:00:00`;
}
function zeroTeam(){ return { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }; }
