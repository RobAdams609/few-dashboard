// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET → next Fri 12:00am ET) per-agent: calls, talk, logged, leads, sold.
// Ringy expects POST JSON at https://app.ringy.com/api/public/external/get-calls

export default async function handler(req, ctx) {
  try {
    // --- ENV ---
    const {
      RINGY_CALL_DETAIL_URL,          // e.g. https://app.ringy.com/api/public/external/get-calls
      RINGY_API_KEY_CALL_DETAIL,      // team-level "Call data" key (fallback)
      RINGY_AGENT_CALL_KEYS_JSON      // OPTIONAL: JSON string of [{name,email,apiKey}]
    } = process.env;

    if (!RINGY_CALL_DETAIL_URL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL" });
    }

    // --- Week window in Eastern Time, but Ringy wants UTC YYYY-MM-DD HH:mm:ss ---
    const ET_TZ = "America/New_York";
    const [startET, endET] = weekET();
    const startUTC = toUTCString(startET);
    const endUTC   = toUTCString(endET);

    // Build roster mapping from request-side if provided in body (not required)
    // (We only need this to help us label Unknowns nicely if we must fallback.)
    let roster = [];
    try {
      roster = JSON.parse(req.body || "[]");
    } catch { /* ignore */ }

    const agentKeys = parseAgentKeys(RINGY_AGENT_CALL_KEYS_JSON);

    // Aggregate containers
    const perAgent = [];
    let teamAgg = newTally();

    if (agentKeys.length) {
      // ---- Preferred: per-agent API key loop ----
      for (const ag of agentKeys) {
        const tally = await fetchAndSumCalls({
          url: RINGY_CALL_DETAIL_URL,
          apiKey: ag.apiKey,
          startUTC,
          endUTC
        });

        teamAgg = addTallies(teamAgg, tally);

        perAgent.push({
          name: ag.name || "",
          email: (ag.email || "").toLowerCase(),
          calls: tally.calls,
          talkMin: minutes(tally.talkSec),
          loggedMin: minutes(tally.loggedSec),
          leads: tally.leads,
          sold: tally.sold
        });
      }
    } else if (RINGY_API_KEY_CALL_DETAIL) {
      // ---- Fallback: single team key, then try to group by response fields ----
      const all = await fetchAllPages({
        url: RINGY_CALL_DETAIL_URL,
        apiKey: RINGY_API_KEY_CALL_DETAIL,
        startUTC,
        endUTC
      });

      // Group by whatever stable agent hint Ringy returns
      const byHint = new Map();
      for (const rec of all) {
        const key =
          String(rec.userEmail || rec.userName || "").trim().toLowerCase() || "unknown";

        const cur = byHint.get(key) || newTally();
        addOne(rec, cur);
        byHint.set(key, cur);
      }

      // Map to output rows; try to match roster names/emails if present
      const nameToRoster = new Map(
        roster.map(a => [String(a.name || "").trim().toLowerCase(), a])
      );
      const emailToRoster = new Map(
        roster.map(a => [String(a.email || "").trim().toLowerCase(), a])
      );

      for (const [hint, t] of byHint) {
        teamAgg = addTallies(teamAgg, t);

        const a =
          emailToRoster.get(hint) ||
          nameToRoster.get(hint) ||
          { name: hint === "unknown" ? "Unknown" : hint, email: "" };

        perAgent.push({
          name: a.name || "Unknown",
          email: (a.email || "").toLowerCase(),
          calls: t.calls,
          talkMin: minutes(t.talkSec),
          loggedMin: minutes(t.loggedSec),
          leads: t.leads,
          sold: t.sold
        });
      }
    } else {
      return json(500, {
        error:
          "No agent key list (RINGY_AGENT_CALL_KEYS_JSON) and no team key (RINGY_API_KEY_CALL_DETAIL) provided."
      });
    }

    // Sort by name for consistency
    perAgent.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return json(200, {
      startDate: startUTC,
      endDate: endUTC,
      team: {
        calls: teamAgg.calls,
        talkMin: minutes(teamAgg.talkSec),
        loggedMin: minutes(teamAgg.loggedSec),
        leads: teamAgg.leads,
        sold: teamAgg.sold
      },
      perAgent
    });
  } catch (e) {
    return json(500, { error: e?.message || String(e) });
  }
}

/* ----------------- Helpers ----------------- */

function newTally() {
  return { calls: 0, talkSec: 0, loggedSec: 0, leads: 0, sold: 0 };
}
function addTallies(a, b) {
  return {
    calls: a.calls + b.calls,
    talkSec: a.talkSec + b.talkSec,
    loggedSec: a.loggedSec + b.loggedSec,
    leads: a.leads + b.leads,
    sold: a.sold + b.sold
  };
}
function minutes(sec) { return Math.round((Number(sec || 0)) / 60); }

function weekET() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = now.getDay(); // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return [start, end];
}
function toUTCString(d) {
  const pad = n => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}-${m}-${da} ${hh}:${mm}:${ss}`;
}
function parseAgentKeys(jsonStr) {
  try {
    const arr = JSON.parse(jsonStr || "[]");
    return Array.isArray(arr) ? arr.filter(x => x?.apiKey) : [];
  } catch {
    return [];
  }
}

async function fetchAndSumCalls({ url, apiKey, startUTC, endUTC }) {
  const tally = newTally();
  const rows = await fetchAllPages({ url, apiKey, startUTC, endUTC });
  for (const rec of rows) addOne(rec, tally);
  return tally;
}

function addOne(rec, tally) {
  tally.calls += 1;

  // The Ringy payload variants we've seen
  const talkSec =
    Number(rec.talkTimeSec || rec.talkSeconds || rec.duration || 0);
  const loggedSec =
    Number(
      rec.totalDurationSec ||
      rec.loggedSeconds ||
      rec.duration ||
      talkSec ||
      0
    );

  tally.talkSec += talkSec;
  tally.loggedSec += loggedSec;

  if (rec.leadId) tally.leads += 1;
  if (rec.soldProductId || (Array.isArray(rec.soldProducts) && rec.soldProducts.length))
    tally.sold += 1;
}

async function fetchAllPages({ url, apiKey, startUTC, endUTC }) {
  const out = [];
  let page = 1;
  const pageSize = 200; // stay well under any cap
  // POST body shape Ringy expects
  while (true) {
    const body = {
      apiKey,
      startDate: startUTC,
      endDate: endUTC,
      page,
      pageSize
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      // bubble the upstream error for easier debugging
      const text = await r.text().catch(() => "");
      throw new Error(`Ringy ${r.status}: ${text || "Bad Request"}`);
    }

    const data = await r.json();
    const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
    out.push(...rows);

    if (rows.length < pageSize) break; // last page
    page += 1;
  }
  return out;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
