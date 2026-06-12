const Stripe = require("stripe");
const { getStore } = require("@netlify/blobs");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function ok(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // Il body RAW serve per verificare la firma di Stripe
  const payload = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  const signature = event.headers["stripe-signature"];

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Firma webhook non valida:", err.message);
    return { statusCode: 400, body: "Invalid signature" };
  }

  if (evt.type !== "checkout.session.completed") {
    return ok({ received: true, ignored: evt.type });
  }

  const session = evt.data.object;
  if (session.payment_status !== "paid") {
    return ok({ received: true, ignored: "not_paid" });
  }

  const store = getStore({
    name: "donations",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  // Idempotenza: Stripe può reinviare lo stesso evento, non contiamolo due volte
  const seenKey = `seen/${session.id}`;
  if (await store.get(seenKey)) {
    return ok({ received: true, duplicate: true });
  }

  // Nome pubblico SOLO se il donatore l'ha scritto nel campo facoltativo
  // "public_name" del checkout. Mai salvare l'email.
  let name = null;
  const field = (session.custom_fields || []).find(
    (f) => f.key === "public_name"
  );
  const raw = field && field.text && field.text.value
    ? field.text.value.trim()
    : "";
  if (raw) {
    name =
      raw
        .replace(/https?:\/\/\S+/gi, "") // niente link nella lista pubblica
        .replace(/[<>]/g, "") // niente HTML
        .slice(0, 30)
        .trim() || null;
  }

  // Commissione Stripe del singolo pagamento (best effort)
  let fee = 0;
  try {
    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {
        expand: ["latest_charge.balance_transaction"],
      });
      fee =
        (pi.latest_charge &&
          pi.latest_charge.balance_transaction &&
          pi.latest_charge.balance_transaction.fee) ||
        0;
    }
  } catch (err) {
    console.error("Impossibile leggere la fee:", err.message);
  }

  const amount = session.amount_total || 0; // in CENTESIMI
  const currency = (session.currency || "eur").toLowerCase();
  const ts = new Date(evt.created * 1000).toISOString();

  // Aggiorna il riepilogo aggregato (tutto in centesimi)
  const summary = (await store.get("summary", { type: "json" })) || {
    gross: 0,
    fees: 0,
    net: 0,
    count: 0,
    currency,
  };
  summary.gross += amount;
  summary.fees += fee;
  summary.net = summary.gross - summary.fees;
  summary.count += 1;
  summary.currency = currency;
  summary.updated_at = ts;

  // Aggiorna la lista delle ultime 100 donazioni
  const recent = (await store.get("recent", { type: "json" })) || [];
  recent.unshift({ name, amount, currency, ts });
  if (recent.length > 100) recent.length = 100;

  await store.setJSON("summary", summary);
  await store.setJSON("recent", recent);
  await store.set(seenKey, "1");

  return ok({ received: true });
};

