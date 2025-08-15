// /api/calls_diag — quick diagnostic summary of recent call recordings
exports.handler = async (event) => {
  try {
    const RECS_URL =
      process.env.RINGY_RECORDINGS_URL ||
      "https://app.ringy.com/api/public/external/get-call-recordings";
    const apiKey = process.env.RINGY_API_KEY_RECORDINGS;

    // read ?days= from query (default 7, clamp 1..30)
    const qs = event.queryStringParameters || {};
    const days = Math.max(1, Math.min(30, Number(qs.days || 7)));

    // UTC window
    const now = new Date();
    const end = now;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

    const body = {
      apiKey,
      startDate: fmt(start),
      endDate: fmt(end),
      limit: 5000,
    };

    const r = await fetch(RECS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Ringy responded ${r.status} ${r.statusText}: ${text}`);
    }

    const data = await r.json();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        startUtc: body.startDate,
        endUtc: body.endDate,
        count: Array.isArray(data) ? data.length : 0,
        sample: Array.isArray(data) ? data.slice(0, 3) : data,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: String(e) }),
    };
  }
};
