import { RESEARCH_MODEL_VERSION } from "./qualityPoisson";
import { RESEARCH_POLICY_NOTICE } from "./researchPolicy";
export function buildTelegramWebhookUrl(origin: string, basePath = "", configured = ""): string {
  if (!configured && (!/^https:\/\//.test(origin) || !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(basePath))) throw new Error("Webhook requires HTTPS and a safe application prefix");
  const candidate = configured || `${origin.replace(/\/$/, "")}${basePath.replace(/\/$/, "")}/api/integrations/telegram/webhook`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/api/integrations/telegram/webhook")) throw new Error("Invalid HTTPS Telegram webhook URL");
  return url.toString();
}
export function formatTelegramRuntimeHeader(label = "Aurelia"): string {
  const safeLabel = label.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 32) || "Aurelia";
  return `【服務】${safeLabel}\n【研究引擎】${RESEARCH_MODEL_VERSION}\n【狀態】未校準研究；只顯示有效新版資料\n${RESEARCH_POLICY_NOTICE}`;
}
