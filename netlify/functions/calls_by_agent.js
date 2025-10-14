// netlify/functions/calls_by_agent.js  (CommonJS)
// Aggregates weekly call stats per agent (if available) and ALWAYS merges
// a Sold-deals count from Ringy "get-lead-sold-products".
//
// Env needed (already in Netlify):
//   RINGY_CALL_DETAIL_URL     -> https://app.ringy.com/api/public/external/get-calls (or your call source)
//   RINGY_API_KEY_CALL_DETAIL -> your "Call data" API key
//   RINGY_SALES_ENDPOINT      -> https://app.ringy.com/api/public/external/get-lead-sold-products
//   RINGY_API_KEY_SOLD        -> your "Sold products" API key
//
// Output shape:
// { startDate, endDate,
//   team: { calls, talkMin, loggedMin, leads, sold },
//   perAgent: [{ name, email, calls, talkMin, loggedMin, leads, sold }]
// }

const ET_TZ = "America/New_York";
const PAGE_LIMIT = 2000; // conservative cap for call results

// ---------- helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }
function toUTCString(d) {
  const y  = d.getUTCFullYear();
  const m  = pad(d.getUTCMonth() + 1);
  const dy = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}-${m}-${dy} ${hh}:${mm}:${ss}`;
}
function toET(now = new Date()) {
  // normalize to ET wall clock for the Friday window calc
  return new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
}
function weekRangeET() {
  // Friday 12:00am ET (inclusive) → next Friday 12:00am ET (exclusive)
  const now = toET();
  const day = now.getDay();              // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;        // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate() + 7);
  return [start, end];
}
async function postJSON(url, bodyObj) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { ok: r.ok, status: r.status, json, sample: text.slice(0, 400) };
}

// safe number
const N = v => (v == null || isNaN(v)) ? 0 : Number(v);

// ---------- main ----------
module.exports.handler = async function handler() {
  const {
    RINGY_CALL_DETAIL_URL,
    RINGY_API_KEY_CALL_DETAIL,
    RINGY_SALES_ENDPOINT,
    RINGY_API_KEY_SOLD
  } = process.env;

  // Week window (send to Ringy in UTC)
  const [startET, endET] = weekRangeET();
  const startUTC = toUTCString(startET);
  const endUTC   = toUTCString(endET);

  const team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
  const perAgent = new Map(); // key = normalized agent name

  // ---- 1) Calls (best-effort; if Ringy denies, we still return sold counts) ----
  // If your tenant uses recordings endpoint instead, swap URL/key to that source.
  if (RINGY_CALL_DETAIL_URL && RINGY_API_KEY_CALL_DETAIL) {
    try {
      const body = { apiKey: RINGY_API_KEY_CALL_DETAIL, startDate: startUTC, endDate: endUTC, limit: PAGE_LIMIT };
      const res = await postJSON(RINGY_CALL_DETAIL_URL, body);

      if (res.ok && Array.isArray(res.json)) {
        // Many Ringy tenants return an array directly; adapt as needed if yours nests under .data
        for (const row of res.json) {
          // Attempt to find an agent identity on the row
          // (Different tenants expose different fields; we try a few).
          const name =
            (row.agentName || row.userName || row.agent || row.name || "").toString().trim();
          const email =
            (row.agentEmail || row.userEmail || row.email || "").toString().trim();

          // If the call payload does not include agent identity, we can’t attribute calls per agent.
          // We skip attribution but will still surface team totals if we can infer metrics.
          const key = name.toLowerCase();

          // Basic counters (fallbacks for duration fields)
          // NOTE: adapt these to your actual payload field names if needed:
          const callCount  = 1; // one record per call
          const talkSec    = N(row.talkDurationSec || row.duration || row.talkSeconds);
          const talkMin    = talkSec / 60;
          const loggedMin  = N(row.loggedMinutes || 0);
          const leads      = 0; // unknown from call payload
          const sold       = 0; // merged later

          team.calls    += callCount;
          team.talkMin  += talkMin;
          team.loggedMin+= loggedMin;
          team.leads    += leads; // usually 0 from calls-only

          if (key) {
            const cur = perAgent.get(key) || {
              name, email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0
            };
            cur.calls     += callCount;
            cur.talkMin   += talkMin;
            cur.loggedMin += loggedMin;
            cur.leads     += leads;
            perAgent.set(key, cur);
          }
        }
      } else {
        // Keep going; we’ll still merge sold counts below.
        console.warn("Ringy calls not OK:", res.status, res.sample);
      }
    } catch (err) {
      console.warn("Calls fetch error:", err);
    }
  }

  // ---- 2) Sold merge (authoritative for deals count, also fine if calls were empty) ----
  try {
    if (!RINGY_SALES_ENDPOINT || !RINGY_API_KEY_SOLD) throw new Error("Missing sold endpoint/key");

    const soldRes = await postJSON(RINGY_SALES_ENDPOINT, {
      apiKey: RINGY_API_KEY_SOLD,
      startDate: startUTC,
      endDate: endUTC,
      limit: 5000,
    });

    if (soldRes.ok) {
      const rows = Array.isArray(soldRes.json) ? soldRes.json
                 : Array.isArray(soldRes.json?.data) ? soldRes.json.data
                 : [];

      const perNameCount = new Map();

      for (const s of rows) {
        // Normalize the agent name coming from sold-products endpoint
        const name = (s.agent || s.agent_name || s.userName || s.user_name || "").toString().trim();
        if (!name) continue;
        const k = name.toLowerCase();
        perNameCount.set(k, (perNameCount.get(k) || 0) + 1);
      }

      // Merge into the perAgent map; create rows if missing so we at least show Sold
      for (const [k, count] of perNameCount.entries()) {
        const cur = perAgent.get(k) || { name: k, email: "", calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
        cur.sold = N(cur.sold) + count;
        // Ensure we keep a nice display name (capitalize basic)
        if (!cur.name || cur.name === k) {
          cur.name = k.split(" ").map(w => w ? (w[0].toUpperCase() + w.slice(1)) : "").join(" ").trim();
        }
        perAgent.set(k, cur);
        team.sold += count;
      }
    } else {
      console.warn("Sold merge not OK:", soldRes.status, soldRes.sample);
    }
  } catch (err) {
    console.warn("Sold merge error:", err);
  }

  // Round team mins so the UI doesn’t show decimals
  team.talkMin   = Math.round(team.talkMin);
  team.loggedMin = Math.round(team.loggedMin);

  // Emit sorted array (by name), matching your dashboard expectations
  const perAgentOut = Array.from(perAgent.values())
    .map(a => ({
      name: a.name || "",
      email: a.email || "",
      calls: Math.round(N(a.calls)),
      talkMin: Math.round(N(a.talkMin)),
      loggedMin: Math.round(N(a.loggedMin)),
      leads: Math.round(N(a.leads)),
      sold: Math.round(N(a.sold)),
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const payload = {
    startDate: startUTC,
    endDate: endUTC,
    team,
    perAgent: perAgentOut
  };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  };
};
