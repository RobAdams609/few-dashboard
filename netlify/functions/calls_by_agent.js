// netlify/functions/calls_by_agent.js  (CommonJS)
// Weekly activity: calls, talkMin, loggedMin, leads, sold (team + perAgent)
// Robust to UTC/ET drift, shared numbers (maps by lead -> agent email), and empty fields

// ── ENV (already in your Netlify UI) ───────────────────────────────────────────
// RINGY_RECORDINGS_URL     -> https://app.ringy.com/api/public/external/get-call-recordings
// RINGY_API_KEY_RECORDINGS -> your "recordings" API key
// RINGY_CALL_DETAIL_URL    -> https://app.ringy.com/api/public/external/get-calls
// RINGY_API_KEY_CALL_DETAIL-> your "call detail" API key
// RINGY_LEAD_URL           -> https://app.ringy.com/api/public/external/get-lead
// RINGY_API_KEY_LEADS      -> your "leads" API key

const fetch = require("node-fetch");

// Eastern Time for weekly window (Fri→Fri)
const ET_TZ = "America/New_York";
const PAGE_LIMIT = 5000; // upper safe cap for recordings pulls

// ── tiny time helpers ─────────────────────────────────────────────────────────
function pad(n){ return String(n).padStart(2,"0"); }
function toET(d=new Date()){
  // create a date "view" in ET by shifting with Intl (we only need Y-M-D)
  const z = new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(d);
  const by = Object.fromEntries(z.map(p => [p.type, p.value]));
  const iso = `${by.year}-${by.month}-${by.day}T00:00:00`;
  return new Date(iso); // local midnight (we'll convert to UTC strings below)
}
function startOfWeekET(d=new Date()){
  // Week = Fri 00:00 ET .. next Fri 00:00 ET
  const et = toET(d);
  const dow = new Intl.DateTimeFormat("en-US", { weekday:"short", timeZone: ET_TZ }).format(et); // e.g. "Tue"
  const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  const sinceFri = (map[dow] + 2) % 7; // distance back to Friday
  const start = new Date(et); start.setDate(start.getDate() - sinceFri);
  start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+7);
  return { start, end };
}
function toUTCStringYMDHMS(d){
  // Return "YYYY-MM-DD HH:mm:ss" in UTC
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth()+1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function postJSON(url, body){
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// ── Load roster for email→agent mapping ───────────────────────────────────────
async function loadRoster(){
  try{
    const r = await fetch(`${process.env.URL || ""}/headshots/roster.json`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.agents || []);
    // normalize emails to lowercase
    return list.map(a => ({ name: a.name || "", email: String(a.email||"").toLowerCase() }));
  }catch(e){
    return [];
  }
}

// ── Netlify handler ───────────────────────────────────────────────────────────
exports.handler = async function(){
  try{
    // 1) compute weekly ET window, send UTC to Ringy
    const { start, end } = startOfWeekET(new Date());
    const startUTC = toUTCStringYMDHMS(start);
    const endUTC   = toUTCStringYMDHMS(end);

    // 2) load roster for attribution by lead->email
    const roster = await loadRoster();

    // 3) pull recordings for the window (this gives us the callId list)
    const recordings = await postJSON(
      process.env.RINGY_RECORDINGS_URL,
      {
        apiKey: process.env.RINGY_API_KEY_RECORDINGS,
        startDate: startUTC,
        endDate: endUTC,
        limit: PAGE_LIMIT
      }
    ).catch(() => []);

    // 4) aggregate
    const team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }; // sold/leads are placeholders; sold is covered by /api/team_sold
    const perAgentMap = new Map(); // email -> stats

    // helper to get/ensure agent bucket by email
    function ensureAgent(email, name=""){
      const key = String(email||"").toLowerCase();
      if (!perAgentMap.has(key)){
        perAgentMap.set(key, { name: name||email||"Unknown", email: key, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 });
      }
      return perAgentMap.get(key);
    }
    // quick lookup by email from roster
    function lookupAgentByEmail(email){
      const e = String(email||"").toLowerCase();
      return roster.find(a => a.email === e) || null;
    }

    // 5) for each recording, fetch callDetail; then (if present) fetch lead -> email for agent mapping
    for (const rec of Array.isArray(recordings)? recordings : []){
      const callId = rec && rec.callId;
      if (!callId) continue;

      let detail = null;
      try{
        detail = await postJSON(process.env.RINGY_CALL_DETAIL_URL, {
          apiKey: process.env.RINGY_API_KEY_CALL_DETAIL,
          callId
        });
      }catch(_){ /* ignore a bad call */ }

      // duration (seconds) -> talkMin, loggedMin (we use same for now; refine if Ringy returns separate fields)
      const durSec = Math.max(0, Number(detail && detail.duration || 0));
      const talkMin = durSec / 60;
      const loggedMin = talkMin;

      // team totals (always include)
      team.calls += 1;
      team.talkMin += talkMin;
      team.loggedMin += loggedMin;

      // try to attribute by lead owner email
      let agentEmail = "";
      let agentName = "";

      const leadId = detail && detail.leadId;
      if (leadId){
        try{
          const lead = await postJSON(process.env.RINGY_LEAD_URL, {
            apiKey: process.env.RINGY_API_KEY_LEADS,
            leadId
          });
          // Try fields that could reflect agent/owner
          // If Ringy returns an owner email/agent email on the lead, use it.
          // (If not present, we can try to map lead email to an agent email in roster; if still not, leave unassigned.)
          const possibleEmail =
            (lead && (lead.ownerEmail || lead.agentEmail || lead.email)) ? String(lead.ownerEmail || lead.agentEmail || lead.email) : "";

          const hit = lookupAgentByEmail(possibleEmail);
          if (hit){
            agentEmail = hit.email;
            agentName  = hit.name;
          }
        }catch(_){}
      }

      if (agentEmail){
        const a = ensureAgent(agentEmail, agentName);
        a.calls += 1;
        a.talkMin += talkMin;
        a.loggedMin += loggedMin;
      }
    }

    // Finalize perAgent array (only agents with activity)
    const perAgent = Array.from(perAgentMap.values())
      .sort((a,b)=> (b.calls||0) - (a.calls||0));

    const payload = {
      startDate: toUTCStringYMDHMS(start), // UTC, ISO-like
      endDate:   toUTCStringYMDHMS(end),
      team: {
        calls: Math.round(team.calls),
        talkMin: Math.round(team.talkMin),
        loggedMin: Math.round(team.loggedMin),
        leads: 0,
        sold: 0
      },
      perAgent
    };

    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
      body: JSON.stringify(payload)
    };

  }catch(e){
    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        startDate: null, endDate: null,
        team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 },
        perAgent: [],
        error: String(e && e.message || e)
      })
    };
  }
};
