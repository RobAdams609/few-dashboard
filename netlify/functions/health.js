
exports.handler = async () => ({ statusCode: 200, body: JSON.stringify({ ok: true, ts: Date.now() }) });
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify({ ok: true, ts: new Date().toISOString() }),
  };
};
