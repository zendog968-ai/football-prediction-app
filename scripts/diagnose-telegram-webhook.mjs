const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN is unavailable in this process" }));
  process.exit(1);
}

const [webhookResponse, botResponse] = await Promise.all([
  fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`),
  fetch(`https://api.telegram.org/bot${token}/getMe`),
]);
const payload = await webhookResponse.json();
const botPayload = await botResponse.json();

if (!webhookResponse.ok || !payload.ok || !botResponse.ok || !botPayload.ok) {
  console.error(JSON.stringify({ ok: false, webhookHttpStatus: webhookResponse.status, botHttpStatus: botResponse.status, error: "Telegram rejected diagnostics" }));
  process.exit(1);
}

const info = payload.result ?? {};
const bot = botPayload.result ?? {};
console.log(JSON.stringify({
  ok: true,
  bot: { id: bot.id ?? null, username: bot.username ?? null, displayName: bot.first_name ?? null },
  url: info.url ?? null,
  hasCustomCertificate: Boolean(info.has_custom_certificate),
  pendingUpdateCount: Number(info.pending_update_count ?? 0),
  lastErrorDate: info.last_error_date ?? null,
  lastErrorMessage: info.last_error_message ?? null,
  maxConnections: info.max_connections ?? null,
  allowedUpdates: info.allowed_updates ?? [],
}, null, 2));
