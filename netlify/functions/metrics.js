exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      agentStats: [
        { name: "Rob", sales: 7, av: 4900, calls: 122, talkTime: 3030 },
        { name: "Phil", sales: 5, av: 3800, calls: 98, talkTime: 2540 },
        { name: "Ajani", sales: 3, av: 2100, calls: 85, talkTime: 1900 },
        { name: "Fabricio", sales: 2, av: 1400, calls: 67, talkTime: 1320 },
        { name: "Marie", sales: 4, av: 2800, calls: 73, talkTime: 1660 },
        { name: "Michelle", sales: 6, av: 4200, calls: 110, talkTime: 2760 },
        { name: "Joseph", sales: 2, av: 1500, calls: 59, talkTime: 1210 },
        { name: "Eli", sales: 3, av: 2000, calls: 78, talkTime: 1450 },
        { name: "Alrens", sales: 1, av: 700, calls: 35, talkTime: 900 },
      ],
      tickerSales: [
        { name: "Rob", amount: 700 },
        { name: "Phil", amount: 1200 },
        { name: "Ajani
