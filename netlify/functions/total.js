const { getStore } = require("@netlify/blobs");

exports.handler = async () => {
  const store = getStore({
    name: "donations",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN
  });

  const total = await store.get("total");
  const count = await store.get("count");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({
      total: Number(total || 0),
      count: Number(count || 0)
    })
  };
};
