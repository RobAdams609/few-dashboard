exports.handler = async function(event, context) {
    // Mock data for demo. Replace this with real Ringy API call and format.
    const sales = [
        { agent: "Joseph", amount: 208 },
        { agent: "Ajani", amount: 300 },
        { agent: "Marie", amount: 275 }
    ];

    const metrics = {
        sales: sales.length,
        av: sales.reduce((acc, s) => acc + s.amount * 12, 0),
        calls: 87,
        talkTime: 122 // minutes
    };

    return {
        statusCode: 200,
        body: JSON.stringify({ sales, metrics })
    };
};