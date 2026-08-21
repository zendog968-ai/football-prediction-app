/**
 * Safe negative-path tests for the admin configuration form.
 * Defaults to an isolated local target and never submits accepted credentials.
 */
import http from "node:http";
import assert from "node:assert/strict";

const targetHost = process.env.ADMIN_CONFIG_TEST_HOST || "ci.example.test";
const targetPort = Number(process.env.ADMIN_CONFIG_TEST_PORT || "3100");
const baseHeaders = { Host: targetHost, "X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/football" };

function request({ method, path, headers = {}, body = "" }) {
  return new Promise(resolve => {
    const req = http.request({ host: "127.0.0.1", port: targetPort, method, path, headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) }, timeout: 10_000 }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => (data += chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: data }));
    });
    req.on("error", error => resolve({ status: 0, headers: {}, body: "", error }));
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    if (body) req.write(body);
    req.end();
  });
}

async function freshCsrf() {
  const page = await request({ method: "GET", path: "/admin/configure", headers: baseHeaders });
  assert.equal(page.status, 200);
  const token = page.body.match(/name="csrf" value="([^"]+)"/)?.[1];
  const cookie = page.headers["set-cookie"]?.find(value => value.startsWith("aurelia_admin_config_csrf="))?.split(";")[0];
  assert.ok(token && cookie);
  assert.ok(!page.body.includes("<script>"));
  return { token, cookie };
}

async function post(body, { origin = `https://${targetHost}`, cookie, accept = "application/json", forwarded = true } = {}) {
  return request({ method: "POST", path: "/admin/configure", headers: { Host: targetHost, ...(forwarded ? { "X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/football" } : {}), ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), Accept: accept, "Content-Type": "application/x-www-form-urlencoded" }, body });
}

const encoded = values => new URLSearchParams(values).toString();
const results = [];
async function test(name, fn) { try { await fn(); results.push({ name, outcome: "PASS" }); } catch (error) { results.push({ name, outcome: `FAIL — ${error.message}` }); } }

await test("設定頁使用原生HTML表單", async () => { const { token } = await freshCsrf(); assert.ok(token.length >= 32); });
await test("缺少HTTPS轉送標頭被拒絕", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, apiFootballKey: "not-used" }), { cookie, forwarded: false })).status, 403); });
await test("不受信任Origin被拒絕", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, apiFootballKey: "not-used" }), { cookie, origin: "https://attacker.invalid" })).status, 403); });
await test("缺少CSRF Cookie被拒絕", async () => { const { token } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, apiFootballKey: "not-used" }))).status, 403); });
await test("CSRF Token不一致被拒絕", async () => { const { cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: "invalid-token", apiFootballKey: "not-used" }), { cookie })).status, 403); });
await test("空白表單以JSON回覆400", async () => { const { token, cookie } = await freshCsrf(); const response = await post(encoded({ csrf: token }), { cookie }); assert.equal(response.status, 400); assert.match(response.body, /請至少填寫一項/); });
await test("空白原生HTML提交回覆400結果頁", async () => { const { token, cookie } = await freshCsrf(); const response = await post(encoded({ csrf: token }), { cookie, accept: "text/html,application/xhtml+xml" }); assert.equal(response.status, 400); assert.match(response.body, /未能儲存設定/); assert.ok(!response.body.includes("<script>")); });
await test("未知欄位不會構成可寫入設定", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, arbitraryField: "ignored" }), { cookie })).status, 400); });
await test("僅空白字元會被正規化為空值", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, apiFootballKey: "   \t  " }), { cookie })).status, 400); });
await test("重複CSRF欄位被拒絕", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(`csrf=${encodeURIComponent(token)}&csrf=${encodeURIComponent(token)}&apiFootballKey=not-used`, { cookie })).status, 403); });
await test("含換行的值被路由拒絕", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, apiFootballKey: "invalid\nvalue" }), { cookie })).status, 400); });
await test("不合法Supabase URL無法寫入設定", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, supabaseUrl: "not-a-url" }), { cookie })).status, 500); });
await test("不合法管理員Chat ID無法寫入設定", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, telegramAdminChatId: "not-a-number" }), { cookie })).status, 500); });
await test("超大輸入被路由拒絕", async () => { const { token, cookie } = await freshCsrf(); assert.equal((await post(encoded({ csrf: token, apiFootballKey: "x".repeat(1_200_000) }), { cookie })).status, 400); });

console.table(results);
if (results.some(result => result.outcome !== "PASS")) process.exitCode = 1;
