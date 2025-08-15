
// Calls aggregation: recordings → call detail → lead owner → per-agent Calls & Talk Time
const { cors, memo, dayWindowET_Now, fmtUtcSQL } = require("./_lib.js");

const REC_URL  = process.env.RINGY_RECORDINGS_URL || "https://app.ringy.com/api/public/external/get-call-recordings";
const CALL_URL = process.env.RINGY_CALL_DETAIL_URL || "https://app.ringy.com/api/public/external/get-calls";
const LEAD_URL = process.env.RINGY_LEAD_LOOKUP_URL || "https://app.ringy.com/api/public/external/get-lead";

async function postJson(url, body) {
  const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function getRecordings(startUtc, endUtc, apiKey) {
  const body = { apiKey, startDate: fmtUtcSQL(startUtc), endDate: fmtUtcSQL(endUtc), limit: 5000 };
  const data = await postJson(REC_URL, body);
  return Array.isArray(data) ? data : (data?.data || []);
}

async function getCallDetail(callId, apiKey) {
  const j = await postJson(CALL_URL, { apiKey, callId });
  return {
    id: j.id, leadId: j.leadId || null,
    durationSecs: Number(j.duration || 0),
    direction: j.callDirection || null,
    startUtc: j.callStartDate || null
  };
}

async function getLeadOwner(leadId, apiKey) {
  const L = await postJson(LEAD_URL, { apiKey, leadId });
  return (L?.ownerName || L?.assignedTo || L?.user_name || L?.userName || L?.agent || L?.agentName || null);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200 };
  const gate = cors(event); if (!gate.ok) return gate;

  try {
    const recKey = process.env.RINGY_API_KEY_RECORDINGS;
    const callKey = process.env.RINGY_API_KEY_CALL_DETAIL;
    const leadKey = process.env.RINGY_API_KEY_LEADS;
    if (!recKey || !callKey || !leadKey) throw new Error("Missing call aggregation API keys");

    const { startUtc, endUtc } = dayWindowET_Now(); // Today ET → now ET
    const cacheKey = `calls:${startUtc.toISOString()}:${Math.floor(Date.now()/10000)}`;

    const payload = await memo(cacheKey, 10_000, async () => {
      // 1) Recording list
      const recs = await getRecordings(startUtc, endUtc, recKey);

      // 2) Unique call IDs (cap for safety)
      const ids = Array.from(new Set(recs.map(r => r.callId).filter(Boolean))).slice(0, 2000);

      // 3) Details with concurrency
      const details = [];
      const CONC_CALLS = 10; let i = 0;
      async function worker() {
        while (i < ids.length) {
          const id = ids[i++];
          try { details.push(await getCallDetail(id, callKey)); } catch {}
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC_CALLS, ids.length) }, worker));

      // 4) Owners
      const leadIds = Array.from(new Set(details.map(c => c.leadId).filter(Boolean)));
      const owners = {};
      const CONC_LEADS = 8; let j = 0;
      async function leadWorker() {
        while (j < leadIds.length) {
          const lid = leadIds[j++];
          try { owners[lid] = await getLeadOwner(lid, leadKey) || "Unknown"; } catch { owners[lid] = "Unknown"; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC_LEADS, leadIds.length) }, leadWorker));

      // 5) Aggregate by agent
      const byAgent = {};
      for (const c of details) {
        const agent = c.leadId ? (owners[c.leadId] || "Unknown") : "Unknown";
        if (!byAgent[agent]) byAgent[agent] = { agent, calls: 0, talkTimeSecs: 0 };
        byAgent[agent].calls += 1;
        byAgent[agent].talkTimeSecs += c.durationSecs || 0;
      }

      const list = Object.values(byAgent).map(x => ({
        ...x,
        talkTimeMins: Math.round((x.talkTimeSecs/60)*10)/10,
        talkPerCallSecs: x.calls ? Math.round(x.talkTimeSecs/x.calls) : 0
      })).sort((a,b)=> (b.calls||0)-(a.calls||0));

      return {
        startDateUtc: fmtUtcSQL(startUtc),
        endDateUtc: fmtUtcSQL(endUtc),
        totalRecordings: recs.length,
        totalUniqueCalls: ids.length,
        list
      };
    });

    return { statusCode: 200, headers: gate.headers, body: JSON.stringify(payload) };
  } catch (e) {
    return { statusCode: 502, headers: gate.headers, body: JSON.stringify({ error: e.message }) };
  }
};
