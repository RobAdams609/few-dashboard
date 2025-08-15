// /api/calls_diag — check call recordings over a wider window
exports.handler = async (event) => {
  const RECS_URL = process.env.RINGY_RECORDINGS_URL || "https://app.ringy.com/api/public/external/get-call-recordings";
  const apiKey = process.env.RINGY_API_KEY_RECORDINGS;
  const qs = new URLSearchParams(event.queryStringParameters || {});
  const days = Math.max(1, Math.min(14, Number(qs.get("days") || 7)));

  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const fmt = d => {
    const pad = n => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };

  const body = { apiKey, startDate: fmt(start), endDate: fmt(end), limit: 5000 };

  try {
    const r = await fetch(RECS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        startUtc: body.startDate,
        endUtc: body.endDate,
        count: Array.isArray(data) ? data.length : 0,
        sample: Array.isArray(data) ? data.slice(0, 3) : data
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: String(e) })
    };
  }
};
