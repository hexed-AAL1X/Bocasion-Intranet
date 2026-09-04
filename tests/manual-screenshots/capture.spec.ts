import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OUT = path.join(process.cwd(), "public/docs/manual/screenshots");

/**
 * Origen del dashboard exportado, sin / final.
 * Importante: con baseURL "…/out", Playwright `goto("/")` resuelve a la raíz del dominio y pierde "/out"
 * (comportamiento URL estándar). Por eso siempre concatenamos aquí.
 */
function screenshotSiteOrigin(): string {
  return (process.env.MANUAL_SCREENSHOT_BASE_URL ?? "https://www.bocasion.com/out").replace(/\/$/, "");
}

/** path: "" → inicio; "analisis" | "/notion" → …/out/analisis */
function siteUrl(path: string): string {
  const base = screenshotSiteOrigin();
  const p = path.replace(/^\//, "").trim();
  if (!p) return `${base}/`;
  return `${base}/${p}`;
}

async function gotoSite(page: import("@playwright/test").Page, path: string) {
  return page.goto(siteUrl(path), { waitUntil: "load", timeout: 180_000 });
}

const LOGIN = '[data-auth-gate="login"]';

function sidebarLocator(page: import("@playwright/test").Page) {
  return page
    .locator("[data-dashboard-sidebar]")
    .or(page.locator("aside").filter({ has: page.locator("nav") }).first());
}

async function diagnosePageFailure(page: import("@playwright/test").Page, label: string): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const snippet = await page
    .evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 700))
    .catch(() => "");
  const shot = path.join(OUT, `_debug-${label}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const hints: string[] = [
    `(${label}) No apareció el login ni el panel.`,
    `URL: ${url}`,
    `¿Es la URL del dashboard? Debe estar bajo ${screenshotSiteOrigin()}/ (si ves solo el dominio sin /out, revisa las rutas del test).`,
    `Título: ${title}`,
    `Texto visible (recorte): ${snippet || "(vacío — ¿bloqueo WAF, challenge o JS sin cargar?)"}`,
    `PNG de diagnóstico: ${shot}`,
  ];
  if (/just a moment|checking your browser|cf-|challenge|attention required/i.test(snippet + title)) {
    hints.push(
      "Parece página anti-bot / Cloudflare. Prueba: MANUAL_SCREENSHOT_HEADED=1 npm run docs:screenshots (navegador visible)."
    );
  }
  return hints.join("\n");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

async function loginScreenVisible(page: import("@playwright/test").Page) {
  const byMarker = await page.locator(LOGIN).isVisible().catch(() => false);
  const byHeading = await page.getByRole("heading", { name: /Acceso restringido/i }).isVisible().catch(() => false);
  const byUserField = await page.getByPlaceholder("Usuario").isVisible().catch(() => false);
  return byMarker || byHeading || byUserField;
}

async function waitForLoginOrDashboard(page: import("@playwright/test").Page) {
  const sidebar = sidebarLocator(page);
  const userInput = page.getByPlaceholder("Usuario");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await sidebar.isVisible().catch(() => false)) return "dashboard";
    if (await userInput.isVisible().catch(() => false)) return "login";
    if (await page.getByRole("heading", { name: /Acceso restringido/i }).isVisible().catch(() => false)) return "login";
    await delay(400);
  }

  throw new Error(await diagnosePageFailure(page, "wait-shell"));
}

async function ensureLoggedIn(page: import("@playwright/test").Page) {
  const response = await gotoSite(page, "").catch(async () => null);
  if (response && response.status() >= 400) {
    throw new Error(`La raíz respondió HTTP ${response.status()}. Revisa MANUAL_SCREENSHOT_BASE_URL y que el sitio sea accesible.`);
  }

  await delay(1200);

  const state = await waitForLoginOrDashboard(page);

  if (state === "login" || (await loginScreenVisible(page))) {
    const user = process.env.MANUAL_SCREENSHOT_USER;
    const pw = process.env.MANUAL_SCREENSHOT_PASSWORD;
    if (!user?.trim() || !pw) {
      throw new Error(
        [
          "Pantalla de login detectada y Playwright no ve credenciales en el entorno del proceso.",
          "Usa export (o una sola línea) para USER y PASSWORD — ver README del dashboard.",
        ].join("\n")
      );
    }

    await page.getByPlaceholder("Usuario").fill(user);
    await page.getByPlaceholder("Contraseña").fill(pw);
    await page.getByRole("button", { name: /Entrar/i }).click();

    await sidebarLocator(page).waitFor({ state: "visible", timeout: 120_000 }).catch(async () => {
      const err = await page.locator("[data-login-error]").textContent().catch(() => null);
      const still = await loginScreenVisible(page);
      throw new Error(
        still
          ? `Sigues en login. ${err?.trim() ? err.trim() : "Revisa credenciales y POST users.php."}`
          : "Tras Entrar no apareció la barra lateral."
      );
    });
  }

  await sidebarLocator(page).waitFor({ state: "visible", timeout: 60_000 }).catch(async () => {
    throw new Error(await diagnosePageFailure(page, "post-login"));
  });
}

async function waitForAppShell(page: import("@playwright/test").Page) {
  await sidebarLocator(page).waitFor({ state: "visible", timeout: 120_000 }).catch(async () => {
    throw new Error(await diagnosePageFailure(page, "navigate"));
  });
}

test("generar PNG del manual en public/docs/manual/screenshots", async ({ page }) => {
  await ensureLoggedIn(page);

  await page.screenshot({ path: path.join(OUT, "layout-general.png"), fullPage: true });

  await page.locator("header").first().screenshot({ path: path.join(OUT, "barra-superior.png") });

  await page.locator("main").screenshot({ path: path.join(OUT, "home-panel.png") });

  await page.goto(siteUrl("analisis"), { waitUntil: "load", timeout: 120_000 });
  await waitForAppShell(page);
  await delay(2500);
  await page.screenshot({ path: path.join(OUT, "analisis-widgets.png"), fullPage: true });

  await page.goto(siteUrl("tickets"), { waitUntil: "load", timeout: 120_000 });
  await waitForAppShell(page);
  await delay(2500);
  await page.screenshot({ path: path.join(OUT, "tickets-tabla.png"), fullPage: true });

  await page.goto(siteUrl("alertas"), { waitUntil: "load", timeout: 120_000 });
  await waitForAppShell(page);
  await delay(2000);
  await page.screenshot({ path: path.join(OUT, "alertas.png"), fullPage: true });

  await page.goto(siteUrl("notion"), { waitUntil: "load", timeout: 120_000 });
  await waitForAppShell(page);
  await delay(3500);
  await page.screenshot({ path: path.join(OUT, "notion-tabs.png"), fullPage: true });

  await gotoSite(page, "");
  await waitForAppShell(page);
  await page.getByRole("button", { name: "Calendario" }).click();
  await page.locator('[data-doc-screenshot="calendar-overlay"]').waitFor({ state: "visible", timeout: 20_000 });
  await page.locator('[data-doc-screenshot="calendar-overlay"]').screenshot({ path: path.join(OUT, "calendario.png") });
  await page.keyboard.press("Escape");
  await delay(400);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Shift+/");
  const shortcutsDlg = page.getByRole("dialog", { name: /Atajos útiles/i });
  await shortcutsDlg.waitFor({ state: "visible", timeout: 15_000 });
  await shortcutsDlg.screenshot({ path: path.join(OUT, "atajos-teclado.png") });
  await page.keyboard.press("Escape");

  await page.goto(siteUrl("usuarios"), { waitUntil: "load", timeout: 120_000 });
  await waitForAppShell(page);
  await delay(2500);
  await page.screenshot({ path: path.join(OUT, "usuarios.png"), fullPage: true });
});
