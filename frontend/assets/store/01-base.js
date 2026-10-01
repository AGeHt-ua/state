/* Сховище порталу (1/5): Основа: ролі, права, види й статуси документів, очищення HTML, вбудовані документи.
   Файли assets/store/*.js підключаються саме в цьому порядку й разом утворюють спільні функції сторінок. */

/* Роль визначається апаратом автоматично (гілка влади апарату). Конгрес — не роль, а статус користувача
   (user.congressMember), який дає право голосувати в Конгресі. */
const ROLE_LABELS = {
  governor: "Кабінет Губернатора",
  official: "Виконавча влада",
  prosecutor: "Прокуратура",
  court: "Судова влада",
  citizen: "Кабінет громадянина",
  pending: "Очікує призначення"
};

// Гілки влади для апаратів (у формі «Новий апарат»)
const BRANCHES = [
  { role: "official", label: "Виконавча влада", hint: "уряд, департаменти, служби" },
  { role: "court", label: "Судова влада", hint: "суди" },
  { role: "prosecutor", label: "Прокуратура", hint: "нагляд, обвинувачення" },
  { role: "governor", label: "Кабінет Губернатора", hint: "повні права адміністратора" }
];

const OFFICE_BY_ROLE = {
  governor: "governor",
  official: "directors",
  prosecutor: "prosecutor",
  court: "court"
};

const OFFICE_NAMES = {
  governor: "Кабінет Губернатора",
  directors: "Кабінет Директорів Департаменту",
  prosecutor: "Кабінет Прокуратури",
  court: "Кабінет Судової влади"
};

const DEFAULT_OFFICES = [
  { id: "governor", name: "Кабінет Губернатора", role: "governor", canApprove: true },
  { id: "directors", name: "Кабінет Директорів Департаменту", role: "official", canApprove: true },
  { id: "prosecutor", name: "Кабінет Прокуратури", role: "prosecutor", canApprove: true },
  { id: "court", name: "Кабінет Судової влади", role: "court", canApprove: true }
];

const PERMISSION_LABELS = {
  createDocs: "Створювати документи",
  publishDocs: "Публікувати без погодження",
  approveDocs: "Погоджувати документи",
  approveAnyDocs: "Погоджувати й повертати будь-які документи поза чергою",
  editOwnDocs: "Редагувати свої документи",
  editAllDocs: "Редагувати всі документи",
  manageDocs: "Керувати реєстром: чинність, архів, кошик",
  manageAppeals: "Відповідати на звернення до всіх апаратів",
  managePeople: "Призначати людей на посади й видавати права",
  manageStructure: "Створювати апарати й посади",
  manageRoutes: "Налаштовувати, хто погоджує документи апаратів",
  approveProfiles: "Підтверджувати зміни профілю",
  manageCongress: "Надавати статус конгресмена"
};

// Рівні доступу: готові набори прав, щоб не ставити галочки вручну
const ACCESS_LEVELS = {
  head: { label: "Керівник апарату", hint: "створює документи й погоджує документи свого апарату", permissions: ["createDocs", "approveDocs", "editOwnDocs"] },
  staff: { label: "Співробітник", hint: "створює документи, вони йдуть на погодження керівнику", permissions: ["createDocs", "editOwnDocs"] },
  admin: { label: "Адміністратор", hint: "усі права: створення, публікація й погодження будь-яких документів, реєстр, звернення, люди, структура", permissions: Object.keys(PERMISSION_LABELS) },
  viewer: { label: "Лише перегляд", hint: "бачить кабінет, але не створює документів", permissions: [] }
};

function accessLevelOf(position) {
  if (!position) return "viewer";
  if (position.level && ACCESS_LEVELS[position.level]) {
    const same = ACCESS_LEVELS[position.level].permissions.slice().sort().join() === (position.permissions || []).slice().sort().join();
    if (same) return position.level;
  }
  const perms = (position.permissions || []).slice().sort().join();
  const found = Object.keys(ACCESS_LEVELS).find((k) => ACCESS_LEVELS[k].permissions.slice().sort().join() === perms);
  return found || "custom";
}

const DEFAULT_POSITIONS = [
  { id: "governor-chief", office: "governor", title: "Губернатор штату", level: "admin", permissions: ACCESS_LEVELS.admin.permissions.slice() },
  { id: "director", office: "directors", title: "Директор департаменту", level: "head", permissions: ACCESS_LEVELS.head.permissions.slice() },
  { id: "directors-staff", office: "directors", title: "Співробітник департаменту", level: "staff", permissions: ACCESS_LEVELS.staff.permissions.slice() },
  { id: "prosecutor-chief", office: "prosecutor", title: "Генеральний прокурор", level: "head", permissions: ACCESS_LEVELS.head.permissions.slice() },
  { id: "prosecutor-staff", office: "prosecutor", title: "Прокурор", level: "staff", permissions: ACCESS_LEVELS.staff.permissions.slice() },
  { id: "court-chief", office: "court", title: "Голова Верховного Суду", level: "head", permissions: ACCESS_LEVELS.head.permissions.slice() },
  { id: "court-staff", office: "court", title: "Суддя", level: "staff", permissions: ACCESS_LEVELS.staff.permissions.slice() }
];

function userOffice(user) {
  if (user && user.office) return user.office;
  const role = ((user && user.roles) || []).find((r) => r !== "pending") || "official";
  return OFFICE_BY_ROLE[role] || "directors";
}

