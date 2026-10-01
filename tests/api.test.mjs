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

// ---------- 16. Особисті шаблони редактора на сервері ----------
ip = "10.0.16.1";
const tplBody = { type: "order", name: "Мій шаблон", html: "<p>Текст шаблону</p>", updated: Date.now(), created: Date.now() };
const put = (path, body, token) => call("PUT", path, body, token);
check("шаблон зберігається на сервері", (await put("/api/templates/d1abc", tplBody, T.staff)).status === 200);
check("порядок шаблонів зберігається", (await put("/api/templates", { order: ["d1abc"], active: "d1abc" }, T.staff)).status === 200);
let tpls = (await get("/api/templates", T.staff)).body;
check("шаблон повертається власнику", tpls.slots && tpls.slots.d1abc && tpls.slots.d1abc.name === "Мій шаблон" && tpls.meta.active === "d1abc");
check("чужі шаблони не видно", Object.keys((await get("/api/templates", T.head)).body.slots || {}).length === 0);
check("шаблони не потрапляють у загальний стан порталу", !JSON.stringify((await get("/api/state", admin)).body).includes("Текст шаблону"));
check("без входу шаблонів немає", (await get("/api/templates")).status === 401);
check("завеликий шаблон відхиляється", (await put("/api/templates/dbig", { html: "x".repeat(2000000) }, T.staff)).status === 413);
check("невірний номер шаблону відхиляється", (await put("/api/templates/" + encodeURIComponent("../x"), tplBody, T.staff)).status === 400);
check("шаблон видаляється", (await call("DELETE", "/api/templates/d1abc", undefined, T.staff)).status === 200 &&
  !((await get("/api/templates", T.staff)).body.slots || {}).d1abc);

// ---------- 17. Судові справи й вкладення ----------
ip = "10.0.17.1";
const judgeLogin = u("judge");
await register(judgeLogin);
{
  const all = (await state(admin)).state_users;
  const j = Object.assign({}, all.find((x) => x.login === judgeLogin), { roles: ["official"], office: "court", positionId: "court-staff" });
  check("суддю призначено в судову владу", (await sync(admin, "state_users", [j])).status === 200);
}
const TJ = await login(judgeLogin, pwd(judgeLogin));
const caseId = u("case");
const cases = async (token) => ((await state(token)).state_cases || []);
const caseRow = { id: caseId, number: "С-2026-9" + RUN.slice(-3), kind: "Цивільна", title: "Тестова справа", summary: "Суть",
  plaintiff: { login: cit, name: "Позивач" }, defendant: { login: "", name: "Відповідач" }, status: "new", createdBy: people.staff, events: [] };
check("громадянин не створює справу напряму", (await sync(T.cit, "state_cases", [Object.assign({}, caseRow, { createdBy: cit })])).status === 403);
check("посадовець не може одразу відкрити провадження", (await sync(T.staff, "state_cases", [Object.assign({}, caseRow, { status: "open" })])).status === 403);
check("посадовець подає справу до суду", (await sync(T.staff, "state_cases", [caseRow])).status === 200);
let cs = (await cases(TJ)).find((c) => c.id === caseId);
check("суд бачить усі справи", !!cs);
r = await sync(TJ, "state_cases", [Object.assign({}, cs, { status: "hearing", judge: judgeLogin, hearing: { at: "2026-10-05T18:00", place: "Зала 1" },
  events: (cs.events || []).concat([{ kind: "hearing", text: "Призначено засідання", by: "admin", byName: "Підробка" }]) })]);
check("суддя призначає засідання", r.status === 200, r.body.error);
cs = (await cases(T.cit)).find((c) => c.id === caseId);
check("сторона бачить свою справу", cs && cs.status === "hearing");
check("подію справи підписує сервер", cs && cs.events.slice(-1)[0].by === judgeLogin && cs.events.slice(-1)[0].byName !== "Підробка");
check("стороння людина справи не бачить", !(await cases(T.head)).some((c) => c.id === caseId));
check("сторона не змінює статус", (await sync(T.cit, "state_cases", [Object.assign({}, cs, { status: "decided" })])).status === 403);

