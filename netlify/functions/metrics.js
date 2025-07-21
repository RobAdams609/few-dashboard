const axios = require("axios");

exports.handler = async () => {
  try {
    const sold = await axios.post(
      "https://app.ringy.com/api/public/external/get-lead-sold-products",
      {
        apiKey: process.env.RINGY_SOLD_KEY,
        startDate: new Date().toISOString().slice(0,10) + " 00:00:00",
        endDate:   new Date().toISOString().slice(0,10) + " 23:59:59",
        limit: 500
      }
    );

    const totalSales = sold.data.length;
    const totalAV    = sold.data.reduce((sum,i) => sum + i.amount, 0);

    return {
      statusCode: 200,
      body: JSON.stringify({ totalSales, totalAV })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
