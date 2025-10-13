// ---------- FEW DASHBOARD: calls_by_agent.js (fixed CommonJS version) ----------

exports.handler = async function (event, context) {
  try {
    // --- Environment vars ---
    const RINGY_CALL_DETAIL_URL = process.env.RINGY_CALL_DETAIL_URL;
    const RINGY_API_KEY_CALL_DETAIL = process.env.RINGY_API_KEY_CALL_DETAIL;
    if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing Ringy URL or API key" })
      };
    }

    // --- Helpers ---
    const ET_TZ = "America/New_York";
    function weekRangeET() {
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ }));
      const day = now.getDay();
      const sinceFri = (day + 2) % 7;
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - sinceFri);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return [start, end];
    }
    const toUtcString = d =>
      new Date(d).toISOString().slice(0, 19).replace("T", " ");

    // --- Dates for query ---
    const [startET, endET] = weekRangeET();
    const startUTC = toUtcString(startET);
    const endUTC = toUtcString(endET);

    // --- POST to Ringy ---
    const body = {
      apiKey: RINGY_API_KEY_CALL_DETAIL,
      startDate: startUTC,
      endDate: endUTC,
      limit: 5000
    };

    const res = await fetch(RINGY_CALL_DETAIL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, status: res.status, body: text })
      };
    }

    // --- Parse and summarize ---
    const data = JSON.parse(text);
    const perAgent = Array.isArray(data) ? data : [];

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        teamCalls: perAgent.length,
        perAgent
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: err.message || String(err)
      })
    };
  }
};
