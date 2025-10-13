// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads (0 placeholder).
// Uses env: RINGY_CALL_DETAIL_URL + RINGY_API_KEY_CALL_DETAIL.
// Works with Ringy "get-calls" (POST JSON). Auto-paginates.

export default async function handler(req, context) {
  try {
    const ET_TZ = "America/New_York";
    const {
      RINGY_CALL_DETAIL_URL,      // e.g. https://app.ringy.com/api/public/external/get-calls
      RINGY_API_KEY_CALL_DETAIL,  // Ringy "Call data" API key
    } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL env var" });
    }

    // Compute Friday-to-Friday window (ET), send to Ringy as UTC ISO.
    const [startET, endET] = weekRangeET();
    const startISO = toUTCISO(startET);
    const endISO   = toUTCISO(endET);

    // Pull pages
    const rows = [];
    let page = 1;
    const pageSize = 200;

    while (true) {
      const body = {
        apiKey: RINGY_API_KEY_CALL_DETAIL,
        dateFrom: startISO, // Ringy expects UTC ISO for get-calls
        dateTo: endISO,
        page,
        pageSize,
      };

      const r = await fetch(RINGY_CALL_DETAIL_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const msg = await safeText(r);
        return json(502, { error: "upstream error", status: r.status, body: msg });
      }

      const data = await r.json().catch(() => ({}));
      const list = Array.isArray(data?.items) ? data.items
                : Array.isArray(data?.data)  ? data.data
                : Array.isArray(data)        ? data
                : [];

      rows.push(...list);

      if (list.length < pageSize) break;
      page += 1;
      if (page > 50) break; // safety
    }

    // Aggregate
    const per = new Map();  // key=email||name lower
    let team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const c of rows) {
      const name  = pickStr(c.agent, c.agentName, c.userName, c.ownerName) || "";
      const email = pickStr(c.agentEmail, c.userEmail) || "";
      const key   = (email || name).trim().toLowerCase();
      if (!key) continue;

      // Ringy get-calls returns a "duration" (seconds). We'll treat that as talk/logged time.
      const durationSec = firstNumber(c.duration, c.totalDuration, c.callDuration);
      const minutes = Math.max(0, Math.round((durationSec || 0) / 60));

      const cur = per.get(key) || { name: name || email, email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls     += 1;
      cur.talkMin   += minutes;
      cur.loggedMin += minutes; // no separate logged available from get-calls
      per.set(key, cur);

      team.calls     += 1;
      team.talkMin   += minutes;
      team.loggedMin += minutes;
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
function toUTCISO(d){
  const utc = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return utc.toISOString().slice(0,19) + "Z";
}
function weekRangeET(){
  const ET_TZ = "America/New_York";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ }));
  const day = now.getDay();              // Sun=0…Sat=6
  const sinceFri = (day + 2) % 7;        // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate() + 7);
  return [start, end];
}
function pickStr(...vals){ for (const v of vals){ if (v && typeof v === "string") return v; } return ""; }
function firstNumber(...vals){ for (const v of vals){ const n = Number(v); if (Number.isFinite(n)) return n; } return 0; }
async function safeText(r){ try{ return await r.text(); }catch{ return ""; } }