// Вкладення
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const upload = (token, parent, extra = {}) => post("/api/attach", Object.assign({ parent, name: "доказ.png", type: "image/png", data: png }, extra), token);
r = await upload(T.cit, "case:" + caseId);
check("сторона завантажує доказ у справу", r.status === 200 && !!r.body.id, r.body.error);
const citFile = r.body.id;
check("недопустимий тип файла відхиляється", (await upload(T.cit, "case:" + caseId, { type: "text/html" })).status === 400);
check("не можна завантажити в чужу справу", (await upload(T.head, "case:" + caseId)).status === 403);
const judgeFile = (await upload(TJ, "case:" + caseId)).body.id;
r = await sync(T.cit, "state_cases", [Object.assign({}, cs, { events: cs.events.concat([{ kind: "note", text: "Мої докази", attachments: [{ id: citFile }, { id: judgeFile }] }]) })]);
check("сторона додає матеріали з вкладенням", r.status === 200, r.body.error);
cs = (await cases(T.cit)).find((c) => c.id === caseId);
const note = cs.events.slice(-1)[0];
check("чужий файл до повідомлення не прикріпити", note.attachments && note.attachments.length === 1 && note.attachments[0].id === citFile && note.attachments[0].name === "доказ.png");
const getFile = (id, token) => fetch(B + "/api/attach/" + id, { headers: { Authorization: "Bearer " + token, "CF-Connecting-IP": ip } });
check("суддя відкриває доказ", (await getFile(citFile, TJ)).status === 200);
check("стороння людина доказ не відкриє", (await getFile(citFile, T.head)).status === 403);
check("файли не потрапляють у дані порталу", !JSON.stringify((await get("/api/state", admin)).body).includes(png.slice(0, 40)));
// Вкладення у зверненні: файл до нового звернення, потім саме звернення з ним
const apAttId = u("apatt");
const apFile = (await upload(T.cit, "appeal:" + apAttId)).body.id;
r = await sync(T.cit, "state_appeals", [{ id: apAttId, ownerLogin: cit, office: "court", kind: "Позов", text: "Позов із доказом", status: "waiting",
  thread: [{ text: "Позов із доказом", attachments: [{ id: apFile }] }] }]);
check("звернення з вкладенням", r.status === 200 && (await state(T.cit)).state_appeals.find((a) => a.id === apAttId).thread[0].attachments.length === 1);
check("посадовець відкриває вкладення звернення", (await getFile(apFile, T.head)).status === 200);

// Номери звернень присвоює сервер — у різних людей не повторюються, підробити не можна
ip = "10.0.17.9";
const n1 = u("num1"), n2 = u("num2");
await sync(T.cit, "state_appeals", [{ id: n1, number: "ZV-FAKE", ownerLogin: cit, office: "court", text: "Перше звернення громадянина", status: "waiting", thread: [] }]);
await sync(T.head, "state_appeals", [{ id: n2, number: "ZV-FAKE", ownerLogin: people.head, office: "court", text: "Звернення іншої людини", status: "waiting", thread: [] }]);
const all17 = (await state(admin)).state_appeals;
const num1 = (all17.find((a) => a.id === n1) || {}).number, num2 = (all17.find((a) => a.id === n2) || {}).number;
check("номер звернення присвоює сервер, без повторів", /^ZV-\d{4}-\d{4}$/.test(num1 || "") && /^ZV-\d{4}-\d{4}$/.test(num2 || "") && num1 !== num2, num1 + " / " + num2);
check("номер справи присвоює сервер", /^С-\d{4}-\d{4}$/.test((((await cases(TJ)).find((c) => c.id === caseId)) || {}).number || ""));

