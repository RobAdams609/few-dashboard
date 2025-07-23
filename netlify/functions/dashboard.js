exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      agentStats: [
        { name: "Rob", av: 2400, calls: 45, talkTime: 1800, sales: 6 },
        { name: "Phil", av: 1200, calls: 30, talkTime: 900, sales: 3 },
        { name: "Ajani", av: 2800, calls: 60, talkTime: 2400, sales: 8 }
      ],
      salesTicker: "Ajani closed $2800 • Rob closed $2400 • Phil closed $1200",
      principleOfTheDay: "7. Your goal is growth to the grave. Live in the moment and grow."
    }),
  };
};