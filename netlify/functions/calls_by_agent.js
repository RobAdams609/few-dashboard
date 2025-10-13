// Weekly calls/talk/logged/leads/sold per agent, WITHOUT relying on phone numbers.
// Source: Ringy "get-call-recordings" (POST preferred, with robust GET fallback).
// Joins in the dashboard are by agent NAME (your dashboard already maps by name).

export default async function handler(req, ctx) {
  try {
    const { RINGY_RECORDINGS_URL, RINGY_API_KEY_RECORDINGS } = process.env;
    if (!RINGY_RECORDINGS_URL || !RINGY_API_KEY_RECORDINGS) {
      return j(500, { error: "Missing RINGY_RECORDINGS_URL or RINGY_API_KEY_RECORDINGS" });
    }

    // Weekly window (Fri 12:00am ET → next Fri 12:00am ET), expressed in UTC "YYYY-MM-DD HH:mm:ss"
    const { startUTC, endUTC } = weeklyWindowETasUTC();

    // ---- Fetch recordings (POST, then GET as fallback) ----
    let rows = [];
    let postErr = "", getErr = "";

    try {
      const body = {
        apiKey: RINGY_API_KEY_RECORDINGS,
        startDate: startUTC, // UTC "YYYY-MM-DD HH:mm:ss"
        endDate: endUTC,
        limit: 5000
      };
      const r = await fetch(RINGY_RECORDINGS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`${r.status}`);
      rows = await coerceList(await r.json());
    } catch (e) {
      postErr = String(e?.message || e);
      // GET style: /get-call-recordings?startDate=...&endDate=...&limit=5000
      try {
        const u = new URL(RINGY_RECORDINGS_URL);
        u.searchParams.set("startDate", startUTC);
        u.searchParams.set("endDate", endUTC);
        u.searchParams.set("limit", "5000");
        const r2 = await fetch(u.toString(), {
          headers: { "x-api-key": RINGY_API_KEY_RECORDINGS, "accept":"application/json" }
        });
        if (!r2.ok) throw new Error(`${r2.status}`);
        rows = await coerceList(await r2.json());
      } catch (e2) {
        getErr = String(e2?.message || e2);
        return j(502, {
          error: "fetch failed",
          message: `POST ${postErr || ""} ; GET ${getErr || ""}`,
          perAgent: [],
          team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }
        });
      }
    }

    // ---- Aggregate per agent (by NAME) ----
    const per = new Map();
    const team = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

    for (const r of rows) {
      const agentName = getAgentName(r) || "Unknown";
      const talkMin   = getTalkMinutes(r);
      const loggedMin = getLoggedMinutes(r);
      const leads     = num(r?.leads, r?.leadCount, 0); // usually 0 on recordings
      const sold      = num(r?.sold, r?.deals, 0);      // usually 0 on recordings

      const cur = per.get(agentName) || { name: agentName, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      cur.calls     += 1;
      cur.talkMin   += talkMin;
      cur.loggedMin += loggedMin;
      cur.leads     += leads;
      cur.sold      += sold;
      per.set(agentName, cur);

      team.calls     += 1;
      team.talkMin   += talkMin;
      team.loggedMin += loggedMin;
      team.leads     += leads;
      team.sold      += sold;
    }

    return j(200, {
      startDate: toISOZ(startUTC),
      endDate:   toISOZ(endUTC),
      team: {
        calls: Math.round(team.calls),
        talkMin: Math.round(team.talkMin),
        loggedMin: Math.round(team.loggedMin),
        leads: Math.round(team.leads),
        sold: Math.round(team.sold),
      },
      perAgent: Array.from(per.values()).sort((a,b)=> b.calls - a.calls)
    });

  } catch (err) {
    return j(500, {
      error: "fetch failed",
      message: String(err?.message || err),
      perAgent: [],
      team: { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }
    });
  }
}

/* ---------------- helpers ---------------- */

function j(status, body){
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

// roster join in the front-end works by name already; give the most likely name field we can find
function getAgentName(x){
  // direct strings
  const s = pickStr(
    x?.agent, x?.agentName, x?.agent_name,
    x?.user, x?.userName, x?.username,
    x?.owner, x?.ownerName, x?.assignedTo, x?.rep, x?.representative
  );
  if (s) return cleanName(s);

  // nested { name: "..." }
  const nest = pickStr(
    x?.agent?.name, x?.user?.name, x?.owner?.name, x?.assignedTo?.name, x?.rep?.name
  );
  if (nest) return cleanName(nest);

  return ""; // will become "Unknown"
}

function cleanName(n){
  return String(n||"").trim().replace(/\s+/g," ");
}

// try a bunch of possible talk duration fields (seconds or minutes or h:mm)
function getTalkMinutes(x){
  return minutes(
    x?.talkMinutes, x?.talk_min, x?.talkTimeMin, x?.talk_time_min,
    x?.talkTime, x?.talk_time, x?.durationTalk, x?.duration_talk,
    x?.callDurationTalk, x?.call_talk_duration,
    x?.duration, x?.callDuration
  );
}

// try a bunch for total/logged minutes
function getLoggedMinutes(x){
  return minutes(
    x?.loggedMinutes, x?.totalMinutes, x?.durationMin, x?.duration_min,
    x?.duration, x?.callDuration
  );
}

function num(...vals){
  for (const v of vals){
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function minutes(...vals){
  for (const v of vals){
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      // heuristic: large numbers are probably seconds
      return v > 600 ? Math.round(v/60) : v;
    }
    if (typeof v === "string"){
      const m = v.match(/^(\d+):(\d{2})$/); // "h:mm"
      if (m) return Number(m[1])*60 + Number(m[2]);
      const n = Number(v);
      if (Number.isFinite(n)) return n > 600 ? Math.round(n/60) : n;
    }
  }
  return 0;
}

function pickStr(...vals){
  for (const v of vals){
    if (!v) continue;
    if (typeof v === "string") return v;
    if (typeof v === "object" && typeof v.name === "string") return v.name;
  }
  return "";
}

function coerceList(payload){
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.records && Array.isArray(payload.records)) return payload.records;
  return [];
}

// Friday 00:00 ET → next Friday 00:00 ET, formatted as UTC "YYYY-MM-DD HH:mm:ss"
function weeklyWindowETasUTC(){
  const ET = "America/New_York";
  const now = new Date(new Date().toLocaleString("en-US",{ timeZone: ET }));
  const day = now.getDay(); // Sun=0..Sat=6
  const sinceFri = (day + 2) % 7;
  const startET = new Date(now); startET.setHours(0,0,0,0); startET.setDate(startET.getDate() - sinceFri);
  const endET   = new Date(startET); endET.setDate(endET.getDate() + 7);
  return {
    startUTC: toUTCString(startET),
    endUTC:   toUTCString(endET)
  };
}

// -> "YYYY-MM-DD HH:mm:ss" in UTC
function toUTCString(d){
  const z = new Date(d).toISOString(); // "YYYY-MM-DDTHH:mm:ss.sssZ"
  return z.slice(0,19).replace("T"," ");
}
function toISOZ(s) { // from "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ssZ"
  return s.replace(" ","T") + "Z";
}
