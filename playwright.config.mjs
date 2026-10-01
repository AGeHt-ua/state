// UI-тести порталу (Playwright). Потрібен запущений локальний Worker із підставним Discord (див. tests/ui/README у README.md):
//   npm run test:ui
// Сайт піднімається автоматично (python http.server на 8080) або використовується вже запущений.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/ui",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "uk-UA"
  },
  webServer: {
    command: (process.platform === "win32" ? "python" : "python3") + " -m http.server 8080 --directory frontend",
    url: "http://localhost:8080/",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
