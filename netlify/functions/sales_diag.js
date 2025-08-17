const { rangeForDays, normalizePhone, loadRoster } = require("./_util.js");

const SOLD_KEY =
  process.env.RINGY_API_KEY_SOLD ||
  process.env.RINGY_SALES_API_KEY ||
  process.env.RINGY_API_KEY || "";

const LEAD_KEY =
  process.env.RINGY_API_KEY_LEADS ||
  process.env.RINGY_API_KEY || "";

const CALL_KEY =
  process.env.RINGY_API_KEY_CALL_DETAIL ||
  process.env.RINGY_API_KEY_CALLS ||
  process.env.RINGY_API_KEY || "";

const REC_KEY =
  process.env.RINGY_API_KEY_RECORDINGS ||
  process.env.RINGY_CALLS_API_KEY ||
  process.env.RINGY_API_KEY || "";

const SOLD_URL =
  process.env.RINGY_SOLD_URL ||
  process.env.RINGY_SALES_ENDPOINT ||
  "https://app.ringy.com/api/public/external/get-lead-sold-products";

const LEAD_URL =
  process.env.RINGY_LEAD_LOOKUP_URL ||
  "https://app.ringy.com/api/public/external/get-lead";

const REC_URL =
  process.env.RINGY_RECORDINGS_URL ||
  "https://app.ringy.com/api/public/external/get-call-recordings";

const CALL_URL =
  process.env.RINGY_CALL_DETAIL_URL ||
  process.env.RINGY_CALLS_ENDPOINT ||
  "https://app.ringy.com/api/public/external/get-calls";

async function limitedAll(items, limit, fn){
  const results = new Array(items.length);
  let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true){
      const idx = i++;
      if (idx >= items.length) return;
      try { results[idx] = await fn(items[idx], idx); } catch { results[idx] = null; }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

exports.handler = async (event) => {
  try {
    if (!SOLD_KEY) throw new Error("Missing Ringy SOLD API key");
    if (!LEAD_KEY) throw new Error("Missing Ringy LEADS API key");
    if (!REC_KEY || !CALL_KEY) throw new Error("Missing Ringy CALLS/RECORDINGS keys");

    const params = event.queryStringParameters || {};
    const days = Number(params.days || 30);
    const limit = Math.min(Number(params.limit || 500), 5000);
    const { startDate, endDate } = rangeForDays(days);

    // 1) Sales
    const sRes = await fetch(SOLD_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: SOLD_KEY, startDate, endDate, limit })
    });
    if (!sRes.ok) throw new Error(`Sales ${sRes.status}: ${await sRes.text()}`);
    const sales = await sRes.json(); // array

    // 2) Build leadPhone -> agent (from recordings + call details)
    const callsWindowDays = Math.max(days, 30);
    const { startDate: cStart, endDate: cEnd } = rangeForDays(callsWindowDays);
    const recRes = await fetch(REC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: REC_KEY, startDate: cStart, endDate: cEnd, limit: 2000 })
    });
    if (!recRes.ok) throw new Error(`Recordings ${recRes.status}: ${await recRes.text()}`);
    const recordings = await recRes.json();
    const uniqueCallIds = Array.from(new Set((Array.isArray(recordings)?recordings:[]).map(r=>r.callId).filter(Boolean)));

    const { phoneToAgent } = loadRoster();
    const callDetails = await limitedAll(uniqueCallIds.slice(0, 1200), 12, async (callId) => {
      const r = await fetch(CALL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: CALL_KEY, callId })
      });
      if (!r.ok) return null;
      const j = await r.json();
      const to = normalizePhone(j.toPhoneNumber);
      const from = normalizePhone(j.fromPhoneNumber);
      let agent = null, leadPhone = null;
      if (phoneToAgent.has(from)) { agent = phoneToAgent.get(from); leadPhone = to; }
      else if (phoneToAgent.has(to)) { agent = phoneToAgent.get(to); leadPhone = from; }
      if (!agent || !leadPhone) return null;
      return { leadPhone, agentEmail: agent.email, agentName: agent.name, when: new Date(j.callStartDate||0).getTime()||0 };
    });

    // keep latest call per leadPhone
    const lastByLead = new Map();
    for (const c of callDetails){
      const prev = lastByLead.get(c.leadPhone);
      if (!prev || c.when > prev.when) lastByLead.set(c.leadPhone, c);
    }

    // 3) Enrich each sale with owner via lead phone (fallback if Ringy doesn't give owner)
    const enriched = await limitedAll(sales, 10, async (rec) => {
      let ownerEmail = (rec.ownerEmail || "").toLowerCase();
      let ownerName  = rec.ownerName || "";

      if (!ownerEmail && LEAD_KEY && rec?.leadId) {
        try {
          const lr = await fetch(LEAD_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey: LEAD_KEY, leadId: rec.leadId })
          });
          if (lr.ok) {
            const lead = await lr.json();
            const lp = normalizePhone(lead.phoneNumber);
            const hit = lp ? lastByLead.get(lp) : null;
            if (hit) { ownerEmail = hit.agentEmail; ownerName = hit.agentName; }
          } else { await lr.text(); }
        } catch { /* ignore */ }
      }

      return { ...rec, ownerEmail, ownerName };
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({ source:"ringy", startDate, endDate, count: enriched.length, records: enriched })
    };
  } catch (err){
    return { statusCode: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
