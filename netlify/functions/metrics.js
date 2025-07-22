import fetch from 'node-fetch';

const RINGY_GET_LEAD_KEY = process.env.RINGY_GET_LEAD_KEY;
const RINGY_RECORDING_KEY = process.env.RINGY_RECORDING_KEY;
const RINGY_SOLD_KEY = process.env.RINGY_SOLD_KEY;

export default async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [leadsRes, recordingsRes, soldRes] = await Promise.all([
      fetch('https://app.ringy.com/api/public/external/get-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: RINGY_GET_LEAD_KEY, startDate: today, endDate: today }),
      }),
      fetch('https://app.ringy.com/api/public/external/get-recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: RINGY_RECORDING_KEY, startDate: today, endDate: today }),
      }),
      fetch('https://app.ringy.com/api/public/external/get-lead-sold-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: RINGY_SOLD_KEY, startDate: today, endDate: today }),
      }),
    ]);

    const [leads, recordings, sold] = await Promise.all([
      leadsRes.json(),
      recordingsRes.json(),
      soldRes.json(),
    ]);

    const agentStats = buildAgentStats({ leads, recordings, sold });

    return res.status(200).json({ agentStats });
  } catch (error) {
    console.error('Fetched metrics:', error);
    return res.status(500).json({ error: error.message });
  }
};

function buildAgentStats({ leads, recordings, sold }) {
  const stats = {};

  sold?.forEach(({ user_name, amount }) => {
    if (!user_name) return;
    if (!stats[user_name]) stats[user_name] = { name: user_name, av: 0, sales: 0, calls: 0, talkTime: 0 };
    stats[user_name].av += Number(amount || 0) * 12;
    stats[user_name].sales += 1;
  });

  recordings?.forEach(({ user_name, talk_time }) => {
    if (!user_name) return;
    if (!stats[user_name]) stats[user_name] = { name: user_name, av: 0, sales: 0, calls: 0, talkTime: 0 };
    stats[user_name].calls += 1;
    stats[user_name].talkTime += Number(talk_time || 0);
  });

  return Object.values(stats);
}
