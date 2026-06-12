// FUNZIONE TEMPORANEA: esegue il backfill da Stripe. DA CANCELLARE DOPO L'USO.
const Stripe = require("stripe");
const { getStore } = require("@netlify/blobs");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const RUN_KEY = "fai-salire-il-numero-2026";

function cleanName(session) {
  const field = (session.custom_fields || []).find((f) => f.key === "public_name");
  const raw = field && field.text && field.text.value ? field.text.value.trim() : "";
  if (!raw) return null;
  return raw.replace(/https?:\/\/\S+/gi, "").replace(/[<>]/g, "").slice(0, 30).trim() || null;
}

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).key !== RUN_KEY) {
    return { statusCode: 403, body: "Forbidden" };
  }

  const store = getStore({
    name: "donations",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  const donations = [];
  let gross = 0;
  let fees = 0;

  for await (const session of stripe.checkout.sessions.list({
    limit: 100,
    expand: ["data.payment_intent.latest_charge.balance_transaction"],
  })) {
    if (session.payment_status !== "paid") continue;
    const amount = session.amount_total || 0;
    const fee =
      (session.payment_intent &&
        session.payment_intent.latest_charge &&
        session.payment_intent.latest_charge.balance_transaction &&
        session.payment_intent.latest_charge.balance_transaction.fee) || 0;
    donations.push({
      id: session.id,
      name: cleanName(session),
      amount,
      currency: (session.currency || "eur").toLowerCase(),
      ts: new Date(session.created * 1000).toISOString(),
    });
    gross += amount;
    fees += fee;
  }

  donations.sort((a, b) => b.ts.localeCompare(a.ts));

  await store.setJSON("summary", {
    gross, fees, net: gross - fees,
    count: donations.length, currency: "eur",
    updated_at: new Date().toISOString(),
  });
  await store.setJSON("recent", donations.slice(0, 100).map(({ id, ...d }) => d));
  for (const d of donations) {
    await store.set(`seen/${d.id}`, "1");
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imported: donations.length,
      gross_eur: gross / 100,
      fees_eur: fees / 100,
      net_eur: (gross - fees) / 100,
    }),
  };
};