function officeTitle(user) {
  if (user && user.office) return officeName(user.office);
  const role = ((user && user.roles) || [])[0] || "pending";
  return ROLE_LABELS[role] || ROLE_LABELS.pending;
}

const DOC_TYPES = ["Конституція штату", "Закон", "Указ", "Розпорядження", "Статут органу"];
const DOC_STATUSES = {
  ok: "Чинний",
  draft: "Проєкт",
  review: "На погодженні",
  congress: "На голосуванні Конгресу",
  adopted: "Прийнято Конгресом",
  rejected: "Відхилено",
  dead: "Втратив чинність",
  trash: "У кошику"
};

const VERSION_LABELS = {
  draft: "Проєкт",
  review: "Редакція",
  congress: "Голосування Конгресу",
  adopted: "Прийнято",
  rejected: "Відхилено",
  ok: "Чинна версія",
  dead: "Архів",
  trash: "Архів"
};

const DEFAULT_APPROVAL_ROUTES = [
  {
    id: "standard",
    name: "Автор → губернатор → публікація",
    ownerOffice: "all",
    steps: ["position:governor-chief"],
    active: true,
    seeded: true
  }
];

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

/* ---------- Санітизація HTML документів ----------
   HTML документа пише автор, а бачать усі, тож перед показом прибираємо все, що може виконати код:
   небезпечні теги, обробники подій, небезпечні URL (javascript:, data:text/html тощо) та CSS-трюки. */
const DOC_DROP_TAGS = "script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,option," +
  "noscript,template,portal,svg,math,audio,video,source,track,dialog";
const DOC_URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "poster", "background", "cite", "data", "longdesc"];
const DOC_DROP_ATTRS = ["srcset", "srcdoc", "ping", "contenteditable", "name", "form", "is", "autofocus"];

// Дозволені URL: http(s), mailto, tel, якорі й відносні шляхи; для зображень ще data:image (крім SVG)
function isSafeUrl(value, forImage) {
  const v = String(value || "").replace(/[\x00-\x20\x7f-\x9f]/g, "");
  if (!v) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) return true;
  if (/^(https?|mailto|tel):/i.test(v)) return true;
  return !!forImage && /^data:image\/(png|jpe?g|gif|webp|bmp|avif);/i.test(v);
}

function isSafeStyle(style) {
  const s = String(style || "").replace(/\\/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|position\s*:\s*fixed/i.test(s)) return false;
  const urls = s.match(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi) || [];
  return urls.every((u) => isSafeUrl(u.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, ""), true));
}

function sanitizeDocHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  parsed.body.querySelectorAll(DOC_DROP_TAGS).forEach((el) => el.remove());
  parsed.body.querySelectorAll("*").forEach((el) => {
    const isImage = el.tagName === "IMG";
    Array.from(el.attributes).forEach((a) => {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || DOC_DROP_ATTRS.includes(name)) el.removeAttribute(a.name);
      else if (DOC_URL_ATTRS.includes(name) && !isSafeUrl(a.value, isImage)) el.removeAttribute(a.name);
      else if (name === "style" && !isSafeStyle(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === "A" && el.getAttribute("target")) el.setAttribute("rel", "noopener noreferrer");
  });
  return parsed.body.innerHTML;
}

const SEED_DOCS = [
  {
    id: "const-sa-01",
    type: "Конституція штату",
    number: "КС-01",
    date: "2026-09-08",
    publishedAt: "2026-09-08T12:00:00",
    status: "ok",
    body: "Уряд штату Сан-Андреас",
    title: "Конституція штату Сан-Андреас",
    text: "Ми, народ штату San Andreas (Ukraine GTA 5), розуміючи цінність свободи, порядку та справедливості, ухвалюємо цю Конституцію.",
    publishHome: true,
    seeded: true
  },
  {
    id: "law-gov-01",
    type: "Закон",
    number: "З-17",
    date: "2026-09-09",
    publishedAt: "2026-09-09T10:30:00",
    status: "ok",
    body: "Уряд штату Сан-Андреас",
    title: "Закон про діяльність Уряду",
    text: "Цей Закон визначає організацію роботи Уряду штату.",
    publishHome: true,
    seeded: true
  },
  {
    id: "decree-warrant-01",
    type: "Указ",
    number: "У-04",
    date: "2026-09-09",
    status: "draft",
    body: "Апарат Уряду",
    title: "Порядок видачі ордерів",
    text: "Ордер — службовий документ, що уповноважує визначену дію.",
    seeded: true
  },
  {
    id: "project-congress-law-01",
    type: "Закон",
    number: "ПЗ-01",
    date: "2026-09-11",
    publishedAt: "2026-09-11T09:00:00",
    status: "congress",
    body: "Конгрес штату Сан-Андреас",
    title: "Проєкт Закону про порядок розгляду актів Конгресом",
    text: "Цей проєкт визначає, як Конституція, кодекси та закони проходять погодження і голосування Конгресу перед набранням чинності.",
    author: "Кабінет Губернатора",
    office: "governor",
    publishHome: true,
    approvalRouteName: "Автор → Конгрес → публікація",
    approvalSteps: ["congress"],
    approvalIndex: 0,
    approverOffice: "congress",
    seeded: true
  }
];

