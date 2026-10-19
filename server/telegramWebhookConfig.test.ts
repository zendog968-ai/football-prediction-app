import { describe, expect, it } from "vitest";
import { buildTelegramWebhookUrl, formatTelegramRuntimeHeader } from "./telegramWebhookConfig";
describe("Telegram deployment routing", () => {
  it("retains football prefix behind nginx", () => expect(buildTelegramWebhookUrl("https://136-108-33-74.nip.io", "/football/")).toBe("https://136-108-33-74.nip.io/football/api/integrations/telegram/webhook"));
  it("uses pinned origin instead of a request host", () => expect(buildTelegramWebhookUrl("https://other.invalid", "", "https://136-108-33-74.nip.io/football/api/integrations/telegram/webhook")).toBe("https://136-108-33-74.nip.io/football/api/integrations/telegram/webhook"));
  it("preserves no-prefix deployments", () => expect(buildTelegramWebhookUrl("https://example.invalid")).toBe("https://example.invalid/api/integrations/telegram/webhook"));
  it("rejects insecure or credential-bearing callback URLs", () => {
    for (const url of ["http://example.invalid/api/integrations/telegram/webhook", "https://u:p@example.invalid/api/integrations/telegram/webhook", "https://example.invalid/api/integrations/telegram/webhook?secret=bad", "https://example.invalid/api/integrations/telegram/webhook#token", "https://example.invalid/other"]) expect(() => buildTelegramWebhookUrl("", "", url)).toThrow();
    expect(() => buildTelegramWebhookUrl("https://example.invalid", "/football/../admin")).toThrow();
  });
  it("identifies the active research engine without claiming calibration", () => { const text = formatTelegramRuntimeHeader("Home"); expect(text).toContain("【服務】Home"); expect(text).toContain("poisson-v4-shrink10-research"); expect(text).toContain("未校準"); });
  it("declares suspended confidence and betting features even when model samples exist", () => {
    const text = formatTelegramRuntimeHeader("Home");
    expect(text).toContain("高信心篩選停用");
    expect(text).toContain("投注建議與EV停用");
    expect(text).not.toContain("前瞻折外校準模型");
  });
});
