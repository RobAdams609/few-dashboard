
// Drilldown: get a single call by ID
const { cors } = require("./_lib.js");

const CALL_URL = process.env.RINGY_CALL_DETAIL_URL || "https://app.ringy.com/api/public/external/get-calls";

async function postJson(url, body) {
  const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200 };
  const gate = cors(event); if (!gate.ok) return gate;

  const apiKey = process.env.RINGY_API_KEY_CALL_DETAIL;
  if (!apiKey) return { statusCode: 500, headers: gate.headers, body: JSON.stringify({ error: "Missing RINGY_API_KEY_CALL_DETAIL" }) };

  const id = (event.queryStringParameters && event.queryStringParameters.id) || null;
  if (!id) return { statusCode: 400, headers: gate.headers, body: JSON.stringify({ error: "Missing ?id=<callId>" }) };

  try {
    const j = await postJson(CALL_URL, { apiKey, callId: id });
    const out = {
      id: j.id,
      direction: j.callDirection || null,
      to: j.toPhoneNumber || null,
      from: j.fromPhoneNumber || null,
      leadId: j.leadId || null,
      durationSecs: Number(j.duration || 0),
      callStartDateUtc: j.callStartDate || null
    };
    return { statusCode: 200, headers: gate.headers, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 502, headers: gate.headers, body: JSON.stringify({ error: e.message }) };
  }
};
