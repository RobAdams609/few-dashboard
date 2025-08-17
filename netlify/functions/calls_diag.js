// netlify/functions/sales_diag.js
const { rangeForDays } = require("./_util.js");

// Keys: accept several names (matches what you already set in Netlify)
const SALES_KEY =
  process.env.RINGY_API_KEY_SOLD ||
  process.env.RINGY_SALES_API_KEY ||
  process.env.RINGY_API_KEY ||
  "";

const LEADS_KEY =
  process.env.RINGY_API_KEY_LEADS ||
  process.env.RINGY_API_KEY ||
  "";

// Endpoints (yours are already set in Netlify > Environment Variables)
const SALES_ENDPOINT =
  process.env.RINGY_SALES_ENDPOINT ||
  process.env.RINGY_SOLD_URL ||
  "https://app.ringy.com/api/public/external/get-lead-sold-products";

const LEAD_ENDPOINT =
  process.env.RINGY_LEAD_LOOKUP_URL ||
  "https://app.ringy.com/api/public/external/get-lead";

// modest concurrency to avoid hammering Ringy
async function mapLimit(items, limit, worker) {
  const ret = [];
  let i = 0;
  const running = new Set();
  async function runOne(idx) {
    const p = (async () => worker(items[idx], idx))()
      .then((v) => (ret[idx] = v))
      .finally(() => running.delete(p));
    running.add(p);
    if (running.size >= limit) await Promise.race(running);
  }
  while (i < items.length) await runOne(i++);
  await Promise.all(running);
  return ret;
}

exports.handler = async (event) => {
  try {
    if (!SALES_KEY) throw new Error("Missing Ringy API key for sales");

    const params = event.queryStringParameters || {};
    const days = Number(params.days || 30);
    const limit = Math.min(Number(params.limit || 5000), 5000);
    const { startDate, endDate } = rangeForDays(days);

    // 1) Pull sold products
    const body = { apiKey: SALES_KEY, startDate, endDate, limit };
    const res = await fetch(SALES_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Ringy sales ${res.status}: ${txt}`);
    }
    const data = await res.json(); // Ringy returns an array
    const sales = Array.isArray(data) ? data : data?.data || [];

    // 2) Try to enrich each sale with owner info by looking up the lead.
    // NOTE: Ringy public get-lead often does NOT include owner fields.
    // We still attempt it; if not present, we leave ownerEmail/ownerName blank.
    const canLookupLead = !!LEADS_KEY && !!LEAD_ENDPOINT;

    const enriched = await mapLimit(sales, 6, async (r) => {
      let ownerEmail = "";
      let ownerName = "";

      if (canLookupLead && r?.leadId) {
        try {
          const lr = await fetch(LEAD_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey: LEADS_KEY, leadId: r.leadId }),
          });
          if (lr.ok) {
            const lead = await lr.json();
            // If Ringy ever exposes owner fields, prefer them here:
            ownerEmail =
              lead.ownerEmail ||
              lead.agentEmail ||
              lead.assignedToEmail ||
              "";
            ownerName =
              lead.ownerName || lead.agentName || lead.assignedTo || "";
          } else {
            // swallow; we still return the sale record
            await lr.text();
          }
        } catch (_) {
          /* ignore */
        }
      }

      return {
        ...r,
        ownerEmail,
        ownerName,
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
        endpoint: SALES_ENDPOINT,
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
