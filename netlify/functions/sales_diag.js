// netlify/functions/calls_diag.js
const { rangeForDays, normalizePhone, loadRoster } = require("./_util.js");

const REC_KEY =
  process.env.RINGY_API_KEY_RECORDINGS ||
  process.env.RINGY_CALLS_API_KEY ||
  process.env.RINGY_API_KEY ||
  "";

const CALL_KEY =
  process.env.RINGY_API_KEY_CALL_DETAIL ||
  process.env.RINGY_API_KEY_CALLS ||
  process.env.RINGY_API_KEY ||
  "";

const REC_URL =
  process.env.RINGY_RECORDINGS_URL ||
  process.env.RINGY_CALLS_ENDPOINT ||
  "https://app.ringy.com/api/public/external/get-call-recordings";

const CALL_URL =
  process.env.RINGY_CALL_DETAIL_URL ||
  process.env.RINGY_CALLS_ENDPOINT ||
  "https://app.ringy.com/api/public/external/get-calls";

// simple concurrency limiter
async function limitedAll(items, limit, fn){
  const results = new Array(items.length);
  let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true){
      const idx = i++;
      if (idx >= items.length) return;
      try { results[idx] = await fn(items[idx], idx); } catch(e){ results[idx] = null; }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

exports.handler = async (event) => {
  try {
    if (!REC_KEY || !CALL_KEY) throw new Error("Missing Ringy API keys for recordings/call-detail");

    const params = event.queryStringParameters || {};
    const days = Number(params.days || 7);
    const limit = Math.min(Number(params.limit || 1000), 5000);
    const { startDate, endDate } = rangeForDays(days);

    // 1) List recordings
    const recRes = await fetch(REC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: REC_KEY, startDate, endDate, limit })
    });
    if (!recRes.ok) {
      const t = await recRes.text();
      throw new Error(`Ringy recordings ${recRes.status}: ${t}`);
    }
    const recs = await recRes.json(); // [{id, callId, dateRecorded, ...}]
    const callIds = Array.from(new Set((Array.isArray(recs) ? recs : []).map(r => r.callId).filter(Boolean)));

    // 2) Fetch call detail for each callId
    const { phoneToAgent } = loadRoster();
    const details = await limitedAll(callIds, 12, async (callId) => {
      const r = await fetch(CALL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: CALL_KEY, callId })
      });
      if (!r.ok) return null;
      const j = await r.json(); // one call
      const to = normalizePhone(j.toPhoneNumber);
      const from = normalizePhone(j.fromPhoneNumber);

      // match which side is agent
      let agent = phoneToAgent.get(from) || phoneToAgent.get(to) || null;
      return {
        id: j.id,
        callId,
        callDirection: j.callDirection,
        toPhoneNumber: to,
        fromPhoneNumber: from,
        callStartDate: j.callStartDate,
        duration: j.duration || 0,
        ownerEmail: agent?.email || "",
        ownerName: agent?.name || ""
      };
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*"
      },
      body: JSON.stringify({
        source: "ringy",
        startDate, endDate,
        count: details.length,
        records: details
      })
    };
  } catch (err){
    return {
      statusCode: 502,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*"
      },
      body: JSON.stringify({ error: String(err.message || err) })
    };
  }
};
