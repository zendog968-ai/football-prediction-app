import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// Credential smoke tests remain available in the original suite. Pull requests
// must never receive production credentials or pretend mock values verify them.
export default mergeConfig(baseConfig, defineConfig({
  test: {
    setupFiles: ["./tests/ci.setup.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.*"],
  },
}));
