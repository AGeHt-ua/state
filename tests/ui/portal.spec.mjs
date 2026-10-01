// UI-тести ключових сценаріїв: так, як їх проходить людина в браузері.
// Підготовка людей і ролей — через API (швидко), а самі дії — кліками на сторінках.
import { test, expect } from "@playwright/test";
import { startMockDiscord } from "../mock-discord.mjs";

const API = process.env.TEST_URL || "http://localhost:8787";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "t-admin";
const RUN = Date.now().toString(36);
const pwd = (l) => "pass-" + l + "-123";
let ipN = Math.floor(Math.random() * 60000); // кожен запуск — інші «адреси», щоб не впертися в ліміт реєстрацій

async function api(method, path, body, token) {
  const headers = { "CF-Connecting-IP": "10.9." + (ipN >> 8 & 255) + "." + (ipN++ & 255) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
const apiLogin = async (login, password) => (await api("POST", "/api/auth", { login, password })).token;

const people = { head: "uihead" + RUN, staff: "uistaff" + RUN, cit: "uicit" + RUN, mgr: "uimgr" + RUN };

test.beforeAll(async () => {
  for (const [k, l] of Object.entries(people)) {
    await api("POST", "/api/register", { login: l, password: pwd(l), name: "UI " + k, accountType: k === "cit" ? "citizen" : "official", statId: "1", contact: "c", post: "x" });
  }
  const admin = await apiLogin("admin", ADMIN_PASSWORD);
  const users = (await api("GET", "/api/state", undefined, admin)).data.state_users;
  const role = (l, patch) => Object.assign({}, users.find((x) => x.login === l), { roles: ["official"], office: "directors" }, patch);
  const res = await api("POST", "/api/sync", { ops: [{ coll: "state_users", upsert: [
    role(people.head, { positionId: "director" }),
    role(people.staff, { positionId: "directors-staff" }),
    role(people.mgr, { positionId: "directors-staff", extraPermissions: ["managePeople"] })
  ] }] }, admin);
  expect(res.ok, res.error).toBeTruthy();
});

// Помилки в консолі (зокрема порушення CSP) — провал тесту
function watchConsole(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function uiLogin(page, login, password) {
  await page.goto("/cabinet/portal/");
  await page.getByLabel("Логін").fill(login);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Увійти до кабінету" }).click();
  await page.waitForURL(/\/cabinet\/(pending\/)?$/);
}

test("публічні сторінки відкриваються без помилок і порушень CSP", async ({ page }) => {
  const errors = watchConsole(page);
  for (const path of ["/", "/acts/", "/structure/", "/cabinet/portal/", "/register/?type=citizen"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("перемикання темної теми зберігається", async ({ page }) => {
  await page.goto("/");
  const before = await page.locator("html").getAttribute("data-theme");
  await page.locator("#theme-toggle").first().click();
  const after = await page.locator("html").getAttribute("data-theme");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", after);
});

test("вхід паролем, профіль і активні входи", async ({ page }) => {
  const errors = watchConsole(page);
  await uiLogin(page, people.cit, pwd(people.cit));
  await expect(page.locator("#f-login")).toHaveText(people.cit);
  await page.locator("#btn-edit-profile").click();
  await page.locator("#sessions-details summary").click();
  await expect(page.locator("#sessions-list")).toContainText("цей пристрій");
  expect(errors).toEqual([]);
});

test("невірний пароль — зрозуміла помилка", async ({ page }) => {
  await page.goto("/cabinet/portal/");
  await page.getByLabel("Логін").fill(people.cit);
  await page.getByLabel("Пароль").fill("wrong-password-1");
  await page.getByRole("button", { name: "Увійти до кабінету" }).click();
  await expect(page.locator("#login-error")).toContainText(/невірн/i);
});

test("вхід через Discord: новий учасник потрапляє в кабінет громадянина", async ({ page }) => {
  const mock = await startMockDiscord();
  try {
    mock.state.nextId = "75" + Date.now();
    await page.goto("/cabinet/portal/");
    await page.getByRole("link", { name: "Увійти через Discord" }).click();
    await page.waitForURL(/\/cabinet\/$/);
    await expect(page.locator("#profile-kind")).toHaveText("Громадянин штату");
    // Повторний вхід тим самим Discord — той самий акаунт
    const login = await page.locator("#f-login").textContent();
    await page.evaluate(() => logout());
    await page.goto("/cabinet/portal/");
    await page.getByRole("link", { name: "Увійти через Discord" }).click();
    await page.waitForURL(/\/cabinet\/$/);
    await expect(page.locator("#f-login")).toHaveText(login);
  } finally {
    await mock.close();
  }
});

test("документ: співробітник → директор → губернатор → у законодавчій базі", async ({ browser }) => {
  const post = "Посада UI " + RUN;
  // 1. Співробітник створює наказ і надсилає на погодження
  const staffCtx = await browser.newContext();
  const page = await staffCtx.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = watchConsole(page);
  await uiLogin(page, people.staff, pwd(people.staff));
  await page.goto("/cabinet/create/");
  await page.getByPlaceholder("ПІБ особи").first().fill("Тест Тестович");
  await page.getByPlaceholder("Посада особи").first().fill(post);
  await page.getByPlaceholder("Номер особи").first().fill("12345");
  await page.getByPlaceholder("Номер посади").first().fill("77");
  await page.getByRole("button", { name: "Авто" }).click();
  await page.locator("#btnSend").click();
  await page.locator('#menu-send [data-act="sendReview"]').click();
  await expect(page.locator("#apModal")).toBeVisible();
  await page.locator("#apConfirm").click();
  await expect(page.locator("#toast")).toContainText(/погодження|надіслано/i);
  expect(errors).toEqual([]);
  await staffCtx.close();

  // 2. Директор погоджує свій крок у «Повідомленнях»
  const headCtx = await browser.newContext();
  const head = await headCtx.newPage();
  await uiLogin(head, people.head, pwd(people.head));
  await head.goto("/cabinet/inbox/");
  await head.locator('[data-inbox-tab="approve"]').click();
  const headRow = head.locator("article, .admin-list-row, li").filter({ hasText: post }).first();
  await headRow.locator('[data-decide="approve"]').click();
  await expect(head.locator("#inbox-body")).not.toContainText(post);
  await headCtx.close();

  // 3. Губернатор (адміністратор) погоджує останній крок — документ чинний
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await uiLogin(admin, "admin", ADMIN_PASSWORD);
  await admin.goto("/cabinet/inbox/");
  await admin.locator('[data-inbox-tab="approve"]').click();
  const adminRow = admin.locator("article, .admin-list-row, li").filter({ hasText: post }).first();
  await adminRow.locator('[data-decide="approve"]').click();
  await expect(admin.locator("#inbox-body")).not.toContainText(post);
  await adminCtx.close();

  // 4. Будь-хто бачить документ у законодавчій базі й знаходить пошуком
  const anon = await browser.newPage();
  await anon.goto("/");
  await anon.locator("#site-search input[name=q]").fill(post);
  await anon.locator("#site-search input[name=q]").press("Enter");
  const hit = anon.getByRole("link", { name: new RegExp(post) }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(anon.locator("main")).toContainText("Тест Тестович");
  await anon.close();
});

test("ієрархія: менеджер не може редагувати адміністратора", async ({ page }) => {
  await uiLogin(page, people.mgr, pwd(people.mgr));
  await page.goto("/cabinet/admin/");
  await page.getByRole("tab", { name: /^Люди/ }).click();
  await page.locator('[data-edit-user="admin"]').click();
  await expect(page.locator("#user-rank-note")).toBeVisible();
  // А звичайного співробітника — може
  await page.keyboard.press("Escape");
  await page.goto("/cabinet/admin/");
  await page.getByRole("tab", { name: /^Люди/ }).click();
  await page.locator('[data-edit-user="' + people.staff + '"]').click();
  await expect(page.locator("#user-rank-note")).toBeHidden();
});

test("вхід, натиснутий до завантаження даних, не світить пароль в адресі", async ({ page }) => {
  // Сервер відповідає повільно: форма надсилається ще до того, як сторінка підключила свої обробники
  await page.route("**/api/state", async (route) => { await new Promise((ok) => setTimeout(ok, 2500)); await route.continue(); });
  await page.goto("/cabinet/portal/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Логін").fill(people.cit);
  await page.getByLabel("Пароль").fill(pwd(people.cit));
  await page.getByRole("button", { name: "Увійти до кабінету" }).click();
  expect(page.url()).not.toContain("password");
  await page.waitForURL(/\/cabinet\/$/);
  expect(page.url()).not.toContain("password");
});
