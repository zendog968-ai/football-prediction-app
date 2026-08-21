import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { Express, Request, Response } from "express";

const CSRF_COOKIE = "aurelia_admin_config_csrf";
const CONFIG_HELPER = "/usr/local/sbin/aurelia-football-web-configure";

type ConfigField = { key: string; label: string; inputName: string; hint: string };

const configFields: ConfigField[] = [
  { key: "API_FOOTBALL_KEY", label: "API-Football Key", inputName: "apiFootballKey", hint: "只在需要更新時填寫。" },
  { key: "SUPABASE_URL", label: "Supabase URL", inputName: "supabaseUrl", hint: "應以 https:// 開始。" },
  { key: "SUPABASE_SECRET_KEY", label: "Supabase Service Role Key", inputName: "supabaseSecretKey", hint: "僅接受服務端 service-role／secret key。" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", inputName: "telegramBotToken", hint: "由 BotFather 建立的機械人 Token。" },
  { key: "TELEGRAM_WEBHOOK_SECRET", label: "Telegram Webhook Secret", inputName: "telegramWebhookSecret", hint: "如未更換可留空。" },
  { key: "TELEGRAM_ADMIN_CHAT_ID", label: "Telegram 管理員 Chat ID", inputName: "telegramAdminChatId", hint: "只接受數字 ID。" },
];

const configFieldLimits: Record<string, number> = {
  API_FOOTBALL_KEY: 512,
  SUPABASE_URL: 1024,
  SUPABASE_SECRET_KEY: 4096,
  TELEGRAM_BOT_TOKEN: 512,
  TELEGRAM_WEBHOOK_SECRET: 512,
  TELEGRAM_ADMIN_CHAT_ID: 64,
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(part => {
    const separator = part.indexOf("=");
    return separator === -1 ? [part.trim(), ""] : [part.slice(0, separator).trim(), part.slice(separator + 1)];
  }).filter(([key, value]) => Boolean(key && value)).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function sameToken(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function basePath(request: Request): string {
  return (request.get("x-forwarded-prefix") || "").replace(/\/$/, "");
}

function isHttps(request: Request): boolean {
  return request.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

function trustedOrigin(request: Request): boolean {
  const origin = request.get("origin");
  const host = request.get("host");
  return Boolean(origin && host && origin === `https://${host}`);
}

function renderDocument(title: string, content: string): string {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><style>body{margin:0;background:#101419;color:#eaf0f6;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:720px;margin:0 auto;padding:42px 20px 72px}.card{background:#171d25;border:1px solid #2b3541;border-radius:16px;padding:28px;box-shadow:0 18px 45px #0005}h1{font-size:25px;margin:0 0 8px}p{color:#aebdcb}.notice{border-left:3px solid #2acb91;padding:10px 14px;background:#14261f;border-radius:6px;color:#d5f6e8}.warning{border-left-color:#e7b74b;background:#2b2515;color:#ffe6aa}.field{display:grid;gap:8px;margin:21px 0}.field small{display:block;color:#9caab9;margin-top:2px}input{background:#0e1319;border:1px solid #415063;border-radius:9px;color:#eef5fb;font:16px monospace;padding:12px;width:100%;box-sizing:border-box}input:focus{outline:2px solid #2acb91;outline-offset:2px}button,.button{display:inline-block;background:#2acb91;border:0;border-radius:9px;color:#062018;cursor:pointer;font-weight:700;padding:12px 18px;font-size:16px;text-decoration:none}.button.secondary{background:#263443;color:#eaf0f6}</style></head><body><main class="wrap">${content}</main></body></html>`;
}

function renderPage(base: string, csrfToken: string): string {
  const rows = configFields.map(field => {
    const configured = Boolean(process.env[field.key]);
    return `<label class="field"><span><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(field.hint)} ${configured ? "目前已設定；留空不會覆蓋。" : "目前未設定。"}</small></span><input autocomplete="off" name="${field.inputName}" type="password" spellcheck="false" aria-label="${escapeHtml(field.label)}" /></label>`;
  }).join("\n");
  return renderDocument("Aurelia Football · 管理員設定", `<section class="card"><h1>Aurelia Football 管理員設定</h1><p>此頁只在受 HTTPS 與既有 <code>admin</code> Basic Auth 保護的範圍可用。欄位留空不會覆蓋現有設定，系統亦不會回傳或顯示已儲存的憑證。</p><p class="notice">本頁使用原生HTML表單提交，不依賴JavaScript。提交後服務會在數秒內安全重新載入。</p><form method="post" action="${escapeHtml(base)}/admin/configure"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />${rows}<button type="submit">安全儲存並重新載入服務</button></form></section>`);
}

function renderResultPage(base: string, title: string, message: string, success: boolean): string {
  return renderDocument(`Aurelia Football · ${title}`, `<section class="card"><h1>${escapeHtml(title)}</h1><p class="${success ? "notice" : "notice warning"}">${escapeHtml(message)}</p><p><a class="button secondary" href="${escapeHtml(base)}/admin/configure">返回管理員設定</a></p></section>`);
}

function setResponseSecurityHeaders(response: Response): void {
  response.set({ "Cache-Control": "no-store, max-age=0", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
}

function wantsHtml(request: Request): boolean {
  return request.get("accept")?.includes("text/html") ?? false;
}

function runConfigHelper(payload: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", [CONFIG_HELPER], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const resolveOnce = () => { if (!settled) { settled = true; resolve(); } };
    const rejectOnce = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") rejectOnce(error); });
    child.on("error", rejectOnce);
    child.on("close", code => { if (code === 0) resolveOnce(); else rejectOnce(new Error(stderr || `設定工具失敗（代碼 ${code ?? "unknown"}）`)); });
    try { child.stdin.end(JSON.stringify(payload)); } catch (error) { rejectOnce(error instanceof Error ? error : new Error("設定工具管線失敗。")); }
  });
}

export function registerAdminConfigRoutes(app: Express): void {
  app.get("/admin/configure", (request, response) => {
    if (!isHttps(request)) return response.status(404).end();
    const csrfToken = crypto.randomBytes(32).toString("base64url");
    response.cookie(CSRF_COOKIE, csrfToken, { httpOnly: true, sameSite: "strict", secure: true, path: `${basePath(request)}/admin` });
    setResponseSecurityHeaders(response);
    response.type("html").send(renderPage(basePath(request), csrfToken));
  });

  app.post("/admin/configure", async (request: Request, response: Response) => {
    const base = basePath(request);
    const sendError = (status: number, message: string) => wantsHtml(request)
      ? (setResponseSecurityHeaders(response), response.status(status).type("html").send(renderResultPage(base, "未能儲存設定", message, false)))
      : response.status(status).json({ error: message });
    if (!isHttps(request) || !trustedOrigin(request)) return sendError(403, "拒絕不受信任的請求。");
    const cookies = parseCookies(request);
    if (!sameToken(cookies[CSRF_COOKIE], typeof request.body?.csrf === "string" ? request.body.csrf : undefined)) return sendError(403, "設定頁已過期，請重新載入頁面後再試。");
    const hasUnsafeValue = configFields.some(field => {
      const value = request.body?.[field.inputName];
      return typeof value === "string" && (value.length > configFieldLimits[field.key] || /[\r\n\0]/.test(value));
    });
    if (hasUnsafeValue) return sendError(400, "設定欄位長度或格式無效。");
    const payload = Object.fromEntries(configFields.map(field => [field.key, typeof request.body?.[field.inputName] === "string" ? request.body[field.inputName].trim() : ""]));
    if (!Object.values(payload).some(Boolean)) return sendError(400, "請至少填寫一項需要更新的設定。");
    try {
      await runConfigHelper(payload);
      if (wantsHtml(request)) {
        setResponseSecurityHeaders(response);
        return response.status(202).type("html").send(renderResultPage(base, "設定已安全套用", "服務將在數秒內重新載入；系統不會顯示或回傳已儲存的憑證。", true));
      }
      response.status(202).json({ ok: true, restartScheduled: true });
    } catch {
      return sendError(500, "設定未能套用，請稍後重試或使用SSH設定工具。");
    }
  });
}
