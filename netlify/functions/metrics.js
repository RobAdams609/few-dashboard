// netlify/functions/metrics.js

import fetch from 'node-fetch';

const API_KEYS = {
  sold: 'RGYiqo808w4kv7of0t7rxgn45g8xl11n',
  call: 'RGY60brwg9qq24bfrqfj0x11rbnlpap',
  lead: 'RGYt9bght8w0rd5qfn65v9ud0g2oam8e',
};

const ENDPOINTS = {
  soldProducts: 'https://app.ringy.com/api/public/external/get-lead-sold-products',
  recordings: 'https://app.ringy.com/api/public/external/get-recordings',
};

const startDate = new Date();
startDate.setHours(0, 0, 0, 0);
const endDate = new Date();
endDate.setHours(23, 59, 59, 999);

const formatDate = (date) => date.toISOString().split('T')[0];

const fetchSoldProducts = async () => {
  const response = await fetch(`${ENDPOINTS.soldProducts}?apiKey=${API_KEYS.sold}&startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`);
  const data = await response.json();
  if (!data || !Array.isArray(data)) throw new Error("Invalid sold product data");
  return data;
};

const fetchRecordings = async () => {
  const response = await fetch(`${ENDPOINTS.recordings}?apiKey=${API_KEYS.call}&startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`);
  const data = await response.json();
  if (!data || !Array.isArray(data)) throw new Error("Invalid recording data");
  return data;
};

const calculateAgentStats = (soldProducts, recordings) => {
  const stats = {};

  soldProducts.forEach((sale) => {
    const name = sale.agent_name;
    if (!stats[name]) stats[name] = { sales: 0, av: 0, calls: 0, talkTime: 0 };
    stats[name].sales += 1;
    stats[name].av += parseFloat(sale.annualized_premium || 0);
  });

  recordings.forEach((rec) => {
    const name = rec.user_name;
    if (!stats[name]) stats[name] = { sales: 0, av: 0, calls: 0, talkTime: 0 };
    stats[name].calls += 1;
    stats[name].talkTime += parseFloat(rec.duration_minutes || 0);
  });

  return stats;
};

export async function handler() {
  try {
    const soldProducts = await fetchSoldProducts();
    const recordings = await fetchRecordings();

    const agentStats = calculateAgentStats(soldProducts, recordings);

    return {
      statusCode: 200,
      body: JSON.stringify({ agentStats }),
    };
  } catch (err) {
    console.error("METRICS API FAILED:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ errorType: "Error", errorMessage: err.message }),
    };
  }
}
