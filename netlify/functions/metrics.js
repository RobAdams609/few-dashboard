// netlify/functions/metrics.js
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function () {
  try {
    const response = await fetch('https://app.ringy.com/api/public/external/get-lead-sold-products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apiKey: 'RGYiqo808w4kv7of0t7rxgn45g8xl11n',
      },
      body: JSON.stringify({
        startDate: '2025-07-01',
        endDate: '2025-07-22',
      }),
    });

    const data = await response.json();

    if (!data || !Array.isArray(data)) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Unexpected response from Ringy' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ agentStats: data }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
