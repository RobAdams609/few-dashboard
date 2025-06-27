const axios = require("axios");

exports.handler = async () => {
  try {
    const soldRes = await axios.post(
      "https://app.ringy.com/api/public/external/get-lead-sold-products",
      {
        apiKey: process.env.RINGY_SOLD_KEY,
        startDate: new Date().toISOString().slice(0,10) + " 00:00:00",
        endDate:   new Date().toISOString().slice(0,10) + " 23:59:59",
        limit: 500
      }
    );

    const arr = Array.isArray(soldRes.data) ? soldRes.data : [];
    const totalSales = arr.length;
    const totalAV    = arr.reduce((sum, itm) => sum + (Number(itm.amount) || 0), 0);

    return {
      statusCode: 200,
      body: JSON.stringify({ totalSales, totalAV })
    };
  } catch (err) {
    console.error("❌ metrics function error:", err.message);
    return {
      statusCode: 200,
      body: JSON.stringify({ totalSales: 0, totalAV: 0 })
    };
  }
};
