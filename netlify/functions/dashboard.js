exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      agentStats: [
        { name: "Ajani", sales: 8, av: 2800, calls: 60, talkTime: 2400 },
        { name: "Rob", sales: 6, av: 2400, calls: 45, talkTime: 1800 },
        { name: "Phil", sales: 3, av: 1200, calls: 30, talkTime: 900 }
      ],
      salesTicker: "Phil closed $1,200 • Ajani closed $2,800 • Rob closed $2,400",
      principleOfTheDay: "2. Consistency beats intensity."
    })
  };
}
