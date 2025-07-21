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
    const saleDetails = sales.map(s => ({
      agent: s.sold_by_user_name,
      amount: parseFloat(s.sale_price || 0)
    }));

    const totalAV = saleDetails.reduce((sum, s) => sum + s.amount * 12, 0);

    // --- CALL VOLUME + TALK TIME ---
    const callRes = await fetch(`https://app.ringy.com/api/public/external/get-recordings?apiKey=${recordingKey}&startDate=${today}&endDate=${today}&limit=1000`);
    const callData = await callRes.json();

    const calls = callData.data || [];
    const totalTalkTime = calls.reduce((sum, c) => sum + parseFloat(c.talk_time || 0), 0);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sales: saleDetails,
        metrics: {
          sales: saleDetails.length,
          av: totalAV,
          calls: calls.length,
          talkTime: Math.round(totalTalkTime / 60) // Convert seconds → minutes
        }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch metrics", details: err.message })
    };
  }
};