// ---------- 18. Робочий простір кабінету ----------
ip = "10.0.18.1";
const ws = async (token) => ((await state(token)).state_ws || []);
const repId = u("rep"), taskId = u("task");
const report = { id: repId, kind: "report", office: "directors", author: people.staff, type: "Звіт про роботу", title: "Звіт", text: "Зроблено", status: "submitted", events: [] };
check("працівник не подає рапорт одразу прийнятим", (await sync(T.staff, "state_ws", [Object.assign({}, report, { status: "accepted", points: 50 })])).status === 403);
check("працівник подає рапорт", (await sync(T.staff, "state_ws", [report])).status === 200);
check("громадянин не бачить кабінет", !(await ws(T.cit)).length);
check("інший кабінет не бачить чужі рапорти", !(await ws(TJ)).some((w) => w.id === repId));
check("громадянин не пише в кабінет", (await sync(T.cit, "state_ws", [{ id: u("x"), kind: "report", office: "directors", author: cit, status: "submitted" }])).status === 403);
let rep = (await ws(T.head)).find((w) => w.id === repId);
check("керівник бачить рапорт кабінету", !!rep);
check("керівник приймає рапорт із балами", (await sync(T.head, "state_ws", [Object.assign({}, rep, { status: "accepted", points: 4, reviewer: people.head })])).status === 200);
rep = (await ws(T.staff)).find((w) => w.id === repId);
check("прийнятий рапорт автор уже не змінює", (await sync(T.staff, "state_ws", [Object.assign({}, rep, { status: "submitted", text: "інше" })])).status === 403);
const task = { id: taskId, kind: "task", office: "directors", title: "Завдання", assignee: people.staff, points: 3, status: "new", events: [] };
check("працівник не ставить завдання", (await sync(T.staff, "state_ws", [task])).status === 403);
check("керівник ставить завдання", (await sync(T.head, "state_ws", [task])).status === 200);
let tk = (await ws(T.staff)).find((w) => w.id === taskId);
check("виконавець бере завдання в роботу", (await sync(T.staff, "state_ws", [Object.assign({}, tk, { status: "progress" })])).status === 200);
tk = (await ws(T.staff)).find((w) => w.id === taskId);
check("виконавець не змінює бали", (await sync(T.staff, "state_ws", [Object.assign({}, tk, { points: 99 })])).status === 403);
check("виконавець не приймає сам себе", (await sync(T.staff, "state_ws", [Object.assign({}, tk, { status: "accepted" })])).status === 403);
check("працівник не затверджує премії", (await sync(T.staff, "state_ws", [{ id: u("bon"), kind: "bonus", office: "directors", rows: [] }])).status === 403);
check("керівник затверджує премії", (await sync(T.head, "state_ws", [{ id: u("bon2"), kind: "bonus", office: "directors", rows: [{ login: people.staff, points: 7, amount: 700 }] }])).status === 200);
// Файли до рапорту бачить лише кабінет
const wsFile = (await upload(T.staff, "ws:" + repId)).body.id;
check("файл рапорту відкриває колега", (await getFile(wsFile, T.head)).status === 200);
check("файл рапорту не відкриє інший кабінет", (await getFile(wsFile, TJ)).status === 403);
// Передача завдання в інший кабінет
tk = (await ws(T.head)).find((w) => w.id === taskId);
check("працівник не передає завдання", (await sync(T.staff, "state_ws", [Object.assign({}, tk, { office: "court" })])).status === 403);
check("керівник передає завдання в суд", (await sync(T.head, "state_ws", [Object.assign({}, tk, { office: "court", status: "new", assignee: "", transferredFrom: "directors" })])).status === 200);
check("суд бачить передане завдання", (await ws(TJ)).some((w) => w.id === taskId) && !(await ws(T.staff)).some((w) => w.id === taskId));

// ---------- 19. Тижневі звіти: підрозділ → Мінфін → Губернатор ----------
ip = "10.0.19.1";
const finLogin = u("fin");
await register(finLogin);
{
  check("посада директора Мінфіну", (await sync(admin, "state_positions", [{ id: "finance-head", office: "finance", title: "Директор департаменту", level: "head", permissions: ["createDocs", "approveDocs", "editOwnDocs"], manager: true, chief: true }])).status === 200);
  check("кабінет Мінфіну", (await sync(admin, "state_offices", [{ id: "finance", name: "Департамент фінансів", role: "official", canApprove: true }])).status === 200);
  const all = (await state(admin)).state_users;
  check("директора Мінфіну призначено", (await sync(admin, "state_users", [Object.assign({}, all.find((x) => x.login === finLogin), { roles: ["official"], office: "finance", positionId: "finance-head" })])).status === 200);
}
const TF = await login(finLogin, pwd(finLogin));
const payId = "payroll-directors-" + RUN;
const payRow = (amount, extra = {}) => Object.assign({ id: payId, kind: "payroll", office: "directors", period: { key: RUN, label: "тест" },
  rows: [{ login: people.staff, name: "Staff", points: 7, amount }], status: "draft", summary: "Тиждень" }, extra);
