const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const store = getStore({
    name: "donations",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  const s = (await store.get("summary", { type: "json" })) || {
    gross: 0,
    fees: 0,
    net: 0,
    count: 0,
  };
  const recent = (await store.get("recent", { type: "json" })) || [];

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=5",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      source:
        "Generated automatically from Stripe webhooks. Not editable by hand.",
      total: s.gross / 100,
      fees: s.fees / 100,
      net: s.net / 100,
      count: s.count,
      // name è null se il donatore non ha scelto un nome pubblico al checkout
      recent: recent.map((d) => ({
        name: d.name || null,
        amount: d.amount / 100,
        ts: d.ts,
      })),
    }),
  };
};
