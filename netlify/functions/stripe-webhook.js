const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const stripeEvent = JSON.parse(event.body);

    if (stripeEvent.type !== "checkout.session.completed") {
      return {
        statusCode: 200,
        body: "Evento ignorato"
      };
    }

    const session = stripeEvent.data.object;

    const amount = session.amount_total
      ? session.amount_total / 100
      : 0;

    const store = getStore({
  name: "donations",
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_AUTH_TOKEN
});

    const currentTotal = Number(await store.get("total") || 0);
    const currentCount = Number(await store.get("count") || 0);

    await store.set("total", String(currentTotal + amount));
    await store.set("count", String(currentCount + 1));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        total: currentTotal + amount,
        count: currentCount + 1
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
