// netlify/functions/calls_by_agent.js  (CommonJS)
//
// Aggregates weekly call stats per agent from Ringy "Call Data" endpoint.
// Env needed (you already set these in Netlify):
//   RINGY_CALL_DETAIL_URL       → e.g. https://app.ringy.com/api/public/external/get-call-details
//   RINGY_API_KEY_CALL_DETAIL   → your Ringy "Call data" API key
//
// Output shape:
//  { startDate, endDate, team:{calls,talkMin,loggedMin,leads,sold}, perAgent:[{name,email,calls,talkMin,loggedMin,leads,sold}] }

const ET_TZ = "America/New_York";
const PAGE_SIZE = 200;            // conservative; loop until fewer returned
const MAX_PAGES = 25;             // hard stop guard

// ---- helpers ----
function toUTCString(d) {
  // "YYYY-MM-DD HH:mm:ss" in UTC
  const pad = n => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

function weekRangeET() {
  // Friday 12:00am ET (inclusive) → next Friday 12:00am ET (exclusive)
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: ET_TZ })
  );
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  // JS: 0=Sun..6=Sat; We need most recent Friday
  const dow = start.getDay(); // 0..6
  const backToFri = (dow + 2) % 7; // distance back to Friday
  start.setDate(start.getDate() - backToFri);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  // Convert those ET wall times to real Date in UTC by parsing back through ET zone again
  const asEtDate = (src) =>
    new Date(
      new Date(
        src.toLocaleString("en-US", { timeZone: ET_TZ })
      ).toISOString()
    );

  const s = asEtDate(start);
  const e = asEtDate(end);
  return [s, e];
}

function safeNumber(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

// Extract something to count as "talk seconds" and "logged seconds"
function pickDurations(row) {
  // Try a bunch of common shapes Ringy returns on different tenants
  // All in SECONDS unless explicitly minutes noted.
  const sec =
    safeNumber(row.talkSeconds) ||
    safeNumber(row.talkDuration) ||
    safeNumber(row.duration) ||
    safeNumber(row.totalTalkTime) ||
    0;

  const loggedSec =
    safeNumber(row.loggedSeconds) ||
    safeNumber(row.wrapUpSeconds) + sec ||
    safeNumber(row.totalDuration) ||
    sec ||
    0;

  return { talkSec: Math.max(0, sec), loggedSec: Math.max(0, loggedSec) };
}

function pickAgentIdentity(row) {
  // Prefer email (stable), then name
  const email =
    (row.userEmail || row.agentEmail || row.email || "").toString().trim().toLowerCase();
  const name =
    (row.userName || row.agentName || row.name || "").toString().trim();
  return { email, name };
}

// ---- Netlify handler (CommonJS) ----
exports.handler = async function () {
  try {
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;

    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, {
        error: "missing_env",
        message:
          "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL in Netlify environment.",
      });
    }

    // Week window (ET) but send UTC timestamps to Ringy:
    const [wStart, wEnd] = weekRangeET();
    const startStr = toUTCString(wStart);
    const endStr = toUTCString(wEnd);

    // Page through results (defensive; some tenants paginate, others return all)
    let page = 1;
    const allRows = [];
    const tries = [];

    while (page <= MAX_PAGES) {
      const body = {
        apiKey: RINGY_API_KEY_CALL_DETAIL,
        startDate: startStr,
        endDate: endStr,
        page,
        pageSize: PAGE_SIZE,
      };

      const r = await fetch(RINGY_CALL_DETAIL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await r.text();
      let rows = [];
      try {
        const parsed = JSON.parse(text);
        // Accept either array or {data:[...]}
        rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
      } catch {
        // Not JSON → bad endpoint or HTML error page
        tries.push({ ok: false, status: r.status, sample: text.slice(0, 200) });
        return json(r.status === 200 ? 502 : r.status, {
          error: "upstream_error",
          message:
            "Ringy did not return JSON. Verify URL/permissions. See 'tries' for sample.",
          tries,
        });
      }

      tries.push({ ok: true, status: r.status, count: rows.length, page });

      allRows.push(...rows);
      if (rows.length < PAGE_SIZE) break; // finished
      page += 1;
    }

    // Aggregate per agent
    const byKey = new Map(); // key=email||name
    let teamCalls = 0;
    let teamTalkSec = 0;
    let teamLoggedSec = 0;
    let teamLeads = 0;
    let teamSold = 0;

    for (const row of allRows) {
      const { email, name } = pickAgentIdentity(row);
      const key = email || name || "unknown";

      const { talkSec, loggedSec } = pickDurations(row);

      const calls = 1;
      const leads = safeNumber(row.leadCount || row.leads || 0);
      const sold = safeNumber(row.sold || row.deals || 0);

      const cur =
        byKey.get(key) || {
          name: name || "Unknown",
          email,
          calls: 0,
          talkMin: 0,
          loggedMin: 0,
          leads: 0,
          sold: 0,
        };

      cur.calls += calls;
      cur.talkMin += talkSec / 60;
      cur.loggedMin += loggedSec / 60;
      cur.leads += leads;
      cur.sold += sold;

      byKey.set(key, cur);

      teamCalls += calls;
      teamTalkSec += talkSec;
      teamLoggedSec += loggedSec;
      teamLeads += leads;
      teamSold += sold;
    }

    // Format output
    const perAgent = Array.from(byKey.values()).map((r) => ({
      name: r.name,
      email: r.email,
      calls: Math.round(r.calls),
      talkMin: Math.round(r.talkMin),
      loggedMin: Math.round(r.loggedMin),
      leads: Math.round(r.leads),
      sold: Math.round(r.sold),
    }));

    // Stable order: name asc
    perAgent.sort((a, b) => a.name.localeCompare(b.name));

    return json(200, {
      startDate: startStr,
      endDate: endStr,
      team: {
        calls: Math.round(teamCalls),
        talkMin: Math.round(teamTalkSec / 60),
        loggedMin: Math.round(teamLoggedSec / 60),
        leads: Math.round(teamLeads),
        sold: Math.round(teamSold),
      },
      perAgent,
    });
  } catch (err) {
    return json(500, {
      error: "handler_crash",
      message: err?.message || String(err),
    });
  }
};

// ---- tiny JSON helper ----
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}
