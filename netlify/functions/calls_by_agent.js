// netlify/functions/calls_by_agent.js
// Source of truth for weekly calls/talk/logged per agent.
// Pulls from Ringy "get-call-recordings" using your env:
//   RINGY_RECORDINGS_URL  -> https://app.ringy.com/api/public/external/get-call-recordings
//   RINGY_API_KEY_RECORDINGS -> your recordings API key

export default async function handler(req, context) {
  try {
    const { RINGY_RECORDINGS_URL, RINGY_API_KEY_RECORDINGS } = process.env;
    if (!RINGY_RECORDINGS_URL || !RINGY_API_KEY_RECORDINGS) {
      return j(500, { error: "Missing RINGY_RECORDINGS_URL or RINGY_API_KEY_RECORDINGS" });
    }

    // Weekly Friday 12:00am ET → next Friday 12:00am ET
    const { startUTC, endUTC } = weeklyWindowETasUTCStrings();

    // ---- First try: POST with JSON body (most Ringy accounts expect this) ----
    let rows = null, postErrText = "";
    try {
      const postBody = {
        apiKey: RINGY_API_KEY_RECORDINGS,
        startDate: startUTC,   // UTC, "YYYY-MM-DD HH:mm:ss"
        endDate:   endUTC,     // UTC, "YYYY-MM-DD HH:mm:ss"
        limit: 5000            // avoid pagination; Ringy supports "limit"
      };
      const r = await fetch(RINGY_RECORDINGS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(postBody)
      });
      if (!r.ok) {
        postErrText = await safeText(r);
        throw new Error(`POST ${r.status}`);
      }
      const data = await r.json().catch(() => ({}));
      rows = normalizeList(data);
    } catch (e) {
      // will try GET next
    }

    // ---- Fallback: GET with querystring (some environments are configured this way) ----
    if (!rows) {
      const u = new URL(RINGY_RECORDINGS_URL);
      u.searchParams.set("apiKey", RINGY_API_KEY_RECORDINGS);
      u.searchParams.set("startDate", startUTC);
      u.searchParams.set("endDate",   endUTC);
      u.searchParams.set("limit",     "5000");

      const r2 = await fetch(u.toString(), { method: "GET", headers: { accept: "application/json" }});
      if (!r2.ok) {
        const getErr = await safeText(r2);
        return j(502, {
          error: "Upstream error",
          status: r2.status,
          body: getErr || postErrText || "Bad Request",
          hints: [
            "POST JSON body {apiKey,startDate,endDate,limit} (UTC 'YYYY-MM-DD HH:mm:ss')",
            "GET ?apiKey&startDate&endDate&limit (same UTC format)"
          ]
        });
      }
      const data2 = await r2.json().catch(() => ({}));
      rows = normalizeList(data2);
    }

    // Aggregate per agent
    const per = new Map();
    const team = { calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };

    for (const x of rows) {
      const name = firstString(
        x.user_name, x.userName, x.agentName, x.agent, x.ownerName, x.user
      ) || "Unknown";

      // duration commonly in seconds; sometimes minutes
      const minutes = pickMinutes(
        x.durationSeconds, x.talkTimeSeconds, x.duration, x.talk_time_sec, x.talkMinutes
      );

      const key = name.trim().toLowerCase();
      const cur = per.get(key) || { name, calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };
      cur.calls += 1;
      cur.talkMin += minutes;
      cur.loggedMin += minutes; // if Ringy provides separate "totalMinutes" you can map it here
      per.set(key, cur);

      team.calls += 1;
      team.talkMin += minutes;
      team.loggedMin += minutes;
    }

    return j(200, {
      startDate: startUTC,
      endDate: endUTC,
      team: {
        calls: Math.round(team.calls),
        talkMin: Math.round(team.talkMin),
        loggedMin: Math.round(team.loggedMin),
        leads: 0,
        sold: 0
      },
      perAgent: Array.from(per.values()).sort((a, b) => b.calls - a.calls)
    });
  } catch (err) {
    return j(500, { error: "Failed", message: String(err && err.message || err) });
  }
}

/* ---------------- helpers ---------------- */

function j(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function normalizeList(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data))  return data.data;
  if (Array.isArray(data))        return data;
  return [];
}

async function safeText(r) { try { return await r.text(); } catch { return ""; } }

function firstString(...vals) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function pickMinutes(...vals) {
  // prefer seconds → minutes
  for (const v of vals) {
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    // if it's big, assume seconds; else already minutes
    if (n > 600) return Math.round(n / 60);
    return Math.max(0, Math.round(n));
  }
  return 0;
}

function weeklyWindowETasUTCStrings() {
  const ET = "America/New_York";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: ET }));
  const day = nowET.getDay();                 // Sun=0 .. Sat=6
  const sinceFri = (day + 2) % 7;
  const start = new Date(nowET);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - sinceFri);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  // Convert to UTC strings "YYYY-MM-DD HH:mm:ss"
  const startUTC = toUTCString(start);
  const endUTC   = toUTCString(end);
  return { startUTC, endUTC };
}

function toUTCString(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  // z is in UTC now; build "YYYY-MM-DD HH:mm:ss"
  const YYYY = z.getUTCFullYear();
  const MM   = String(z.getUTCMonth() + 1).padStart(2, "0");
  const DD   = String(z.getUTCDate()).padStart(2, "0");
  const hh   = String(z.getUTCHours()).padStart(2, "0");
  const mm   = String(z.getUTCMinutes()).padStart(2, "0");
  const ss   = "00";
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}
