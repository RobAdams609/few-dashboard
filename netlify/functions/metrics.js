const fetch = require('node-fetch');

exports.handler = async function () {
  const soldKey = process.env.RINGY_SOLD_KEY;
  const recordingKey = process.env.RINGY_RECORDING_KEY;

  const today = new Date().toISOString().split("T")[0];

  try {
    // --- SALES & AV ---
    const soldRes = await fetch(`https://app.ringy.com/api/public/external/get-lead-sold-products?apiKey=${soldKey}&startDate=${today}&endDate=${today}&limit=1000`);
    const soldData = await soldRes.json();
    const sales = soldData.data || [];

    const agentStats = {};

    const saleDetails = sales.map(s => {
      const agent = (s.sold_by_user_name || "Unknown").toLowerCase().split(" ")[0];
      const amount = parseFloat(s.sale_price || 0);
      const av = amount * 12;

      if (!agentStats[agent]) agentStats[agent] = { sales: 0, av: 0, calls: 0, talkTime: 0 };
      agentStats[agent].sales += 1;
      agentStats[agent].av += av;

      return { agent: s.sold_by_user_name, amount };
    });

    // --- CALLS & TALK TIME ---
    const callRes = await fetch(`https://app.ringy.com/api/public/external/get-recordings?apiKey=${recordingKey}&startDate=${today}&endDate=${today}&limit=1000`);
    const callData = await callRes.json();
    const calls = callData.data || [];

    calls.forEach(call => {
      const agent = (call.user_name || "Unknown").toLowerCase().split(" ")[0];
      const talkTime = parseFloat(call.talk_time || 0);
      if (!agentStats[agent]) agentStats[agent] = { sales: 0, av: 0, calls: 0, talkTime: 0 };
      agentStats[agent].calls += 1;
      agentStats[agent].talkTime += talkTime / 60; // convert to minutes
    });

    Object.values(agentStats).forEach(agent => {
      agent.talkTime = Math.round(agent.talkTime);
      agent.av = Math.round(agent.av);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        sales: saleDetails,
        agentStats
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch metrics", details: err.message })
    };
  }
};
