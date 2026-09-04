import { defineConfig } from "@playwright/test";

/**
 * Capturas del manual (`npm run docs:screenshots`).
 *
 * Por defecto usa el sitio publicado en producción (misma base que `BASE_PATH=/out`).
 * Para localhost: `MANUAL_SCREENSHOT_BASE_URL=http://127.0.0.1:3000/out npm run docs:screenshots`
 * Las rutas del test usan URLs absolutas (Playwright: baseURL `…/out` + `goto("/")` pierde `/out` y cae en la raíz del dominio).
 *
 * Credenciales solo por variables de entorno (nunca en el repo): ver README del dashboard.
 *
 * Si la página no carga el login (WAF / anti-bot): MANUAL_SCREENSHOT_HEADED=1 npm run docs:screenshots
 */
export default defineConfig({
  testDir: "./tests/manual-screenshots",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 45_000 },
  use: {
    headless: process.env.MANUAL_SCREENSHOT_HEADED === "1" ? false : true,
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "es-ES",
    extraHTTPHeaders: {
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.6",
    },
    screenshot: "off",
    video: "off",
    trace: "off",
    launchOptions: {
      args: ["--disable-blink-features=AutomationControlled"],
    },
  },
});
