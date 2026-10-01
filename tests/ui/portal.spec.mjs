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
  // 5. Проєкт підготував співробітник, а підписав той, хто остаточно погодив (губернатор)
  await expect(anon.locator(".meta-table")).toContainText("Проєкт підготував");
  await expect(anon.locator(".meta-table")).toContainText("Підписав");
  const docUrl = anon.url();
  await anon.close();

  // 6. Журнал змін: редакції з «Що змінилось» і перегляд редакції
  const auditCtx = await browser.newContext();
  const auditor = await auditCtx.newPage();
  await uiLogin(auditor, "admin", ADMIN_PASSWORD);
  await auditor.goto(docUrl);
  await expect(auditor.locator(".lifecycle-card").last()).toContainText("Редакції");
  await auditor.locator("[data-diff]").first().click();
  await expect(auditor.locator("#version-modal")).toBeVisible();
  await expect(auditor.locator("#version-title")).toContainText("Що змінилось");
  await auditor.locator("[data-close-version]").click();
  await auditor.locator("[data-version]").first().click();
  await expect(auditor.locator("#version-body")).toContainText("Тест Тестович");
  await auditCtx.close();
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

test("Discord без дублів: новий акаунт → прив'язка до основного → адмін бачить і відв'язує", async ({ browser }) => {
  const mock = await startMockDiscord();
  try {
    mock.state.nextId = "76" + Date.now();
    // 1. Людина спершу натиснула «Увійти через Discord» — створився новий акаунт, кабінет пояснює, як уникнути дубля
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto("/cabinet/portal/");
    await page.getByRole("link", { name: "Увійти через Discord" }).click();
    await page.waitForURL(/\/cabinet\/$/);
    await expect(page.locator("main .notice").first()).toContainText("створено новий акаунт через Discord");
    const dupLogin = await page.locator("#f-login").textContent();
    // 2. Входить своїм акаунтом з паролем і прив'язує той самий Discord — дубль зникає
    await page.evaluate(() => logout());
    await uiLogin(page, people.cit, pwd(people.cit));
    await page.locator("#btn-edit-profile").click();
    await page.locator("#discord-details summary").click();
    await page.locator("#discord-link").click();
    await page.waitForURL(/\/cabinet\/$/);
    await expect(page.locator("#discord-msg")).toContainText("Порожній акаунт");
    await expect(page.locator("#discord-line")).toContainText("Прив'язано");
    await ctx.close();

    // 3. Адміністратор: позначка Discord у списку, дубля немає, відв'язка в «Змінити»
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    admin.on("dialog", (d) => d.accept());
    await uiLogin(admin, "admin", ADMIN_PASSWORD);
    await admin.goto("/cabinet/admin/");
    await admin.getByRole("tab", { name: /^Люди/ }).click();
    await admin.locator("#people-f").selectOption("discord");
    await expect(admin.locator("#people-box")).toContainText("Discord ·");
    await expect(admin.locator(`[data-edit-user="${dupLogin}"]`)).toHaveCount(0);
    await admin.locator(`[data-edit-user="${people.cit}"]`).click();
    await expect(admin.locator("#user-discord-line")).toContainText("прив'язано до акаунта з паролем");
    await admin.locator("#user-discord-unlink").click();
    await expect(admin.locator("#user-discord-line")).toContainText("не прив'язано");
    await adminCtx.close();
  } finally {
    await mock.close();
  }
});

test("шаблони редактора зберігаються на сервері й видно на іншому пристрої", async ({ browser }) => {
  const name = "Шаблон UI " + RUN;
  // Пристрій 1: створюємо шаблон
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  p1.on("dialog", (d) => d.accept(d.type() === "prompt" ? name : undefined));
  await uiLogin(p1, people.head, pwd(people.head));
  await p1.goto("/cabinet/create/");
  await p1.locator('.wd-tab[data-tab="file"]').click();
  await p1.locator('.rb-btn[data-act="newSlot"]').click();
  await expect(p1.locator("#slotSel")).toContainText(name);
  await expect(p1.locator("#saveState")).toHaveText("Збережено", { timeout: 15000 });
  await ctx1.close();

  // Пристрій 2: чистий браузер — шаблон приходить із сервера
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await uiLogin(p2, people.head, pwd(people.head));
  await p2.goto("/cabinet/create/");
  await expect(p2.locator("#slotSel")).toContainText(name);
  await ctx2.close();
});

