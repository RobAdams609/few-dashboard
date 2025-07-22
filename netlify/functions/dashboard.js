exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      agentStats: [
        { name: "Rob", av: 2400, calls: 120, talkTime: 230, sales: 6 },
        { name: "Phil", av: 1300, calls: 75, talkTime: 190, sales: 3 },
        { name: "Ajani", av: 3100, calls: 140, talkTime: 260, sales: 8 }
      ],
      salesTicker: "Phil closed $1,200 • Ajani closed $2,800 • Rob closed $2,400",
      principleOfTheDay: "2. Consistency beats intensity."
    }),
  };
};
