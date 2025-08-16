// netlify/functions/calls_diag.js
const { rangeForDays } = require("./_util.js");

// Pick up your various env names
const REC_KEY =
  process.env.RINGY_API_KEY_RECORDINGS ||
  process.env.RINGY_CALLS_API_KEY ||
  process.env.RINGY_API_KEY ||
  "";
const CALL_KEY =
  process.env.RINGY_API_KEY_CALL_DETAIL ||
  process.env.RINGY_API_KEY_CALLS ||
  REC_KEY;
const REC_URL =
  process.env.RINGY_RECORDINGS_URL ||
  process.env.RINGY_RECORDINGS_ENDPOINT ||
  "https://app.ringy.com/api/public/external/get-call-recordings";
const CALL_URL =
  process.env.RINGY_CALL_DETAIL_URL ||
  process.env.RINGY_CALLS_ENDPOINT ||
  "https://app.ringy.com/api/public/external/get-calls";

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const days = Number(params.days || 7);
    const limit = Math.min(Number(params.limit || 1000), 5000);
    const { startDate, endDate } = rangeForDays(days);

    if (!REC_KEY) throw new Error("Missing Ringy recordings API key");
    if (!CALL_KEY) throw new Error("Missing Ringy call-detail API key");

    // 1) get-call-recordings (time window)
    const recBody = { apiKey: REC_KEY, startDate, endDate, limit };
    const recRes = await fetch(REC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recBody),
    });
    if (!recRes.ok) {
      const t = await recRes.text();
      throw new Error(`Ringy recordings ${recRes.status}: ${t}`);
    }
    const recordings = await recRes.json(); // array

    // Build unique callId set
    const callIds = Array.from(
      new Set(recordings.map((r) => r.callId).filter(Boolean))
    );

    // 2) fetch details for callIds in small batches
    const details = [];
    const BATCH = 50;
    for (let i = 0; i < callIds.length; i += BATCH) {
      const slice = callIds.slice(i, i + BATCH);
      const batch = await Promise.all(
        slice.map(async (callId) => {
          const dRes = await fetch(CALL_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey: CALL_KEY, callId }),
          });
          if (!dRes.ok) return null;
          try {
            return await dRes.json();
          } catch {
            return null;
          }
        })
      );
      details.push(...batch.filter(Boolean));
    }
    const byId = new Map(details.map((d) => [d.id, d]));

    // 3) merge minimal fields we need client-side
    const merged = recordings.map((r) => {
      const d = byId.get(r.callId) || {};
      return {
        callId: r.callId,
        dateRecorded: r.dateRecorded, // UTC "YYYY-MM-DD HH:mm:ss"
        duration: d.duration || d.duration_seconds || 0, // seconds
        fromPhoneNumber: d.fromPhoneNumber || "",
        toPhoneNumber: d.toPhoneNumber || "",
      };
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
      body: JSON.stringify({
        source: "ringy",
        endpoint: { REC_URL, CALL_URL },
        startDate,
        endDate,
        count: merged.length,
        records: merged,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
      body: JSON.stringify({ error: String(err.message || err) }),
    };
  }
};
