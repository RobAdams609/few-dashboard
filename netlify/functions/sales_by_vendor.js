// netlify/functions/sales_by_vendor.js
"use strict";

/**
 * Builds the Vendor % chart directly from Ringy:
 * 1) Pull sold leads for last 45 days (get-lead-sold-products)
 * 2) For each leadId, pull lead detail (get-lead) to identify vendor
 * 3) Tally deals per vendor and return { as_of, window_days, vendors:[{name,deals}] }
 *
 * ENV required (you already have the sold ones set up):
 *  - RINGY_SALES_ENDPOINT   => https://app.ringy.com/api/public/external/get-lead-sold-products
 *  - RINGY_API_KEY_SOLD
 *  - RINGY_LEAD_ENDPOINT    => https://app.ringy.com/api/public/external/get-lead
 *  - RINGY_API_KEY_LEADS
 *
 * Optional:
 *  - WINDOW_DAYS (default 45)
 */

const ET_TZ = "America/New_York";

// Small fetch helper
async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function toET(date) {
  return new Date(new Date(date).toLocaleString("en-US", { timeZone: ET_TZ }));
}

function fmtDateTimeUTC(d) {
  // YYYY-MM-DD HH:mm:ss in UTC
  const iso = new Date(d).toISOString(); // 2025-10-22T14:03:00.000Z
  const [day, time] = iso.split("T");
  return `${day} ${time.slice(0,8)}`;
}

exports.handler = async () => {
  try {
    const SOLD_URL  = process.env.RINGY_SALES_ENDPOINT;   // get-lead-sold-products
    const SOLD_KEY  = process.env.RINGY_API_KEY_SOLD;
    const LEAD_URL  = process.env.RINGY_LEAD_ENDPOINT;    // get-lead
    const LEAD_KEY  = process.env.RINGY_API_KEY_LEADS;

    if (!SOLD_URL || !SOLD_KEY || !LEAD_URL || !LEAD_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Ringy env vars." }),
        headers: { "Content-Type": "application/json" }
      };
    }

    const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 45);

    // Build last-45-days ET window and send as UTC to Ringy
    const nowET = toET(new Date());
    const startET = new Date(nowET); startET.setDate(startET.getDate() - WINDOW_DAYS);
    startET.setHours(0,0,0,0);
    const endET = new Date(nowET);   endET.setHours(23,59,59,999);

    const startUTC = fmtDateTimeUTC(startET);
    const endUTC   = fmtDateTimeUTC(endET);

    // 1) Get sold leads for the window
    const sold = await postJson(SOLD_URL, {
      apiKey: SOLD_KEY,
      startDate: startUTC,
      endDate: endUTC,
      limit: 5000
    });

    // Expect an array or an object with a list; normalize
    const allSales = Array.isArray(sold?.allSales) ? sold.allSales
                    : Array.isArray(sold) ? sold
                    : [];

    if (!allSales.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ as_of: new Date().toISOString().slice(0,10), window_days: WINDOW_DAYS, vendors: [] }),
        headers: { "Content-Type": "application/json" }
      };
    }

    // 2) Pull each lead detail for vendor name/id
    // Use a simple pool to avoid hammering Ringy
    const uniqueLeadIds = [...new Set(allSales.map(s=>s.leadId).filter(Boolean))];

    const out = [];
    const concurrency = 10;
    let i = 0;

    async function getLead(leadId) {
      try {
        const res = await postJson(LEAD_URL, { apiKey: LEAD_KEY, leadId });
        return res;
      } catch {
        return null;
      }
    }

    while (i < uniqueLeadIds.length) {
      const batch = uniqueLeadIds.slice(i, i+concurrency);
      const results = await Promise.all(batch.map(getLead));
      out.push(...results);
      i += concurrency;
    }

    // 3) Tally vendors
    // Prefer a friendly vendor label. Fallbacks cover a variety of Ringy fields.
    const rename = {
      // Normalize common names, add any you want bespoke labels for here:
      "TTM Nice!": "TTM Nice!", // ensure exact label
    };

    const counts = new Map();
    for (const lead of out) {
      if (!lead) continue;

      const label =
        rename[lead.vendorResponseId] ??
        rename[lead.vendor] ??
        rename[lead.sourceName] ??
        lead.vendorResponseId ??
        lead.vendor ??
        lead.sourceName ??
        "Unknown";

      counts.set(label, (counts.get(label) || 0) + 1);
    }

    // Return sorted list
    const vendors = [...counts.entries()]
      .map(([name,deals])=>({ name, deals }))
      .sort((a,b)=> (b.deals||0)-(a.deals||0));

    return {
      statusCode: 200,
      body: JSON.stringify({
        as_of: new Date().toISOString().slice(0,10),
        window_days: WINDOW_DAYS,
        vendors
      }),
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || String(e) }),
      headers: { "Content-Type": "application/json" }
    };
  }
};
