const { rangeForDays } = require("./_util.js");

// Accept many env names (your screenshots):
const API_KEY = (
  process.env.RINGY_SALES_API_KEY ||
  process.env.RINGY_API_KEY_SOLD ||
  process.env.RINGY_API_KEY_LEADS ||
  process.env.RINGY_API_KEY // generic fallback
);

const ENDPOINT = (
  process.env.RINGY_SALES_ENDPOINT ||
  process.env.RINGY_SOLD_URL ||
  process.env.RINGY_LEAD_LOOKUP_URL ||
  "https://app.ringy.com/api/public/external/get-lead-sold-products"
);

exports.handler = async (event) => {
  try {
    if (!API_KEY) throw new Error("Missing Ringy API key for sales (set RINGY_API_KEY_SOLD or RINGY_API_KEY_LEADS)");
    const params = event.queryStringParameters || {};
    const days = Number(params.days || 30);
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
      throw new Error(`Ringy sales ${res.status}: ${txt}`);
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
