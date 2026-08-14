import { describe, expect, it } from "vitest";

describe("Telegram Bot憑證", () => {
  it("以Telegram getMe驗證Bot Token與Webhook Secret格式", async () => {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    expect(telegramToken, "缺少TELEGRAM_BOT_TOKEN").toBeTruthy();
    expect(webhookSecret, "缺少TELEGRAM_WEBHOOK_SECRET").toMatch(/^[A-Za-z0-9_-]{1,256}$/);

    const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`);

    expect(telegramResponse.ok, `Telegram驗證失敗（HTTP ${telegramResponse.status}）`).toBe(true);
    const telegramPayload = await telegramResponse.json() as { ok?: boolean; result?: { is_bot?: boolean } };
    expect(telegramPayload.ok).toBe(true);
    expect(telegramPayload.result?.is_bot).toBe(true);
  }, 20_000);
});
