// metrics.js (ESM-compatible version)
import fetch from 'node-fetch';

const RINGY_GET_LEAD_KEY = process.env.RINGY_GET_LEAD_KEY;
const RINGY_RECORDING_KEY = process.env.RINGY_RECORDING_KEY;
const RINGY_SOLD_KEY = process.env.RINGY_SOLD_KEY;

export default async (req, res) => {
  try {
    const [leadsRes, recordingsRes, soldRes] = await Promise.all([
      fetch('https://app.ringy.com/api/public/external/get-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: RINGY_GET_LEAD_KEY,
          startDate: getToday(),
          endDate: getToday()
        }),
      }),
      fetch('https://app.ringy.com/api/public/external/get-recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: RINGY_RECORDING_KEY,
          startDate: getToday(),
          endDate: getToday()
        }),
      }),
      fetch('https://app.ringy.com/api/public/external/get-lead-sold-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: RINGY_SOLD_KEY,
          startDate: getToday(),
          endDate: getToday()
        }),
      }),
    ]);

    const [leads, recordings, sold] = await Promise.all([
      leadsRes.json(),
      recordingsRes.json(),
      soldRes.json(),
    ]);

    const agentStats = processAgentData({ leads, recordings, sold });

    return res.status(200).json({ agentStats });
  } catch (error) {
    console.error('Fetched metrics:', error);
    return res.status(500).json({ errorType: 'Error', errorMessage: error.message });
  }
};

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function processAgentData({ leads, recordings, sold }) {
  // Build real agentStats from fetched data
  // This should match the structure your dashboard expects
  const stats = {};

  sold?.forEach(item => {
    const name = item?.user_name;
    const av = parseInt(item?.amount) * 12;
    if (!stats[name]) stats[name] = { av: 0, sales: 0 };
    stats[name].av += av;
    stats[name].sales += 1;
  });

  recordings?.forEach(item => {
    const name = item?.user_name;
    const talkTime = parseInt(item?.talk_time || 0);
    if (!stats[name]) stats[name] = { talkTime: 0, calls: 0 };
    stats[name].talkTime = (stats[name].talkTime || 0) + talkTime;
    stats[name].calls = (stats[name].calls || 0) + 1;
  });

  return Object.entries(stats).map(([name, data]) => ({
    name,
    av: data.av || 0,
    sales: data.sales || 0,
    talkTime: data.talkTime || 0,
    calls: data.calls || 0,
  }));
}
