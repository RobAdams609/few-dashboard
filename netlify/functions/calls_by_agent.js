// netlify/functions/calls_by_agent.js
// Aggregates per-agent call count, talk time, and logged time from Ringy get-call-recordings

export default async function handler(req, context) {
  try {
    const {
      RINGY_RECORDINGS_URL,
      RINGY_API_KEY_RECORDINGS,
    } = process.env;

    if (!RINGY_RECORDINGS_URL || !RINGY_API_KEY_RECORDINGS) {
      return json(500, { error: "Missing RINGY_RECORDINGS_URL or RINGY_API_KEY_RECORDINGS" });
    }

    // Weekly Friday → Friday window in Eastern Time
    const ET_TZ = "America/New_York";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ }));
    const day = now.getDay();
    const sinceFri = (day + 2) % 7;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - sinceFri);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const startISO = start.toISOString().slice(0, 19) + "Z";
    const endISO = end.toISOString().slice(0, 19) + "Z";

    let page = 1;
    const pageSize = 200;
    const rows = [];

    while (true) {
      const body = {
        apiKey: RINGY_API_KEY_RECORDINGS,
        startDate: startISO,
        endDate: endISO,
        page,
        pageSize,
      };

      const r = await fetch(RINGY_RECORDINGS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const msg = await r.text();
        return json(502, { error: "Upstream error", status: r.status, body: msg });
      }

      const data = await r.json().catch(() => ({}));
      const list = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];

      rows.push(...list);

      if (list.length < pageSize) break;
      page++;
      if (page > 30) break; // safety limit
    }

    const per = new Map();
    const team = { calls: 0, talkMin: 0, loggedMin: 0, leads: 0, sold: 0 };

    for (const x of rows) {
      const name = x.user_name || x.agent || "";
      const key = name.toLowerCase();
      const durSec = Number(x.duration || 0);
      const min = Math.round(durSec / 60);

      const cur = per.get(key) || {
        name,
        calls: 0,
        talkMin: 0,
        loggedMin: 0,
        leads: 0,
        sold: 0,
      };
      cur.calls++;
      cur.talkMin += min;
      cur.loggedMin += min;
      per.set(key, cur);

      team.calls++;
      team.talkMin += min;
      team.loggedMin += min;
    }

    return json(200, {
      startDate: startISO,
      endDate: endISO,
      team,
      perAgent: Array.from(per.values()).sort((a, b) => b.calls - a.calls),
    });
  } catch (err) {
    return json(500, { error: "Failed", msg: String(err) });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