test("редактор: вставка розмітки стає оформленим документом", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await uiLogin(page, people.head, pwd(people.head));
  await page.goto("/cabinet/create/");
  await page.locator('.wd-tab[data-tab="insert"]').click();
  await page.locator('.rb-btn[data-act="markup"]').click();
  await expect(page.locator("#mkModal")).toBeVisible();
  await page.locator("#mkSrc").fill(["# РОЗПОРЯДЖЕННЯ ТЕСТ", "[center]**Про перевірку розмітки**[/center]", "1. Перший пункт для {ПІБ}.", "2. Другий пункт.", "[sign]"].join(String.fromCharCode(10)));
  await expect(page.locator("#mkPreview h1")).toHaveText("РОЗПОРЯДЖЕННЯ ТЕСТ");
  await page.locator('[data-act="mkReplace"]').click();
  await expect(page.locator("#editor h1")).toHaveText("РОЗПОРЯДЖЕННЯ ТЕСТ");
  await expect(page.locator("#editor ol li")).toHaveCount(2);
  await expect(page.locator('#editor .fld[data-f="name"]')).toHaveCount(1);
  await expect(page.locator("#editor table.sig")).toHaveCount(1);
});

test("звернення: громадянин подає, апарат відповідає в переписці", async ({ browser }) => {
  const text = "Прошу перевірити UI " + RUN + " — тестове звернення.";
  const citCtx = await browser.newContext();
  const cit = await citCtx.newPage();
  cit.on("dialog", (d) => d.accept());
  await uiLogin(cit, people.cit, pwd(people.cit));
  await cit.goto("/cabinet/appeals/");
  await cit.locator("#appeal-new-btn").click();
  await cit.locator("#appeal-form select[name=office]").selectOption("directors");
  await cit.locator("#appeal-form textarea[name=text]").fill(text);
  // Дані людини підставлені з профілю — розділ «Ваші дані» згорнутий
  await expect(cit.locator("#appeal-me-line")).toContainText("UI cit");
  await cit.locator("#appeal-form button[type=submit]").click();
  await expect(cit.locator("#appeal-chat")).toContainText(text);
  await expect(cit.locator("#appeal-detail .badge")).toContainText("Очікує відповіді");

  const headCtx = await browser.newContext();
  const head = await headCtx.newPage();
  await uiLogin(head, people.head, pwd(people.head));
  await head.goto("/cabinet/appeals/");
  await head.locator('#appeals-tabs [data-tab="office"]').click();
  await head.locator(".appeal-item", { hasText: "UI " + RUN }).click();
  await head.locator("#appeal-reply textarea").fill("Відповідь апарату " + RUN);
  await head.locator("#appeal-reply button[type=submit]").click();
  await expect(head.locator("#appeal-chat")).toContainText("Відповідь апарату " + RUN);
  await headCtx.close();

  // Після оновлення сторінки відкрите звернення лишається відкритим (адреса …/appeals/#id), у списку — остання репліка
  await cit.reload();
  await expect(cit.locator(".appeal-item.is-active")).toContainText("Відповідь апарату " + RUN);
  await expect(cit.locator("#appeal-chat")).toContainText("Відповідь апарату " + RUN);
  await expect(cit.locator("#appeal-detail .badge")).toContainText("Відповідь надана");
  await citCtx.close();
});

test("редактор: кнопка «</> Код» і Ctrl+Shift+M відкривають вставку розмітки", async ({ page }) => {
  await uiLogin(page, people.head, pwd(people.head));
  await page.goto("/cabinet/create/");
  await page.locator(".tb-code").click();
  await expect(page.locator("#mkModal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mkModal")).toBeHidden();
  await page.locator("#editor").click();
  await page.keyboard.press("Control+Shift+M");
  await expect(page.locator("#mkModal")).toBeVisible();
});

test("профіль: аватар з Discord підставляється в попередній перегляд", async ({ page }) => {
  const mock = await startMockDiscord();
  try {
    mock.state.nextId = "77" + Date.now();
    page.on("dialog", (d) => d.accept());
    await uiLogin(page, people.mgr, pwd(people.mgr));
    await page.locator("#btn-edit-profile").click();
    await page.locator("#discord-details summary").click();
    await page.locator("#discord-link").click();
    await page.waitForURL(/\/cabinet\/$/);
    await page.locator("#profile-modal .modal-close").click();
    await page.locator("#btn-edit-profile").click();
    await expect(page.locator("#profile-photo-discord")).toBeVisible();
    await page.locator("#profile-photo-discord").click();
    await expect(page.locator("#profile-photo-preview img")).toHaveCount(1);
    await expect(page.locator("#profile-photo-msg")).toContainText("Аватар з Discord");
  } finally {
    await mock.close();
  }
});
