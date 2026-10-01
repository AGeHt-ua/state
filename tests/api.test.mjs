// Автотести API порталу. Запускаються проти локального Worker із ЧИСТОЮ базою:
//   cd worker && npx wrangler d1 execute state-db --local --file=schema.sql && npx wrangler dev --port 8787
//   npm test            (TEST_URL і ADMIN_PASSWORD — з оточення; за замовчуванням http://localhost:8787 і пароль із worker/.dev.vars)
// Кожна група запитів іде з окремої «адреси» (заголовок CF-Connecting-IP — локально його можна задати, у Cloudflare — ні),
// щоб обмеження частоти з однієї групи не заважали іншим.

import { startMockDiscord } from "./mock-discord.mjs";

const B = process.env.TEST_URL || "http://localhost:8787";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "t-admin";
const RUN = Date.now().toString(36);
let failures = 0;
let ip = "10.0.0.1";

function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log((ok ? "✅" : "❌") + " " + name + (detail ? " — " + detail : ""));
}
async function call(method, path, body, token) {
  const headers = { "CF-Connecting-IP": ip };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const post = (path, body, token) => call("POST", path, body, token);
const get = (path, token) => call("GET", path, undefined, token);
const login = async (l, p) => (await post("/api/auth", { login: l, password: p })).body.token;
const sync = (token, coll, upsert = [], remove = []) => post("/api/sync", { ops: [{ coll, upsert, remove }] }, token);
const state = async (token) => (await get("/api/state", token)).body.data;
const doc = async (token, id) => (await state(token)).state_docs.find((d) => d.id === id);
const pwd = (l) => "pass-" + l + "-123";
const u = (name) => name + RUN;

async function register(l, accountType = "official") {
  return post("/api/register", { login: l, password: pwd(l), name: "Test " + l, accountType, statId: "1", contact: "c", post: "x" });
}

// ---------- 1. Сервер і реєстрація ----------
check("сервер відповідає", (await get("/api/health")).status === 200);
const admin = await login("admin", ADMIN_PASSWORD);
check("вхід адміністратора", !!admin);

ip = "10.0.1.1";
check("короткий пароль відхиляється", (await post("/api/register", { login: u("short"), password: "1234", name: "x", accountType: "citizen" })).status === 400);
check("недопустимий логін відхиляється", (await post("/api/register", { login: "Ив", password: "long-enough-1", name: "x", accountType: "citizen" })).status === 400);
const people = { head: u("head"), staff: u("staff"), cm1: u("cma"), cm2: u("cmb"), cm3: u("cmc") };
let regOk = true;
for (const [i, l] of Object.values(people).entries()) { ip = "10.0.2." + i; regOk = regOk && (await register(l)).status === 200; }
check("реєстрація посадовців", regOk);
ip = "10.0.3.1";
const cit = u("cit");
check("реєстрація громадянина", (await register(cit, "citizen")).status === 200);
check("зайнятий логін — 409", (await register(cit, "citizen")).status === 409);

// Призначення: директор, співробітник, троє конгресменів
const users = (await state(admin)).state_users;
const role = (l, patch) => Object.assign({}, users.find((x) => x.login === l), { roles: ["official"], office: "directors" }, patch);
const assign = await sync(admin, "state_users", [
  role(people.head, { positionId: "director" }),
  role(people.staff, { positionId: "directors-staff" }),
  role(people.cm1, { positionId: "directors-staff", congressMember: true }),
  role(people.cm2, { positionId: "directors-staff", congressMember: true }),
  role(people.cm3, { positionId: "directors-staff", congressMember: true })
]);
check("адмін призначає людей", assign.status === 200, assign.body.error);

ip = "10.0.4.1";
const T = {};
for (const [k, l] of Object.entries(people)) T[k] = await login(l, pwd(l));
T.cit = await login(cit, pwd(cit));
check("вхід усіх тестових людей", Object.values(T).every(Boolean));

// ---------- 2. Видимість і права ----------
const anon = await state();
check("анонім не бачить контактів", anon.state_users.every((x) => !x.contact));
const citUsers = (await state(T.cit)).state_users;
check("громадянин бачить лише свій повний профіль", citUsers.filter((x) => x.contact).every((x) => x.login === cit));
check("громадянин не може змінити собі роль", (await sync(T.cit, "state_users", [{ login: cit, roles: ["governor"] }])).status === 403);
check("співробітник не може видати собі права", (await sync(T.staff, "state_users", [{ login: people.staff, roles: ["governor"] }])).status === 403);
check("громадянин не може створити документ", (await sync(T.cit, "state_docs", [{ id: u("x"), status: "draft", ownerLogin: cit }])).status === 403);

// ---------- 3. Повний цикл погодження ----------
const d1 = u("doc1");
const steps = ["position:director", "position:governor-chief"];
const base = { id: d1, type: "Наказ", title: "Наказ " + d1, number: "1/2026", date: "2026-10-01", html: "<p>Текст</p>", text: "Текст наказу про тестування", ownerLogin: people.staff, author: "Test", office: "directors", votes: {} };
let r = await sync(T.staff, "state_docs", [Object.assign({}, base, { status: "review", approvalSteps: steps, approvalIndex: 0, approverOffice: steps[0] })]);
check("співробітник відправляє на погодження", r.status === 200, r.body.error);
let cur = await doc(T.head, d1);
r = await sync(T.head, "state_docs", [Object.assign({}, cur, { approvalIndex: 1, approverOffice: steps[1], status: "review" })]);
check("директор погоджує свій крок", r.status === 200, r.body.error);
cur = await doc(T.staff, d1);
r = await sync(T.staff, "state_docs", [Object.assign({}, cur, { status: "ok" })]);
check("автор не може сам опублікувати", r.status === 403);
cur = await doc(admin, d1);
r = await sync(admin, "state_docs", [Object.assign({}, cur, { status: "ok" })]);
check("губернатор погоджує останній крок", r.status === 200, r.body.error);
check("документ опубліковано", (await doc(T.cit, d1) || {}).status === "ok");
const listed = await doc(admin, d1);
check("у списку документ легкий (без тексту-оформлення й версій)", listed && listed._partial && listed.html === undefined && listed.docHtml === undefined && listed.versions === undefined);
const fullAfter = (await get("/api/doc/" + d1, admin)).body.doc;
check("після погоджень текст документа збережено", fullAfter.html === "<p>Текст</p>");

// ---------- 4. Атаки на документи ----------
const victim = await doc(T.staff, d1);
check("співробітник не змінює чинний документ", (await sync(T.head, "state_docs", [Object.assign({}, victim, { title: "ПІДРОБЛЕНО" })])).status === 403);
check("співробітник не видаляє документ", (await sync(T.staff, "state_docs", [], [d1])).status === 403);
check("публікація без погодження — заборонено", (await sync(T.staff, "state_docs", [Object.assign({}, base, { id: u("bypass"), status: "ok" })])).status === 403);
check("документ від чужого імені — заборонено", (await sync(T.staff, "state_docs", [Object.assign({}, base, { id: u("fake"), status: "draft", ownerLogin: "admin" })])).status === 403);
check("себе погоджувачем — заборонено", (await sync(T.staff, "state_docs", [Object.assign({}, base, { id: u("self"), status: "review", approvalSteps: ["user:" + people.staff], approvalIndex: 0, approverOffice: "user:" + people.staff })])).status === 403);
check("голоси наперед — заборонено", (await sync(T.staff, "state_docs", [Object.assign({}, base, { id: u("votes"), type: "Закон", status: "congress", approvalSteps: ["congress"], approvalIndex: 0, approverOffice: "congress", votes: { a: { vote: "for" } } })])).status === 403);

// ---------- 5. Конгрес: одночасні голоси й підсумок ----------
const law = u("law");
r = await sync(admin, "state_docs", [Object.assign({}, base, { id: law, type: "Закон", title: "Закон " + law, ownerLogin: "admin", author: "Адміністратор", office: "governor", status: "congress", approvalSteps: ["congress", "position:governor-chief"], approvalIndex: 0, approverOffice: "congress" })]);
check("закон на голосуванні", r.status === 200, r.body.error);
const early = await doc(T.cm1, law);
check("підсумок без більшості — заборонено", (await sync(T.cm1, "state_docs", [Object.assign({}, early, { status: "review", approvalIndex: 1, approverOffice: "position:governor-chief", votes: {} })])).status === 403);
const votes = await Promise.all([T.cm1, T.cm2].map((t) => post("/api/vote", { id: law, vote: "for" }, t)));
check("одночасні голоси зараховані", votes.every((v) => v.status === 200) && Object.keys((await doc(admin, law)).votes || {}).length === 2);
check("не-конгресмен не голосує", (await post("/api/vote", { id: law, vote: "for" }, T.staff)).status === 403);
const voted = await doc(T.cm2, law);
r = await sync(T.cm2, "state_docs", [Object.assign({}, voted, { status: "review", approvalIndex: 1, approverOffice: "position:governor-chief", votes: {} })]);
check("підсумок за більшістю — закон іде далі", r.status === 200, r.body.error);

// ---------- 6. Захист від перезапису й скорочені документи ----------
const stale = await doc(admin, d1);
r = await sync(admin, "state_docs", [Object.assign({}, stale, { note: "A" })]);
const r2 = await sync(admin, "state_docs", [Object.assign({}, stale, { note: "B" })]);
check("застаріла зміна — 409", r.status === 200 && r2.status === 409);
const full = (await get("/api/doc/" + d1, admin)).body.doc;
check("версії й історія не губляться", Array.isArray(full.history) && full.history.length >= 0 && full.note === "A");

const heavy = u("heavy");
const bigHtml = "<div style=\"background:url(data:image/png;base64," + "A".repeat(50000) + ")\">Бланк</div>";
await sync(admin, "state_docs", [Object.assign({}, base, { id: heavy, ownerLogin: "admin", author: "Адміністратор", office: "governor", status: "draft", docHtml: bigHtml,
  versions: [{ id: "v1", docHtml: bigHtml }, { id: "v2", docHtml: bigHtml }, { id: "v3", docHtml: bigHtml }] })]);
const heavyFull = (await get("/api/doc/" + heavy, admin)).body.doc;
check("версії не дублюють однакове оформлення", heavyFull.versions.filter((v) => v.docHtml).length === 1 && heavyFull.docHtml === bigHtml);

// ---------- 7. Зв'язки: новий акт скасовує старий ----------
const repealer = u("repeal");
const cur1 = await doc(admin, d1);
r = await sync(admin, "state_docs", [Object.assign({}, base, { id: repealer, title: "Скасування", ownerLogin: "admin", author: "Адміністратор", office: "governor", status: "ok", links: { amends: [], repeals: [d1] } })]);
check("публікація акта, що скасовує інший", r.status === 200, r.body.error);
check("скасований акт втратив чинність", (await doc(admin, d1)).status === "dead" && cur1.status === "ok");
const approverEdit = await doc(admin, law);
check("погоджувач не дописує зв'язки", (await sync(T.head, "state_docs", [Object.assign({}, approverEdit, { links: { amends: [], repeals: [repealer] } })])).status === 403);

// ---------- 8. Скидання пароля ----------
r = await post("/api/reset-password", { login: people.staff }, admin);
check("адмін скидає пароль", r.status === 200 && !!r.body.password);
const temp = r.body.password;
check("старий пароль більше не діє", !(await login(people.staff, pwd(people.staff))));
const tempLogin = await post("/api/auth", { login: people.staff, password: temp });
check("вхід тимчасовим паролем із вимогою змінити", tempLogin.status === 200 && tempLogin.body.mustChangePassword === true);
r = await post("/api/password", { oldPassword: temp, newPassword: pwd(people.staff) }, tempLogin.body.token);
const after = await post("/api/auth", { login: people.staff, password: pwd(people.staff) });
check("після зміни вимога знята", r.status === 200 && after.body.mustChangePassword === false);
T.staff = after.body.token; // скидання пароля завершило попередні входи співробітника
check("співробітник не скидає чужі паролі", (await post("/api/reset-password", { login: people.head }, after.body.token)).status === 403);

// ---------- 9. Журнал ----------
const audit = await get("/api/audit", admin);
const actions = (audit.body.items || []).map((x) => x.action);
check("журнал доступний адміну", audit.status === 200);
check("у журналі є призначення, скидання пароля й скасування", ["Змінено людину", "Скинуто пароль", "Документ: скасовує інші акти"].every((a) => actions.includes(a)), actions.slice(0, 6).join(" | "));
check("журнал недоступний співробітнику", (await get("/api/audit", T.head)).status === 403);

// ---------- 10. Зміни з минулого візиту ----------
const before = Math.max(...(await state(admin)).state_docs.map((d) => d._rev));
const temporary = u("tmp");
await sync(admin, "state_docs", [Object.assign({}, base, { id: temporary, ownerLogin: "admin", status: "draft" })]);
await sync(admin, "state_docs", [], [temporary]);
const changes = await get("/api/changes?since=" + before, admin);
check("зміни повідомляють про видалений запис", (changes.body.removed || []).some((x) => x.id === temporary));
check("область видимості в змінах", changes.body.scope === (await get("/api/state", admin)).body.scope);

// ---------- 11. Ліміти розміру й частоти ----------
check("звернення понад 5000 символів — заборонено", (await sync(T.cit, "state_appeals", [{ id: u("big"), ownerLogin: cit, office: "directors", text: "x".repeat(6000), status: "waiting" }])).status === 403);
ip = "10.0.9.1";
let blocked = 0;
for (let i = 0; i < 12; i++) if ((await post("/api/auth", { login: people.cm3, password: "wrong-" + i })).status === 429) blocked++;
check("блокування після 10 невдалих входів", blocked >= 1, "заблоковано " + blocked + " з 12");
ip = "10.0.9.2";
check("інші акаунти входять", !!(await login(people.cm1, pwd(people.cm1))));
check("фото, якого немає, — 404", (await get("/api/photo/" + cit)).status === 404);

// ---------- 12. Ієрархія: ніхто, крім головного адміністратора, не дає повних прав і не чіпає рівних/вищих ----------
ip = "10.0.10.1";
check("зарезервований логін — 409", (await register("root")).status === 409);
const gov = u("gov"), gov2 = u("govb"), mgr = u("mgr");
for (const [i, l] of [gov, gov2, mgr].entries()) { ip = "10.0.11." + i; await register(l); }
let all = (await state(admin)).state_users;
const pick = (l) => all.find((x) => x.login === l);
r = await sync(admin, "state_users", [
  Object.assign({}, pick(gov), { roles: ["governor"], office: "governor", positionId: "governor-chief" }),
  Object.assign({}, pick(gov2), { roles: ["governor"], office: "governor", positionId: "governor-chief" }),
  Object.assign({}, pick(mgr), { roles: ["official"], office: "directors", positionId: "director", extraPermissions: ["managePeople"] })
]);
check("головний адміністратор призначає губернаторів і менеджера", r.status === 200, r.body.error);
ip = "10.0.12.1";
const TG = await login(gov, pwd(gov)), TM = await login(mgr, pwd(mgr));
all = (await state(TG)).state_users;
check("губернатор не змінює головного адміністратора", (await sync(TG, "state_users", [Object.assign({}, pick("admin") || { login: "admin" }, { roles: ["citizen"] })])).status === 403);
check("губернатор не чіпає рівного губернатора", (await sync(TG, "state_users", [Object.assign({}, pick(gov2), { roles: ["citizen"], office: "citizens", positionId: "" })])).status === 403);
check("губернатор не робить нових губернаторів", (await sync(TG, "state_users", [Object.assign({}, pick(people.staff), { roles: ["governor"], office: "governor", positionId: "governor-chief" })])).status === 403);
check("губернатор не видає повних прав", (await sync(TG, "state_users", [Object.assign({}, pick(people.staff), { extraPermissions: ["createDocs", "publishDocs", "approveDocs", "approveAnyDocs", "editOwnDocs", "editAllDocs", "manageDocs", "manageAppeals", "managePeople", "manageStructure", "manageRoutes", "approveProfiles", "manageCongress"] })])).status === 403);
check("губернатор не скидає пароль головному адміністратору", (await post("/api/reset-password", { login: "admin" }, TG)).status === 403);
check("губернатор не видаляє рівного", (await post("/api/delete-user", { login: gov2 }, TG)).status === 403);
check("губернатор керує нижчими (співробітник)", (await sync(TG, "state_users", [Object.assign({}, pick(people.staff), { post: "Старший співробітник" })])).status === 200);
check("менеджер не чіпає губернатора", (await sync(TM, "state_users", [Object.assign({}, pick(gov), { roles: ["citizen"] })])).status === 403);
all = (await state(TM)).state_users;
check("менеджер не видає права, яких не має", (await sync(TM, "state_users", [Object.assign({}, pick(people.staff), { extraPermissions: ["manageStructure"] })])).status === 403);
check("менеджер не підносить до свого рангу", (await sync(TM, "state_users", [Object.assign({}, pick(people.staff), { extraPermissions: ["managePeople"] })])).status === 403);
check("губернатор не створює посаду рівня «Адміністратор»", (await sync(TG, "state_positions", [{ id: u("pos"), office: "directors", title: "Супер", level: "admin", permissions: [] }])).status === 403);

// ---------- 13. Журнал документа й переписку підписує сервер ----------
const stampId = u("stamp");
await sync(T.staff, "state_docs", [Object.assign({}, base, { id: stampId, status: "draft", history: [{ at: "2020-01-01T00:00:00Z", by: "admin", byName: "Губернатор", action: "Підроблено" }] })]);
const stampedFull = (await get("/api/doc/" + stampId, admin)).body.doc;
const lastEntry = stampedFull.history.slice(-1)[0];
check("підпис у журналі — справжній автор і час сервера", lastEntry.by === people.staff && lastEntry.byName !== "Губернатор" && lastEntry.at !== "2020-01-01T00:00:00Z");
const apId = u("apl");
await sync(T.cit, "state_appeals", [{ id: apId, ownerLogin: cit, office: "directors", text: "Питання", status: "waiting", thread: [{ by: "admin", byName: "Директор", text: "Підроблена відповідь", at: "2020-01-01T00:00:00Z" }] }]);
const apRow = (await state(T.cit)).state_appeals.find((x) => x.id === apId);
check("повідомлення у зверненні підписане справжнім автором", apRow && apRow.thread[0].by === cit && apRow.thread[0].byName !== "Директор");

// ---------- 14. Активні входи ----------
ip = "10.0.13.1";
const s1 = await login(people.cm2, pwd(people.cm2)), s2 = await login(people.cm2, pwd(people.cm2));
const sessionList = (await get("/api/sessions", s1)).body.items || [];
check("список активних входів", sessionList.length >= 2 && sessionList.some((x) => x.current));
r = await post("/api/sessions/revoke", { all: true }, s1);
check("вийти на всіх інших пристроях", r.status === 200 && (r.body.items || []).length === 1);
check("інший вхід більше не діє", (await get("/api/sessions", s2)).status === 401);

// ---------- 15. Вхід через Discord (підставний Discord на порту 9098; лише якщо Worker запущено з DISCORD_API_BASE) ----------
if ((await get("/api/health")).body.discord) {
  const mock = await startMockDiscord();
  const hop = async (path) => {
    const r = await fetch(B + path, { redirect: "manual", headers: { "CF-Connecting-IP": ip } });
    return r.headers.get("location") || "";
  };
  // Повний прохід: сайт → /start → «Discord» → /callback → сайт з одноразовим кодом
  const discordLogin = async (discordId) => {
    const authUrl = new URL(await hop("/api/discord/start?mode=login"));
    return hop("/api/discord/callback?code=" + discordId + "&state=" + authUrl.searchParams.get("state"));
  };
  const codeFrom = (loc) => new URLSearchParams(loc.split("#")[1] || "").get("discord_code");
  ip = "10.0.15.1";
  const dId = "71" + Date.now();
  let loc = await discordLogin(dId);
  check("Discord: новий учасник отримує одноразовий код", !!codeFrom(loc) && loc.includes("new=1"), loc);
  const first = await post("/api/discord/exchange", { code: codeFrom(loc) });
  check("Discord: код обмінюється на вхід", first.status === 200 && !!first.body.token);
  const dUser = (first.body.data.state_users || []).find((x) => x.login === first.body.login);
  check("Discord: створено акаунт громадянина", dUser && dUser.roles.includes("citizen") && dUser.office === "citizens");
  check("Discord: код одноразовий", (await post("/api/discord/exchange", { code: codeFrom(loc) })).status === 400);
  loc = await discordLogin(dId);
  const again = await post("/api/discord/exchange", { code: codeFrom(loc) });
  check("Discord: повторний вхід — той самий акаунт", again.body.login === first.body.login && !loc.includes("new=1"));
  check("Discord: підроблений state відхиляється", (await hop("/api/discord/callback?code=1&state=" + "x".repeat(32))).includes("discord_error=expired"));
  check("Discord: не учасник сервера не входить", (await discordLogin("7404" + Date.now())).includes("discord_error=not_member"));

  // Прив'язка до наявного акаунта
  const linkId = "72" + Date.now();
  const linkCode = (await post("/api/discord/link-code", {}, T.cit)).body.code;
  const linkAuth = new URL(await hop("/api/discord/start?mode=link&code=" + linkCode));
  loc = await hop("/api/discord/callback?code=" + linkId + "&state=" + linkAuth.searchParams.get("state"));
  check("Discord: прив'язка до акаунта", loc.includes("discord=linked") && (await get("/api/discord/status", T.cit)).body.linked === true, loc);
  loc = await discordLogin(linkId);
  check("Discord: вхід у прив'язаний акаунт", (await post("/api/discord/exchange", { code: codeFrom(loc) })).body.login === cit);
  const stolen = (await post("/api/discord/link-code", {}, T.staff)).body.code;
  const stolenAuth = new URL(await hop("/api/discord/start?mode=link&code=" + stolen));
  loc = await hop("/api/discord/callback?code=" + linkId + "&state=" + stolenAuth.searchParams.get("state"));
  check("Discord: чужий Discord не прив'язати вдруге", loc.includes("discord_error=already_linked"));
  check("Discord: код прив'язки без входу не видається", (await post("/api/discord/link-code", {})).status === 401);
  check("Discord: відв'язка", (await post("/api/discord/unlink", {}, T.cit)).body.linked === false);
  await mock.close();
} else {
  console.log("ℹ️  Вхід через Discord не налаштовано на тестовому Worker — розділ 15 пропущено");
}

console.log(failures ? "\n" + failures + " перевірок не пройшло" : "\nУсі перевірки пройшли");
process.exit(failures ? 1 : 0);
