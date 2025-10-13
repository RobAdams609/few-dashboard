export default async function handler() {
  const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;

  try {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);

    const fmt = (d) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(
        d.getUTCMinutes()
      ).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;

    const response = await fetch(RINGY_CALL_DETAIL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: RINGY_API_KEY_CALL_DETAIL,
        startDate: fmt(start),
        endDate: fmt(now),
        limit: 100,
      }),
    });

    const text = await response.text();
    return new Response(
      JSON.stringify({
        ok: response.ok,
        status: response.status,
        body: text.slice(0, 500),
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "content-type": "application/json" },
    });
  }
}
