import express from "express";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { registerAdminConfigRoutes } from "../server/adminConfig";

const app = express();
app.use(express.urlencoded({ limit: "2mb", extended: true }));
registerAdminConfigRoutes(app);

const server = createServer(app);
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("CI測試伺服器未能取得埠號。");
  const child = spawn(process.execPath, ["scripts/test-admin-config-extremes.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ADMIN_CONFIG_TEST_PORT: String(address.port), ADMIN_CONFIG_TEST_HOST: "ci.example.test" },
    stdio: "inherit",
  });
  child.on("error", error => { console.error(error); server.close(() => process.exit(1)); });
  child.on("close", code => server.close(() => process.exit(code ?? 1)));
});
