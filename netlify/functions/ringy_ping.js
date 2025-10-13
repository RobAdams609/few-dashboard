// netlify/functions/ringy_ping.js
export default async function handler() {
  const { RINGY_CALL_DETAIL_URL, RINGY_API_KEY_CALL_DETAIL } = process.env;

  const bad = (obj) =>
    new Response(JSON.stringify(obj, null, 2), {
      headers: { "content-type": "application/json" },
      status: 200,
    });

  if (!RINGY_CALL_DETAIL_URL || !RINGY_API_KEY_CALL_DETAIL) {
    return bad({
      ok: false,
      error: "Missing env vars",
      have: {
        RINGY_CALL_DETAIL_URL: !!RINGY_CALL_DETAIL_URL,
        RINGY_API_KEY_CALL_DETAIL: !!RINGY_API_KEY_CALL_DETAIL,
      },
    });
  }

  // 7-day window in UTC, Ringy likes "YYYY-MM-DD HH:mm:ss"
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(
      d.getUTCMinutes()
    ).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;

  const startStr = fmt(start);
  const endStr = fmt(now);

  const urls = Array.from(
    new Set([
      RINGY_CALL_DETAIL_URL,
      RINGY_CALL_DETAIL_URL.replace(/\/get-calls\/call-detail$/, "/get-calls"),
    ])
  );

  // Common Ringy variants seen across tenants
  const bodies = [
    { apiKey: RINGY_API_KEY_CALL_DETAIL, startDate: startStr, endDate: endStr, page: 1, pageSize: 200 },
    { apiKey: RINGY_API_KEY_CALL_DETAIL, dateFrom: startStr, dateTo: endStr, page: 1, pageSize: 200 },
    { apiKey: RINGY_API_KEY_CALL_DETAIL, start: startStr, end: endStr, page: 1, pageSize: 200 },
    { apiKey: RINGY_API_KEY_CALL_DETAIL, startDate: startStr, endDate: endStr }, // minimal
  ];

  const tries = [];
  for (const url of urls) {
    for (const body of bodies) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await r.text();
        const head = text.slice(0, 600);
        const looksJson = head.trim().startsWith("{") || head.trim().startsWith("[");
        tries.push({
          url,
          body,
          status: r.status,
          ok: r.ok && looksJson,
          sample: head,
        });
        if (r.ok && looksJson) {
          return bad({ ok: true, picked: { url, body }, status: r.status, sample: head });
        }
      } catch (e) {
        tries.push({ url, body, error: String(e) });
      }
    }
  }

  return bad({
    ok: false,
    message: "No variant returned JSON 200. See tries for details.",
    tries,
  });
}
