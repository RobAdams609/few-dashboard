exports.handler = async function(event, context) {
  try {
    // Dummy return – replace with real fetch logic
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        agentStats: [], 
        salesTicker: [], 
        principleOfTheDay: "1. Hunt Relentlessly" 
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
