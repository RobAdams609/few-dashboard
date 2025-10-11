// /netlify/functions/calls_by_agent.js
// Aggregates Ringy call logs for THIS WEEK (Fri 12:00am ET -> next Fri 12:00am ET)
// and returns per-agent totals the dashboard expects.

const RINGY_URL = "https://app.ringy.com/api/public/external/get-recordings";
// Keep your real API key in an env var (Netlify UI → Site settings → Environment)
// Name: RINGY_API_KEY
const API_KEY   = process.env.RINGY_API_KEY || "REPLACE_ME";

// --- Helpers ---
const ET_TZ = "America/New_York";
const toET = (d) => new Date(new Date(d).toLocaleString("en-US", { timeZone: ET_TZ }));
function weekRangeET() {
  const now = toET(new Date());
  const day = now.getDay();             // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;       // days back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                   // [inclusive, exclusive)
}
function fmtDT(dt) {
  // Ringy is happy with "YYYY-MM-DD HH:mm:ss"
  const pad = (n) => String(n).padStart(2,"0");
  const y = dt.getFullYear();
  const m = pad(dt.getMonth()+1);
  const d = pad(dt.getDate());
  const h = pad(dt.getHours());
  const i = pad(dt.getMinutes());
  const s = pad(dt.getSeconds());
  return `${y}-${m}-${d} ${h}:${i}:${s}`;
}

function safeNum(x){ return Number.isFinite(Number(x)) ? Number(x) : 0; }

// Core aggregation from Ringy "recordings" payload
function aggregate(records) {
  // Expect each record to include: owner_name or agent_name / email, duration (sec), talkTime (sec), lead? sold?
  // Ringy payloads vary. We defensively read common shapes and default to zero.
  const byAgent = new Map();
  let teamCalls = 0, teamTalkMin = 0, teamLoggedMin = 0;

  for (const r of records) {
    const name = String(r.owner_name || r.agent_name || r.user_name || r.agent || "").trim();
    const email = String(r.owner_email || r.agent_email || r.email || "").trim().toLowerCase();
    const key = (email || name).toLowerCase();
    if (!key) continue;

    const talkSec   = safeNum(r.talkTime || r.talk_seconds || r.talk_sec || r.duration || 0);
    const loggedSec = safeNum(r.logged_seconds || r.total_seconds || r.duration || 0);
    const isLead    = Boolean(r.is_lead || r.lead || false);
    const isSold    = Boolean(r.is_sold || r.sold || false);

    const row = byAgent.get(key) || {
      name, email, calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0
    };
    row.calls     += 1;
    row.talkMin   += talkSec/60;
    row.loggedMin += loggedSec/60;
    row.leads     += isLead ? 1 : 0;
    row.sold      += isSold ? 1 : 0;

    byAgent.set(key, row);

    teamCalls    += 1;
    teamTalkMin  += talkSec/60;
    teamLoggedMin+= loggedSec/60;
  }

  // Format output the dashboard expects
  const perAgent = [...byAgent.values()].map(a => ({
    name: a.name,
    email: a.email,
    calls: Math.round(a.calls),
    talkMin: Math.round(a.talkMin),
    loggedMin: Math.round(a.loggedMin),
    leads: Math.round(a.leads),
    sold: Math.round(a.sold),
  }));

  perAgent.sort((x,y)=> (y.calls - x.calls) || (y.talkMin - x.talkMin));

  return {
    perAgent,
    team: {
      calls: Math.round(teamCalls),
      talkMin: Math.round(teamTalkMin),
      loggedMin: Math.round(teamLoggedMin),
    }
  };
}

exports.handler = async (event) => {
  try {
    const [START, END] = weekRangeET(); // Friday window in ET
    const startDate = fmtDT(START);
    const endDate   = fmtDT(END);

    // Single wide query → group locally. Avoids per-agent 404s.
    const body = {
      apiKey: API_KEY,
      startDate,  // "YYYY-MM-DD HH:mm:ss" in ET
      endDate
      // add other Ringy filters here if you use them (queues, users, etc.)
    };

    const resp = await fetch(RINGY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      // Bubble up enough context so you can see it in Netlify logs
      const txt = await resp.text().catch(()=>"<no body>");
      return {
        statusCode: 200,
        body: JSON.stringify({
          startDate, endDate,
          agents: [],
          team: { calls:0, talkMin:0, loggedMin:0 },
          warning: `Ringy response ${resp.status}: ${txt.slice(0,200)}`
        })
      };
    }

    const data = await resp.json().catch(()=> ({}));
    // Ringy often returns an array in `recordings` or the root itself is an array.
    const records =
      Array.isArray(data?.recordings) ? data.recordings :
      Array.isArray(data)             ? data :
      Array.isArray(data?.data)       ? data.data : [];

    const agg = aggregate(records);

    return {
      statusCode: 200,
      body: JSON.stringify({
        startDate, endDate,
        perAgent: agg.perAgent,
        team: agg.team
      })
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        perAgent: [],
        team: { calls:0, talkMin:0, loggedMin:0 },
        error: String(err && err.message || err)
      })
    };
  }
};
