// Автотести API порталу. Запускаються проти локального Worker із ЧИСТОЮ базою:
//   cd worker && npx wrangler d1 execute state-db --local --file=schema.sql && npx wrangler dev --port 8787
//   npm test            (TEST_URL і ADMIN_PASSWORD — з оточення; за замовчуванням http://localhost:8787 і пароль із worker/.dev.vars)
// Кожна група запитів іде з окремої «адреси» (заголовок CF-Connecting-IP — локально його можна задати, у Cloudflare — ні),
// щоб обмеження частоти з однієї групи не заважали іншим.

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

console.log(failures ? "\n" + failures + " перевірок не пройшло" : "\nУсі перевірки пройшли");
process.exit(failures ? 1 : 0);
