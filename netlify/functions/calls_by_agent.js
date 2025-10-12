// netlify/functions/calls_by_agent.js
// Aggregates WEEK (Fri 12:00am ET → next Fri 12:00am ET) per-agent calls,
// talk minutes, logged minutes, and leads. Sold is left 0 here; we take "sold"
// from the team_sold function on the frontend for conversion accuracy.


const ET_TZ = "America/New_York";

// --- CONFIG ---
// Set these in Netlify > Site settings > Environment variables
// RINGY_BASE    e.g. "https://api.ringy.com" (adjust to your real base URL)
// RINGY_TOKEN   e.g. "Bearer xxxxx" or just the token depending on your API
// RINGY_CALLS_PATH e.g. "/v2/calls" (adjust to your real endpoint)
// RINGY_PAGE_SIZE  e.g. "200" (optional)
const {
  RINGY_BASE,
  RINGY_TOKEN,
  RINGY_CALLS_PATH = "/v2/calls",
  RINGY_PAGE_SIZE = "200",
} = process.env;

const authHeader = () =>
  RINGY_TOKEN?.toLowerCase().startsWith("bearer ")
    ? RINGY_TOKEN
    : `Bearer ${RINGY_TOKEN}`;

function toET(d) {
  // Normalize any date-like value to an ET Date instance
  return new Date(new Date(d).toLocaleString("en-US", { timeZone: ET_TZ }));
}

function weekRangeET() {
  const now = toET(new Date());
  const day = now.getDay(); // Sun=0..Sat=6
  // Distance back to Friday 00:00 (Fri is 5)
  const sinceFri = (day + 2) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - sinceFri);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return [start, end]; // [inclusive, exclusive)
}

function mmss(totalSeconds) {
  const secs = Math.max(0, Math.round(Number(totalSeconds || 0)));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return { hours: h, minutes: m };
}

function safeNum(n) {
  n = Number(n || 0);
  return Number.isFinite(n) ? n : 0;
}

// ---- Adjust this mapper to your provider’s response shape ----
// It should return: { agentName, agentEmail, startedAt: Date, durationSec: number, disposition?: string }
function mapCall(rec) {
  // EXAMPLES (customize for your API fields):
  // const agentName  = rec.user?.name || rec.agent?.name || rec.ownerName || "";
  // const agentEmail = (rec.user?.email || rec.agent?.email || rec.ownerEmail || "").toLowerCase();
  // const startedAt  = rec.started_at || rec.startedAt || rec.start_time;
  // const durationSec = rec.duration || rec.talk_seconds || 0;
  // const disposition = rec.disposition || rec.outcome || "";

  // Placeholder generic mapping:
  const agentName = (rec.agentName || rec.userName || rec.ownerName || "").trim();
  const agentEmail = String(rec.agentEmail || rec.userEmail || rec.ownerEmail || "")
    .trim()
    .toLowerCase();
  const startedAt = rec.startedAt || rec.start_time || rec.time || rec.date;
  const durationSec = safeNum(rec.duration || rec.talk_seconds || rec.talkSec || 0);
  const disposition = rec.disposition || rec.outcome || rec.result || "";
  return { agentName, agentEmail, startedAt, durationSec, disposition };
}

// For some teams, "lead" = positive outcome; customize as needed
function isLead(disposition) {
  if (!disposition) return false;
  const s = String(disposition).toLowerCase();
  return (
    s.includes("lead") ||
    s.includes("appt") ||
    s.includes("appointment") ||
    s.includes("interested")
  );
}

async function fetchRingyPage({ page = 1, pageSize, startISO, endISO }) {
  const url = new URL(RINGY_CALLS_PATH, RINGY_BASE);
  // Adjust param names to your API (these are examples)
  url.searchParams.set("per_page", pageSize);
  url.searchParams.set("page", page);
  url.searchParams.set("start", startISO); // or "from"
  url.searchParams.set("end", endISO); // or "to"

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 60_000,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Ringy ${res.status} ${res.statusText} – ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listAllCalls({ startISO, endISO }) {
  const pageSize = Number(RINGY_PAGE_SIZE) || 200;
  let page = 1;
  const out = [];

  for (;;) {
    const data = await fetchRingyPage({ page, pageSize, startISO, endISO });

    // Adjust to your API’s paging shape
    const records = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    out.push(...records);

    const total = Number(data?.meta?.total || data?.total || 0);
    const have = page * pageSize;
    if (!total || have >= total || records.length < pageSize) break;
    page += 1;
  }
  return out;
}

export const handler = async () => {
  try {
    if (!RINGY_BASE || !RINGY_TOKEN) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing RINGY_BASE or RINGY_TOKEN env var" }),
      };
    }

    const [WSTART, WEND] = weekRangeET();
    const startISO = WSTART.toISOString();
    const endISO = WEND.toISOString();

    const raw = await listAllCalls({ startISO, endISO });

    // Aggregate per agent
    const byAgentKey = new Map();
    for (const rec of raw) {
      const m = mapCall(rec);
      const when = m.startedAt ? toET(m.startedAt) : null;
      if (!when || when < WSTART || when >= WEND) continue;

      // key: prefer email; fallback to name
      const key = (m.agentEmail || m.agentName || "").trim().toLowerCase();
      if (!key) continue;

      const cur =
        byAgentKey.get(key) || { name: m.agentName || "", email: m.agentEmail || "", calls: 0, talkSec: 0, loggedSec: 0, leads: 0, sold: 0 };
      cur.name = cur.name || m.agentName || "";
      cur.email = cur.email || m.agentEmail || "";

      cur.calls += 1;
      cur.talkSec += safeNum(m.durationSec);          // raw talk time
      cur.loggedSec += safeNum(m.durationSec);        // if you track separate "logged" minutes, adjust here
      if (isLead(m.disposition)) cur.leads += 1;

      byAgentKey.set(key, cur);
    }

    const perAgent = [...byAgentKey.values()].map(a => {
      // to minutes
      const talkMin = Math.round(a.talkSec / 60);
      const loggedMin = Math.round(a.loggedSec / 60);
      return {
        name: a.name,
        email: (a.email || "").toLowerCase(),
        calls: a.calls,
        talkMin,
        loggedMin,
        leads: a.leads,
        sold: 0, // sold comes from /team_sold in the frontend
      };
    });

    const team = perAgent.reduce(
      (s, r) => {
        s.calls += r.calls;
        s.talkMin += r.talkMin;
        s.loggedMin += r.loggedMin;
        s.leads += r.leads;
        return s;
      },
      { calls: 0, talkMin: 0, loggedMin: 0, leads: 0 }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        startDate: WSTART.toISOString(),
        endDate: WEND.toISOString(),
        perAgent,
        team,
      }),
    };
  } catch (err) {
    // Never fail the board—return empty but descriptive payload.
    return {
      statusCode: 200,
      body: JSON.stringify({
        error: String(err?.message || err),
        perAgent: [],
        team: { calls: 0, talkMin: 0, loggedMin: 0, leads: 0 },
      }),
    };
  }
};
