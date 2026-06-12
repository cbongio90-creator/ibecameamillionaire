// backfill.js — script UNA TANTUM da eseguire sul tuo computer.
// Ricostruisce summary + lista donazioni leggendo TUTTO lo storico
// direttamente da Stripe (fonte di verità), commissioni incluse.
// È sicuro rieseguirlo: sovrascrive sempre con i dati reali di Stripe.
//
// Uso (PowerShell, dalla cartella del progetto, dopo `npm install`):
//   $env:STRIPE_SECRET_KEY="rk_live_..."
//   $env:NETLIFY_SITE_ID="..."
//   $env:NETLIFY_AUTH_TOKEN="..."
//   node backfill.js

const Stripe = require("stripe");
const { getStore } = require("@netlify/blobs");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function cleanName(session) {
  const field = (session.custom_fields || []).find(
    (f) => f.key === "public_name"
  );
  const raw = field && field.text && field.text.value
    ? field.text.value.trim()
    : "";
  if (!raw) return null;
  return (
    raw
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/[<>]/g, "")
      .slice(0, 30)
      .trim() || null
  );
}

(async () => {
  const store = getStore({
    name: "donations",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  const donations = [];
  let gross = 0;
  let fees = 0;

  // Scorre TUTTE le checkout session pagate, con la fee di ciascuna
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
        session.payment_intent.latest_charge.balance_transaction.fee) ||
      0;

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

  donations.sort((a, b) => b.ts.localeCompare(a.ts)); // più recente per prima

  await store.setJSON("summary", {
    gross,
    fees,
    net: gross - fees,
    count: donations.length,
    currency: "eur",
    updated_at: new Date().toISOString(),
  });
  await store.setJSON(
    "recent",
    donations.slice(0, 100).map(({ id, ...d }) => d)
  );
  // Marca tutte come "già viste" così il webhook non le conterà due volte
  for (const d of donations) {
    await store.set(`seen/${d.id}`, "1");
  }

  console.log(
    `Importate ${donations.length} donazioni — lordo € ${(gross / 100).toFixed(2)}, commissioni € ${(fees / 100).toFixed(2)}, netto € ${((gross - fees) / 100).toFixed(2)}`
  );
  console.log("Fatto. Apri /api/total per verificare.");
})().catch((err) => {
  console.error("Errore:", err.message);
  process.exit(1);
});
