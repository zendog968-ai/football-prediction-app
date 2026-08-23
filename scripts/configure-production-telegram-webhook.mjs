const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookUrl = "https://footypred-qhhxwfst.manus.space/api/integrations/telegram/webhook";

if (!token || !secret) {
  console.error(JSON.stringify({ ok: false, error: "Required Telegram server credentials are unavailable" }));
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  }),
});

const payload = await response.json();
if (!response.ok || !payload.ok) {
  console.error(JSON.stringify({ ok: false, httpStatus: response.status, error: "Telegram rejected webhook configuration" }));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, webhookUrl }, null, 2));
