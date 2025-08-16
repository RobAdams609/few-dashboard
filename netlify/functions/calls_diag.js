const { rangeForDays } = require("./_util.js");

// Accept many env names (your screenshots):
const API_KEY = (
  process.env.RINGY_CALLS_API_KEY ||
  process.env.RINGY_API_KEY_RECORDINGS ||
  process.env.RINGY_API_KEY_CALL_DETAIL ||
  process.env.RINGY_API_KEY_CALLS ||
  process.env.RINGY_API_KEY // generic fallback
);

// Endpoint priority: explicit override → recordings → calls
const ENDPOINT = (
  process.env.RINGY_CALLS_ENDPOINT ||
  process.env.RINGY_RECORDINGS_URL ||
  process.env.RINGY_CALL_DETAIL_URL ||
  "https://app.ringy.com/api/public/external/get-call-recordings"
);

exports.handler = async (event) => {
  try {
    if (!API_KEY) throw new Error("Missing Ringy API key for calls (set RINGY_API_KEY_RECORDINGS or RINGY_API_KEY_CALL_DETAIL)");
    const params = event.queryStringParameters || {};
    const days = Number(params.days || 7);
    const limit = Math.min(Number(params.limit || 5000), 5000);
    const { startDate, endDate } = rangeForDays(days);

    const body = { apiKey: API_KEY, startDate, endDate, limit };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Ringy calls ${res.status}: ${txt}`);
    }

    const json = await res.json();
    const records = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : (json?.records || []);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({
        source: "ringy",
        endpoint: ENDPOINT,
        startDate,
        endDate,
        count: records.length,
        records,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({ error: String(err.message || err) }),
    };
  }
};
