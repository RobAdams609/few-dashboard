// netlify/functions/calls_by_agent.js
// Weekly (Fri 12:00am ET -> next Fri 12:00am ET) per-agent: calls, talkMin, loggedMin, leads, sold.
// Uses env:
//   RINGY_CALL_DETAIL_URL      = https://app.ringy.com/api/public/external/get-calls
//   RINGY_API_KEY_CALL_DETAIL  = <your single Call Data API key>

import { json } from "./_util.js"; // same helper used elsewhere

const ET_TZ = "America/New_York";

function weekRangeET() {
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ }));
  const d = nowET.getDay();                 // Sun=0..Sat=6
  const sinceFri = (d + 2) % 7;             // back to Friday
  const start = new Date(nowET); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate() + 7);
  return [start, end];
}
const toRingy = (d) =>
  new Date(d).toLocaleString("en-US", { timeZone: "UTC", hour12: false })
    .replace(",", "").replace(/\//g, "-")
    .replace(/(\d+)-(\d+)-(\d+)/, (_, m, d2, y) => `${y}-${String(m).padStart(2,"0")}-${String(d2).padStart(2,"0")}`) // YYYY-MM-DD
    .replace(" ", " ") + "";

export default async function handler(req, ctx) {
  try {
    const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;
    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return json(500, { error: "Missing RINGY_CALL_DETAIL_URL or RINGY_API_KEY_CALL_DETAIL" });
    }

    // Load your roster so we can aggregate by email/name you already control
    const rosterRes = await fetch(`${ctx.site.url || ""}/headshots/roster.json`, { cache: "no-store" }).catch(()=>null);
    const rosterRaw = rosterRes && rosterRes.ok ? await rosterRes.json() : [];
    const roster = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
    const emailToDisplay = new Map(
      roster.map(a => [String(a.email||"").trim().toLowerCase(), String(a.name||"").trim()])
    );
    const nameToDisplay = new Map(
      roster.map(a => [String(a.name||"").trim().toLowerCase(), String(a.name||"").trim()])
    );

    // Week window in ET, but Ringy expects UTC-like strings
    const [ws, we] = weekRangeET();
    const startDate = toRingy(ws).slice(0, 10) + " 00:00:00";
    const endDate   = toRingy(we).slice(0, 10) + " 00:00:00";

    // One POST to Ringy (large limit); Ringy returns 400 if unknown fields are passed.
    const body = {
      apiKey: RINGY_API_KEY_CALL_DETAIL,
      startDate,
      endDate,
      limit: 5000
    };

    const r = await fetch(RINGY_CALL_DETAIL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const text = await r.text().catch(()=> "");
      return json(502, { error: "upstream error", status: r.status, body: text || "Bad Request" });
    }

    const rows = await r.json().catch(()=>[]);
    // Normalize fields that Ringy returns (some tenants vary a bit)
    // Expected: each row has callDirection ("INBOUND"/"OUTBOUND"), toPhoneNumber, fromPhoneNumber,
    // maybe agentEmail, agentName, duration (seconds), and optionally talkSeconds/loggedSeconds/leads/sold flags.
    const agg = new Map(); // displayName -> { calls,talkMin,loggedMin,leads,sold }
    let team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const c of Array.isArray(rows) ? rows : []) {
      const agentEmail = String(c.agentEmail || "").trim().toLowerCase();
      const agentName  = String(c.agentName  || "").trim().toLowerCase();

      const display =
        (agentEmail && emailToDisplay.get(agentEmail)) ||
        (agentName  && nameToDisplay.get(agentName))  ||
        "Unknown";

      const durationSec = Number(
        c.talkSeconds ?? c.duration ?? c.callDuration ?? 0
      );
      const loggedSec = Number(c.loggedSeconds ?? 0);
      const leads     = Number(c.leads ?? 0);
      const sold      = Number(c.sold ?? 0);

      const cur = agg.get(display) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls    += 1;
      cur.talkMin  += durationSec/60;
      cur.loggedMin+= loggedSec/60;
      cur.leads    += leads;
      cur.sold     += sold;
      agg.set(display, cur);

      team.calls    += 1;
      team.talkMin  += durationSec/60;
      team.loggedMin+= loggedSec/60;
      team.leads    += leads;
      team.sold     += sold;
    }

    // Emit in your expected shape
    const perAgent = Array.from(agg.entries()).map(([name, v]) => ({
      name,
      calls: Math.round(v.calls),
      talkMin: Math.round(v.talkMin),
      loggedMin: Math.round(v.loggedMin),
      leads: Math.round(v.leads),
      sold: Math.round(v.sold),
    })).sort((a,b) => a.name.localeCompare(b.name));

    return json(200, {
      startDate, endDate,
      team: {
        calls: Math.round(team.calls),
        talkMin: Math.round(team.talkMin),
        loggedMin: Math.round(team.loggedMin),
        leads: Math.round(team.leads),
        sold: Math.round(team.sold),
      },
      perAgent
    });
  } catch (e) {
    return json(500, { error: e?.message || String(e) });
  }
}
