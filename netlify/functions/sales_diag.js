const { rangeForDays } = require("./_util.js");

// Accept flexible env names you already have in Netlify
const SALES_KEY =
  process.env.RINGY_SALES_API_KEY ||
  process.env.RINGY_API_KEY_SOLD ||
  process.env.RINGY_API_KEY; // fallback

const LEADS_KEY =
  process.env.RINGY_API_KEY_LEADS ||
  process.env.RINGY_LEADS_API_KEY ||
  process.env.RINGY_API_KEY; // fallback

const SALES_URL =
  process.env.RINGY_SALES_ENDPOINT ||
  process.env.RINGY_SOLD_URL ||
  "https://app.ringy.com/api/public/external/get-lead-sold-products";

const LEAD_URL =
  process.env.RINGY_LEAD_LOOKUP_URL ||
  "https://app.ringy.com/api/public/external/get-lead";

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${url} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function pickOwner(lead) {
  // Try common shapes; Ringy may return nested owner/user fields depending on account
  const email =
    lead?.ownerEmail ||
    lead?.userEmail ||
    lead?.agentEmail ||
    lead?.assignedTo?.email ||
    lead?.owner?.email ||
    lead?.user?.email ||
    lead?.agent?.email ||
    "";
  const name =
    lead?.ownerName ||
    lead?.userName ||
    lead?.agentName ||
    lead?.assignedTo?.name ||
    lead?.owner?.name ||
    lead?.user?.name ||
    lead?.agent?.name ||
    "";

  return {
    ownerEmail: (email || "").trim().toLowerCase(),
    ownerName: (name || "").trim(),
  };
}

async function enrichOwners(records) {
  const byId = new Map();
  for (const r of records) if (r?.leadId) byId.set(r.leadId, null);
  const leadIds = [...byId.keys()];
  const BATCH = 10;

  for (let i = 0; i < leadIds.length; i += BATCH) {
    const slice = leadIds.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (leadId) => {
        try {
          const lead = await postJSON(LEAD_URL, { apiKey: LEADS_KEY, leadId });
          byId.set(leadId, pickOwner(lead || {}));
        } catch {
          byId.set(leadId, { ownerEmail: "", ownerName: "" });
        }
      })
    );
  }

  return records.map((r) => {
    const owner = byId.get(r.leadId) || { ownerEmail: "", ownerName: "" };
    return { ...r, ...owner };
  });
}

exports.handler = async (event) => {
  try {
    if (!SALES_KEY) throw new Error("Missing Ringy sales API key");

    const qs = event.queryStringParameters || {};
    const days = Math.min(Number(qs.days || 30), 90);
    const limit = Math.min(Number(qs.limit || 5000), 5000);
    const { startDate, endDate } = rangeForDays(days);

    // 1) Pull sold products
    const sold = await postJSON(SALES_URL, {
      apiKey: SALES_KEY,
      startDate,
      endDate,
      limit,
    });

    const records = Array.isArray(sold) ? sold : Array.isArray(sold?.data) ? sold.data : sold?.records || [];
    // 2) Enrich with owner (lead -> ownerEmail/ownerName)
    const enriched = await enrichOwners(records);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
      body: JSON.stringify({
        source: "ringy",
        endpoint: SALES_URL,
        startDate,
        endDate,
        count: enriched.length,
        records: enriched,
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