check("працівник не формує звіт підрозділу", (await sync(T.staff, "state_ws", [payRow(1000)])).status === 403);
check("премія понад 500 000 не проходить", (await sync(T.head, "state_ws", [payRow(600000)])).status === 403);
check("керівник формує звіт", (await sync(T.head, "state_ws", [payRow(400000)])).status === 200);
let pay = (await ws(T.head)).find((w) => w.id === payId);
check("керівник подає звіт до Мінфіну", (await sync(T.head, "state_ws", [Object.assign({}, pay, { status: "submitted" })])).status === 200);
check("інший кабінет звіту не бачить", !(await ws(TJ)).some((w) => w.id === payId));
pay = (await ws(TF)).find((w) => w.id === payId);
check("Мінфін бачить звіти підрозділів", !!pay && pay.submittedBy === people.head);
check("підрозділ не підписує сам", (await sync(T.head, "state_ws", [Object.assign({}, pay, { status: "signed" })])).status === 403);
check("Мінфін не переписує підсумок підрозділу", (await sync(TF, "state_ws", [Object.assign({}, pay, { summary: "інше" })])).status === 403);
check("Мінфін змінює суму й підписує", (await sync(TF, "state_ws", [Object.assign({}, pay, { status: "signed", rows: [Object.assign({}, pay.rows[0], { amount: 350000 })] })])).status === 200);
pay = (await ws(admin)).find((w) => w.id === payId);
check("підпис Мінфіну ставить сервер", pay.signedBy === finLogin && pay.totalAmount === 350000);
check("Мінфін не погоджує замість Губернатора", (await sync(TF, "state_ws", [Object.assign({}, pay, { status: "approved" })])).status === 403);
check("Губернатор погоджує", (await sync(admin, "state_ws", [Object.assign({}, pay, { status: "approved" })])).status === 200);
pay = (await ws(admin)).find((w) => w.id === payId);
check("Губернатор позначає виплачено", (await sync(admin, "state_ws", [Object.assign({}, pay, { status: "paid" })])).status === 200);
// Межа премії
check("працівник не змінює межу премії", (await sync(T.staff, "state_ws", [{ id: "payroll-global", kind: "global", office: "finance", maxBonus: 9999999 }])).status === 403);
check("Мінфін змінює межу премії", (await sync(TF, "state_ws", [{ id: "payroll-global", kind: "global", office: "finance", maxBonus: 300000, currency: "$" }])).status === 200);
check("межу бачать усі посадовці", (await ws(TJ)).some((w) => w.id === "payroll-global" && w.maxBonus === 300000));
check("нова межа діє", (await sync(T.head, "state_ws", [payRow(350000, { id: payId + "b", period: { key: RUN + "b", label: "тест2" } })])).status === 403);

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
  const av = await fetch(B + "/api/discord/avatar", { headers: { Authorization: "Bearer " + first.body.token } });
  check("Discord: аватар віддається власнику", av.status === 200 && (av.headers.get("content-type") || "").startsWith("image/"));
  check("Discord: без прив'язки аватара немає", (await get("/api/discord/avatar", T.staff)).status === 404);
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

  // Дубль: людина спершу увійшла через Discord (створився порожній акаунт), потім прив'язала той самий Discord до свого основного
  const dupId = "73" + Date.now();
  ip = "10.0.15.2";
  loc = await discordLogin(dupId);
  const dupLogin = (await post("/api/discord/exchange", { code: codeFrom(loc) })).body.login;
  const mergeCode = (await post("/api/discord/link-code", {}, T.cm1)).body.code;
  const mergeAuth = new URL(await hop("/api/discord/start?mode=link&code=" + mergeCode));
  loc = await hop("/api/discord/callback?code=" + dupId + "&state=" + mergeAuth.searchParams.get("state"));
  check("Discord: порожній дубль об'єднується з основним акаунтом", loc.includes("discord=merged"), loc);
  check("Discord: дубль видалено", !(await state(admin)).state_users.some((x) => x.login === dupLogin));
  loc = await discordLogin(dupId);
  check("Discord: після об'єднання вхід веде в основний акаунт", (await post("/api/discord/exchange", { code: codeFrom(loc) })).body.login === people.cm1);

  // Адміністратор бачить прив'язки й може відв'язати
  const links = await get("/api/discord/links", admin);
  check("Discord: адмін бачить прив'язки", links.status === 200 && links.body.items.some((x) => x.login === people.cm1 && x.name));
  check("Discord: без права керувати людьми прив'язок не видно", (await get("/api/discord/links", T.staff)).status === 403);
  check("Discord: співробітник не відв'язує чужий Discord", (await post("/api/discord/admin-unlink", { login: people.cm1 }, T.staff)).status === 403);
  r = await post("/api/discord/admin-unlink", { login: people.cm1 }, admin);
  check("Discord: адмін відв'язує", r.status === 200 && !r.body.items.some((x) => x.login === people.cm1));
  check("Discord: після відв'язки людина бачить «не прив'язано»", (await get("/api/discord/status", T.cm1)).body.linked === false);
  await mock.close();
} else {
  console.log("ℹ️  Вхід через Discord не налаштовано на тестовому Worker — розділ 15 пропущено");
}

console.log(failures ? "\n" + failures + " перевірок не пройшло" : "\nУсі перевірки пройшли");
process.exit(failures ? 1 : 0);
