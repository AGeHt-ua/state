/**
 * Cloudflare Worker: сервер порталу штату — спільна база (D1), вхід за паролем і через Discord, права, журнали.
 * Bindings: DB (D1, схема — schema.sql, зміни — migrations/), BACKUPS (KV: щоденні копії, обмеження сповіщень)
 * Secrets:  SEED_ACCOUNTS (JSON {"admin":"пароль"}), DISCORD_CLIENT_SECRET,
 *           DISCORD_NOTIFY_WEBHOOK (канал документів), DISCORD_ALERT_WEBHOOK (помилки сервера)
 * Vars:     FRONTEND_ORIGIN (дозволені сайти, через кому), FRONTEND_URL (адреса сайту для посилань і повернення з Discord),
 *           DISCORD_CLIENT_ID, DISCORD_GUILD_ID (лише учасники цього Discord-сервера), REQUIRE_DISCORD ("1" — реєстрація лише через Discord)
 *
 * Захист: CORS лише для FRONTEND_ORIGIN; вхід — випадковий токен (у базі лише його SHA-256); паролі — PBKDF2;
 * права й ієрархію перевіряє сервер; Discord-токени не зберігаються й не віддаються клієнту.
 */

// Адреса Discord; DISCORD_API_BASE — лише для автотестів (підставний Discord), у робочому сервері не задається
const discordBase = (env) => (env.DISCORD_API_BASE || "https://discord.com").replace(/\/+$/, "");

export default {
  // Щоденне завдання (cron у wrangler.toml): резервна копія бази й нагадування про документи, що чекають понад добу
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await dailyBackup(env); } catch (err) { await reportError(env, err, "щоденна резервна копія"); }
      try { await overdueReminder(env); } catch (err) { await reportError(env, err, "нагадування про погодження"); }
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), origin);
    }

    try {
      if (url.pathname === "/api/health") {
        return cors(json({ ok: true, discord: discordReady(env), requireDiscord: env.REQUIRE_DISCORD === "1" }), origin);
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        return cors(await handleState(request, env), origin);
      }
      if (url.pathname === "/api/register" && request.method === "POST") {
        return cors(await handleRegister(request, env), origin);
      }
      if (url.pathname === "/api/auth" && request.method === "POST") {
        return cors(await handlePasswordLogin(request, env), origin);
      }
      if (url.pathname === "/api/signout" && request.method === "POST") {
        return cors(await handleSignout(request, env), origin);
      }
      if (url.pathname === "/api/password" && request.method === "POST") {
        return cors(await handlePasswordChange(request, env), origin);
      }
      if (url.pathname === "/api/reset-password" && request.method === "POST") {
        return cors(await handleResetPassword(request, env), origin);
      }
      if (url.pathname === "/api/sessions" && request.method === "GET") {
        return cors(await handleSessions(request, env), origin);
      }
      if (url.pathname === "/api/sessions/revoke" && request.method === "POST") {
        return cors(await handleRevokeSessions(request, env), origin);
      }
      if (url.pathname === "/api/audit" && request.method === "GET") {
        return cors(await handleAudit(request, env, url), origin);
      }
      if (url.pathname === "/api/delete-user" && request.method === "POST") {
        return cors(await handleDeleteUser(request, env), origin);
      }
      if (url.pathname === "/api/changes" && request.method === "GET") {
        return cors(await handleChanges(request, env, url), origin);
      }
      if (url.pathname.startsWith("/api/doc/") && request.method === "GET") {
        return cors(await handleDoc(request, env, url), origin);
      }
      if (url.pathname.startsWith("/api/photo/") && request.method === "GET") {
        return handlePhoto(env, url);
      }
      if (url.pathname === "/api/vote" && request.method === "POST") {
        return cors(await handleVote(request, env, url), origin);
      }
      if (url.pathname === "/api/sync" && request.method === "POST") {
        return cors(await handleSync(request, env, ctx), origin);
      }
      // Discord: старт і повернення — переходи браузера (без CORS), решта — запити сайту
      if (url.pathname === "/api/discord/start" && request.method === "GET") return handleDiscordStart(request, env, url);
      if (url.pathname === "/api/discord/callback" && request.method === "GET") return handleDiscordCallback(request, env, url);
      if (url.pathname === "/api/discord/exchange" && request.method === "POST") return cors(await handleDiscordExchange(request, env), origin);
      if (url.pathname === "/api/discord/link-code" && request.method === "POST") return cors(await handleDiscordLinkCode(request, env), origin);
      if (url.pathname === "/api/discord/status" && request.method === "GET") return cors(await handleDiscordStatus(request, env), origin);
      if (url.pathname === "/api/discord/unlink" && request.method === "POST") return cors(await handleDiscordUnlink(request, env), origin);
      if (url.pathname === "/api/discord/links" && request.method === "GET") return cors(await handleDiscordLinks(request, env), origin);
      if (url.pathname === "/api/discord/admin-unlink" && request.method === "POST") return cors(await handleDiscordAdminUnlink(request, env), origin);
      return cors(json({ error: "Not found" }, 404), origin);
    } catch (err) {
      console.error(err);
      ctx.waitUntil(reportError(env, err, request.method + " " + url.pathname));
      return cors(json({ error: "Внутрішня помилка" }, 500), origin);
    }
  }
};

/* ---------- Спільна база порталу (D1): акаунти з паролем і колекції сайту ----------
   Сервер сам перевіряє права кожного запису й фільтрує, що кому віддавати — за тими ж правилами, що й store.js:
   - люди (state_users) — лише адміністратори (managePeople / approveProfiles / manageCongress);
   - апарати, посади, маршрути, типи документів — manageStructure / manageRoutes;
   - документи й фони — посадовці (governor / official / prosecutor / court);
   - звернення й заявки на зміну профілю — посадовці будь-які, інші — лише свої. */
const COLLECTIONS = [
  "state_users", "state_offices", "state_positions", "state_approval_routes",
  "state_docs", "state_appeals", "state_profile_requests", "state_doc_backgrounds", "state_doc_types"
];
const PUBLIC_USER_FIELDS = ["login", "name", "roles", "office", "positionId", "post", "photo", "congressMember"];
const STAFF_ROLES = ["governor", "official", "prosecutor", "court"];
const LEGISLATIVE_TYPES = ["Конституція штату", "Кодекс", "Закон"];

// Має збігатися з PERMISSION_LABELS / ACCESS_LEVELS / DEFAULT_POSITIONS у store.js
const ALL_PERMISSIONS = [
  "createDocs", "publishDocs", "approveDocs", "approveAnyDocs", "editOwnDocs", "editAllDocs", "manageDocs",
  "manageAppeals", "managePeople", "manageStructure", "manageRoutes", "approveProfiles", "manageCongress"
];
const LEVEL_PERMISSIONS = {
  head: ["createDocs", "approveDocs", "editOwnDocs"],
  staff: ["createDocs", "editOwnDocs"],
  admin: ALL_PERMISSIONS,
  viewer: []
};
const DEFAULT_POSITIONS = {
  "governor-chief": "admin",
  "director": "head", "directors-staff": "staff",
  "prosecutor-chief": "head", "prosecutor-staff": "staff",
  "court-chief": "head", "court-staff": "staff"
};
// Службовий акаунт з frontend/assets/accounts.js (його профіль може й не лежати в базі)
const SEED_PROFILES = {
  admin: { roles: ["governor"], office: "governor", positionId: "governor-chief" }
};
const USER_ADMIN_PERMS = ["managePeople", "approveProfiles", "manageCongress"];
const STRUCTURE_PERMS = ["manageStructure", "manageRoutes"];
const LOGIN_RE = /^[a-z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 8;
// Логіни, під якими не можна зареєструватися (службові й ті, що видають себе за адміністрацію)
const RESERVED_LOGINS = ["admin", "administrator", "adm", "root", "system", "support", "moderator", "owner", "governor", "gubernator", "state"];
// Головний адміністратор порталу: його не може змінити, понизити, скинути пароль чи видалити ніхто інший
const SUPER_ADMIN = "admin";
// Обмеження частоти (вікно в секундах): захист від перебору паролів, масової реєстрації та спаму
const LIMITS = {
  authIp: { max: 30, window: 15 * 60 },       // невдалих спроб входу з однієї адреси
  authFail: { max: 10, window: 15 * 60 },     // невдалих спроб на один акаунт
  register: { max: 5, window: 60 * 60 },      // реєстрацій з однієї адреси
  appeal: { max: 30, window: 60 * 60 },       // записів у звернення від громадянина
  profile: { max: 5, window: 60 * 60 }        // заявок на зміну профілю
};
// Ліміти розміру для того, що пишуть громадяни
const MAX_APPEAL_TEXT = 5000;
const MAX_APPEAL_ROW = 100 * 1024;
const MAX_PHOTO = 300 * 1024;
const SEED_DOC_IDS = ["const-sa-01", "law-gov-01", "decree-warrant-01", "project-congress-law-01"];
const DOC_CONTENT_FIELDS = ["title", "html", "docHtml", "text", "type", "typeKey", "number", "date", "subject", "body", "links"];
const DOC_FROZEN_FIELDS = ["ownerLogin", "author", "office"];
const TOKEN_TTL = 30 * 24 * 3600;
const PBKDF2_ITERATIONS = 100000; // максимум, який дозволяє Workers
const MAX_BODY = 8 * 1024 * 1024;
const MAX_ROW = 1900 * 1024; // ліміт рядка D1 — 2 МБ

async function handleState(request, env) {
  const login = await tokenLogin(request, env);
  const actor = login ? await loadActor(env, login) : null;
  return json({ user: login, scope: scopeOf(actor), data: await readCollections(env, COLLECTIONS, actor, { base: baseOf(request) }) });
}

async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "Невірний запит." }, 400);
  if (env.REQUIRE_DISCORD === "1") return json({ error: "Реєстрація на порталі — лише через Discord." }, 403);
  const login = String(body.login || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  if (!login || !password || !name) return json({ error: "Заповни всі поля." }, 400);
  if (!LOGIN_RE.test(login)) return json({ error: "Логін: 3–32 символи, лише латиниця, цифри, крапка, дефіс і підкреслення." }, 400);
  if (password.length < MIN_PASSWORD || password.length > 128) return json({ error: "Пароль: від " + MIN_PASSWORD + " до 128 символів." }, 400);
  if (name.length > 64) return json({ error: "Ім'я занадто довге (до 64 символів)." }, 400);
  if (!(await hit(env, "reg:" + clientIp(request), LIMITS.register))) return tooMany("Забагато реєстрацій з вашої мережі. Спробуйте за годину.");

  const taken = RESERVED_LOGINS.includes(login) || login in seedAccounts(env) ||
    await env.DB.prepare("SELECT 1 FROM accounts WHERE login = ?").bind(login).first() ||
    await env.DB.prepare("SELECT 1 FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  if (taken) return json({ error: "Такий логін уже зайнятий." }, 409);

  const citizen = body.accountType === "citizen";
  const profile = {
    login,
    name,
    statId: String(body.statId || "").trim().slice(0, 64),
    contact: String(body.contact || "").trim().slice(0, 128),
    post: String(body.post || "").trim().slice(0, 128),
    roles: citizen ? ["citizen"] : ["pending"],
    office: citizen ? "citizens" : "",
    positionId: "",
    photo: ""
  };
  const { salt, hash } = await hashPassword(password);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO accounts (login, salt, hash, created_at) VALUES (?, ?, ?, ?)").bind(login, salt, hash, now),
    env.DB.prepare("INSERT INTO rows (coll, id, data, updated_at) VALUES ('state_users', ?, ?, ?)").bind(login, JSON.stringify(profile), now)
  ]);
  return json({ ok: true });
}

async function handlePasswordLogin(request, env) {
  const body = await readJson(request);
  const login = String((body && body.login) || "").trim().toLowerCase();
  const password = String((body && body.password) || "");
  if (!login || !password) return json({ error: "Невірний логін або пароль." }, 401);
  // Перебір паролів: обмеження на адресу й на акаунт (рахуються лише невдалі спроби)
  // Рахуються лише невдалі спроби: люди в одній мережі не заважають одне одному входити
  const ipKey = "auth-ip:" + clientIp(request);
  if ((await peek(env, ipKey)) >= LIMITS.authIp.max) return tooMany("Забагато невдалих спроб входу з вашої мережі. Спробуйте за 15 хвилин.");
  const failKey = "auth-fail:" + login;
  if ((await peek(env, failKey)) >= LIMITS.authFail.max) return tooMany("Акаунт тимчасово заблоковано після кількох невдалих спроб. Спробуйте за 15 хвилин.");
  const failed = async () => {
    await hit(env, failKey, LIMITS.authFail);
    await hit(env, ipKey, LIMITS.authIp);
    return json({ error: "Невірний логін або пароль." }, 401);
  };

  const account = await env.DB.prepare("SELECT salt, hash, must_change FROM accounts WHERE login = ?").bind(login).first();
  if (account) {
    const { hash } = await hashPassword(password, account.salt);
    if (!timingSafeEqual(hash, account.hash)) return failed();
  } else {
    // Службові акаунти з accounts.js: пароль задається секретом SEED_ACCOUNTS і при першому вході переходить у базу
    const seedPassword = seedAccounts(env)[login];
    if (typeof seedPassword !== "string" || !timingSafeEqual(password, seedPassword)) return failed();
    const { salt, hash } = await hashPassword(password);
    await env.DB.prepare("INSERT INTO accounts (login, salt, hash, created_at) VALUES (?, ?, ?, ?)").bind(login, salt, hash, Date.now()).run();
  }

  await env.DB.prepare("DELETE FROM limits WHERE key = ?").bind(failKey).run();
  return issueSession(request, env, login, !!(account && account.must_change));
}

// Новий вхід: випадковий токен (у базі — лише SHA-256), дані порталу одразу у відповіді
async function issueSession(request, env, login, mustChangePassword) {
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, login, expires_at, created_at, last_seen, ua) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await sha256(token), login, now + TOKEN_TTL, now, now, deviceOf(request))
  ]);
  const actor = await loadActor(env, login);
  return json({ ok: true, login, token, scope: scopeOf(actor), mustChangePassword,
    data: await readCollections(env, COLLECTIONS, actor, { base: baseOf(request) }) });
}

/* ---------- Вхід через Discord ----------
   1) сайт веде на /api/discord/start (mode=login або mode=link з одноразовим кодом прив'язки);
   2) Discord повертає на /api/discord/callback: перевіряємо state, отримуємо профіль, за DISCORD_GUILD_ID — членство на сервері;
   3) вхід: знаходимо акаунт за Discord ID (або створюємо громадянина), видаємо одноразовий код і повертаємо на сайт
      (#discord_code=…) — сайт обмінює його на вхід POST /api/discord/exchange. Токен входу ніколи не потрапляє в адресу. */
function discordReady(env) {
  return !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}
function frontendUrl(env) {
  return env.FRONTEND_URL || (origins(env)[0] ? origins(env)[0] + "/" : "/");
}
function backToSite(env, path, hash) {
  return redirect(frontendUrl(env) + path + (hash ? "#" + hash : ""));
}
async function putState(env, kind, login, data, ttl) {
  const code = randomToken(24);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO oauth_states (state, kind, login, data, expires_at) VALUES (?, ?, ?, ?, ?)").bind(code, kind, login || "", data || "", now + ttl)
  ]);
  return code;
}
// Одноразовий код: читається й одразу видаляється
async function takeState(env, kind, code) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(code || ""))) return null;
  const row = await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? AND kind = ? RETURNING login, data, expires_at").bind(code, kind).first();
  return row && row.expires_at > Math.floor(Date.now() / 1000) ? row : null;
}

async function handleDiscordStart(request, env, url) {
  if (!discordReady(env)) return backToSite(env, "cabinet/portal/", "discord_error=not_configured");
  const mode = url.searchParams.get("mode") === "link" ? "link" : "login";
  let login = "";
  if (mode === "link") {
    const link = await takeState(env, "link", url.searchParams.get("code"));
    if (!link) return backToSite(env, "cabinet/", "discord_error=expired");
    login = link.login;
  }
  const state = await putState(env, "oauth", login, mode, 600);
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: url.origin + "/api/discord/callback",
    response_type: "code",
    scope: env.DISCORD_GUILD_ID ? "identify guilds.members.read" : "identify",
    state
  });
  return redirect(discordBase(env) + "/api/oauth2/authorize?" + params);
}

async function handleDiscordCallback(request, env, url) {
  const st = await takeState(env, "oauth", url.searchParams.get("state"));
  if (!st) return backToSite(env, "cabinet/portal/", "discord_error=expired");
  const mode = st.data === "link" ? "link" : "login";
  const failPath = mode === "link" ? "cabinet/" : "cabinet/portal/";
  const code = url.searchParams.get("code");
  if (!code || !discordReady(env)) return backToSite(env, failPath, "discord_error=cancelled");

  const tokenRes = await fetch(discordBase(env) + "/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: url.origin + "/api/discord/callback" })
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    // Причина від Discord (invalid_client — невірний секрет, invalid_grant — код/адреса повернення); токени не пишемо
    console.error("discord token", tokenRes.status, token.error || "", token.error_description || "");
    return backToSite(env, failPath, "discord_error=" + (token.error === "invalid_client" ? "bad_secret" : "failed"));
  }
  const auth = { headers: { Authorization: "Bearer " + token.access_token } };
  const meRes = await fetch(discordBase(env) + "/api/v10/users/@me", auth);
  if (!meRes.ok) { console.error("discord me", meRes.status); return backToSite(env, failPath, "discord_error=failed"); }
  const me = await meRes.json();
  const discordId = String(me.id || "");
  const discordName = String(me.username || "").slice(0, 64);
  if (!/^\d{5,25}$/.test(discordId)) return backToSite(env, failPath, "discord_error=failed");
  // Лише учасники вашого Discord-сервера (якщо задано DISCORD_GUILD_ID)
  if (env.DISCORD_GUILD_ID) {
    const member = await fetch(discordBase(env) + "/api/v10/users/@me/guilds/" + encodeURIComponent(env.DISCORD_GUILD_ID) + "/member", auth);
    if (!member.ok) return backToSite(env, failPath, "discord_error=not_member");
  }
  const actorStub = { login: "", profile: { name: "Discord" } };

  if (mode === "link") {
    const other = await env.DB.prepare("SELECT login FROM accounts WHERE discord_id = ? AND login != ?").bind(discordId, st.login).first();
    const linker = Object.assign(actorStub, { login: st.login });
    let merged = false;
    if (other) {
      // Discord уже має акаунт. Якщо це порожній акаунт, створений входом через Discord, — він зайвий (дубль):
      // видаляємо його й переносимо Discord. Акаунт, яким уже користувались, автоматично не чіпаємо — вирішує адміністратор.
      if (!(await isDisposableDiscordAccount(env, other.login))) return backToSite(env, "cabinet/", "discord_error=already_linked");
      await env.DB.batch(deleteAccountStatements(env, other.login).concat([
        auditStatement(env, linker, "Об'єднано акаунти", st.login, "порожній Discord-акаунт " + other.login + " видалено, Discord " + discordName + " перенесено")
      ]));
      merged = true;
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET discord_id = ?, discord_name = ? WHERE login = ?").bind(discordId, discordName, st.login),
      auditStatement(env, linker, "Прив'язано Discord", st.login, discordName)
    ]);
    return backToSite(env, "cabinet/", merged ? "discord=merged" : "discord=linked");
  }

  let account = await env.DB.prepare("SELECT login FROM accounts WHERE discord_id = ?").bind(discordId).first();
  let created = false;
  if (!account) {
    if (!(await hit(env, "reg:" + clientIp(request), LIMITS.register))) return backToSite(env, failPath, "discord_error=too_many");
    // Новий учасник: акаунт громадянина з логіном за Discord-ім'ям; пароль випадковий — вхід лише через Discord (або після скидання адміном)
    const baseLogin = (discordName.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 26) || "user").padEnd(3, "0");
    let login = baseLogin;
    for (let i = 0; i < 20; i++) {
      const busy = RESERVED_LOGINS.includes(login) || login in seedAccounts(env) || await env.DB.prepare("SELECT 1 FROM accounts WHERE login = ? UNION SELECT 1 FROM rows WHERE coll = 'state_users' AND id = ?").bind(login, login).first();
      if (!busy) break;
      login = baseLogin.slice(0, 26) + Math.floor(1000 + Math.random() * 9000);
    }
    const { salt, hash } = await hashPassword(randomToken(24));
    const now = Date.now();
    const profile = { login, name: String(me.global_name || me.username || login).slice(0, 64), statId: "", contact: "Discord: " + discordName, post: "",
      roles: ["citizen"], office: "citizens", positionId: "", photo: "" };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO accounts (login, salt, hash, created_at, discord_id, discord_name) VALUES (?, ?, ?, ?, ?, ?)").bind(login, salt, hash, now, discordId, discordName),
      env.DB.prepare("INSERT INTO rows (coll, id, data, updated_at) VALUES ('state_users', ?, ?, ?)").bind(login, JSON.stringify(profile), now),
      auditStatement(env, Object.assign(actorStub, { login }), "Реєстрація через Discord", login, discordName)
    ]);
    account = { login };
    created = true;
  }
  const once = await putState(env, "login", account.login, "", 120);
  return backToSite(env, "cabinet/portal/", "discord_code=" + once + (created ? "&new=1" : ""));
}

async function handleDiscordExchange(request, env) {
  const body = await readJson(request);
  const st = await takeState(env, "login", body && body.code);
  if (!st) return json({ error: "Код входу застарів. Спробуйте увійти через Discord ще раз." }, 400);
  return issueSession(request, env, st.login, false);
}

async function handleDiscordLinkCode(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  if (!discordReady(env)) return json({ error: "Вхід через Discord ще не налаштовано." }, 501);
  return json({ code: await putState(env, "link", login, "", 600) });
}

async function handleDiscordStatus(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const row = await env.DB.prepare("SELECT discord_name FROM accounts WHERE login = ? AND discord_id IS NOT NULL").bind(login).first();
  return json({ enabled: discordReady(env), linked: !!row, name: row ? row.discord_name : "" });
}

// Хто з людей прив'язав Discord — лише для тих, хто керує людьми
async function handleDiscordLinks(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.can(["managePeople"])) return json({ error: "Недостатньо прав для цієї дії." }, 403);
  const { results } = await env.DB.prepare(
    "SELECT a.login, a.discord_name AS name, EXISTS (SELECT 1 FROM audit WHERE action = 'Реєстрація через Discord' AND target = a.login) AS viaDiscord " +
    "FROM accounts a WHERE a.discord_id IS NOT NULL"
  ).all();
  return json({ items: results.map((r) => ({ login: r.login, name: r.name || "", viaDiscord: !!r.viaDiscord })) });
}

async function handleDiscordAdminUnlink(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.can(["managePeople"])) return json({ error: "Недостатньо прав для цієї дії." }, 403);
  const body = await readJson(request);
  const target = String((body && body.login) || "").trim().toLowerCase();
  if (!target) return json({ error: "Не вказано акаунт." }, 400);
  if (target !== login && !outranks(actor, await loadActor(env, target))) {
    return json({ error: "Ця людина має рівний або вищий рівень доступу — відв'язати її Discord може лише вищий за рангом." }, 403);
  }
  const row = await env.DB.prepare("SELECT discord_name FROM accounts WHERE login = ? AND discord_id IS NOT NULL").bind(target).first();
  if (!row) return json({ error: "У цього акаунта Discord не прив'язано." }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET discord_id = NULL, discord_name = NULL WHERE login = ?").bind(target),
    auditStatement(env, actor, "Відв'язано Discord (адміністратор)", target, row.discord_name || "")
  ]);
  return handleDiscordLinks(request, env);
}

async function handleDiscordUnlink(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET discord_id = NULL, discord_name = NULL WHERE login = ?").bind(login),
    auditStatement(env, actor, "Відв'язано Discord", login, "")
  ]);
  return handleDiscordStatus(request, env);
}

async function handleSignout(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true });
}

// Зміна власного пароля: потрібен чинний пароль; інші сесії цього акаунта завершуються
async function handlePasswordChange(request, env) {
  const token = bearer(request);
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const body = await readJson(request);
  const oldPassword = String((body && body.oldPassword) || "");
  const newPassword = String((body && body.newPassword) || "");
  if (newPassword.length < MIN_PASSWORD || newPassword.length > 128) return json({ error: "Новий пароль: від " + MIN_PASSWORD + " до 128 символів." }, 400);
  const account = await env.DB.prepare("SELECT salt, hash FROM accounts WHERE login = ?").bind(login).first();
  if (!account) return json({ error: "Акаунт не знайдено." }, 404);
  const { hash: oldHash } = await hashPassword(oldPassword, account.salt);
  if (!timingSafeEqual(oldHash, account.hash)) return json({ error: "Поточний пароль невірний." }, 403);
  const { salt, hash } = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET salt = ?, hash = ?, must_change = 0 WHERE login = ?").bind(salt, hash, login),
    env.DB.prepare("DELETE FROM sessions WHERE login = ? AND token_hash != ?").bind(login, await sha256(token))
  ]);
  return json({ ok: true });
}

// Видалення акаунта адміністратором (managePeople): вхід, сесії, профіль і заявки на зміну профілю.
// Документи й звернення людини лишаються в реєстрі як історія. Себе й службові акаунти видалити не можна.
// Повне видалення акаунта: вхід, сесії, профіль і заявки (документи й звернення лишаються в реєстрі)
function deleteAccountStatements(env, target) {
  return [
    env.DB.prepare("DELETE FROM accounts WHERE login = ?").bind(target),
    env.DB.prepare("DELETE FROM sessions WHERE login = ?").bind(target),
    env.DB.prepare("INSERT INTO tombstones (coll, id, at) SELECT coll, id, ?2 FROM rows WHERE (coll = 'state_users' AND id = ?1) OR (coll = 'state_profile_requests' AND json_extract(data, '$.login') = ?1) " +
      "ON CONFLICT (coll, id) DO UPDATE SET at = excluded.at").bind(target, Date.now()),
    env.DB.prepare("DELETE FROM rows WHERE coll = 'state_users' AND id = ?").bind(target),
    env.DB.prepare("DELETE FROM rows WHERE coll = 'state_profile_requests' AND json_extract(data, '$.login') = ?").bind(target)
  ];
}

// «Порожній» акаунт: створений входом через Discord, звичайний громадянин без посади, прав, документів і звернень
async function isDisposableDiscordAccount(env, login) {
  if (SEED_PROFILES[login] || login in seedAccounts(env)) return false;
  const born = await env.DB.prepare("SELECT 1 FROM audit WHERE action = 'Реєстрація через Discord' AND target = ?").bind(login).first();
  if (!born) return false;
  const row = await env.DB.prepare("SELECT data FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  const p = row ? JSON.parse(row.data) : {};
  const roles = p.roles || [];
  if (roles.some((r) => r !== "citizen") || (p.office && p.office !== "citizens") || p.positionId || (p.extraPermissions || []).length || p.congressMember) return false;
  const used = await env.DB.prepare(
    "SELECT 1 FROM rows WHERE coll IN ('state_docs', 'state_appeals') AND json_extract(data, '$.ownerLogin') = ? LIMIT 1"
  ).bind(login).first();
  return !used;
}

async function handleDeleteUser(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.can(["managePeople"])) return json({ error: "Недостатньо прав для цієї дії." }, 403);
  const body = await readJson(request);
  const target = String((body && body.login) || "").trim().toLowerCase();
  if (!target) return json({ error: "Не вказано акаунт." }, 400);
  if (target === login) return json({ error: "Свій акаунт видалити не можна." }, 400);
  if (SEED_PROFILES[target] || target in seedAccounts(env)) return json({ error: "Службовий акаунт видалити не можна." }, 400);
  if (!outranks(actor, await loadActor(env, target))) return json({ error: "Ця людина має рівний або вищий рівень доступу — видалити її може лише вищий за рангом." }, 403);
  await env.DB.batch(deleteAccountStatements(env, target).concat([auditStatement(env, actor, "Видалено акаунт", target, "")]));
  return json({ ok: true, data: await readCollections(env, ["state_users", "state_profile_requests"], actor, { base: baseOf(request) }) });
}

// Зміни приходять як різниця: які елементи колекції додано/змінено і які видалено
async function handleSync(request, env, ctx) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const body = await readJson(request);
  const ops = body && Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length || ops.length > COLLECTIONS.length) return json({ error: "Невірний запит." }, 400);

  const actor = await loadActor(env, login);
  const base = baseOf(request);
  const prepared = [];
  const notices = [];
  const touched = new Set();
  let maxRev = 0;
  for (const op of ops) {
    const coll = op && op.coll;
    if (!COLLECTIONS.includes(coll)) return json({ error: "Невідома колекція." }, 400);
    touched.add(coll);
    const upserts = [];
    for (const item of Array.isArray(op.upsert) ? op.upsert : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return json({ error: "Невірний запис." }, 400);
      const row = Object.assign({}, item);
      // Службові поля, які додає видача (версія запису, скорочений документ) — у базі не зберігаються
      const rev = row._rev;
      const partial = row._partial === true;
      ["_rev", "_partial", "_versions", "_history", "password"].forEach((k) => { delete row[k]; });
      const id = rowId(coll, row);
      if (!id) return json({ error: "Запис без id." }, 400);
      upserts.push({ id, row, rev: typeof rev === "number" ? rev : null, partial });
    }
    const removes = (Array.isArray(op.remove) ? op.remove : []).map((raw) => String(raw || "").slice(0, 128)).filter(Boolean);

    const partialOld = (coll === "state_docs" || coll === "state_appeals") && upserts.length ? await readRows(env, coll, upserts.map((u) => u.id)) : {};
    upserts.filter((u) => coll === "state_docs" && u.partial).forEach((u) => {
      const old = partialOld[u.id];
      if (old) DOC_HEAVY_FIELDS.forEach((k) => { if (u.row[k] === undefined && old[k] !== undefined) u.row[k] = old[k]; });
    });

    const denied = await checkWrite(env, actor, coll, upserts, removes);
    if (denied) return json({ error: denied }, 403);

    // Хтось уже змінив запис після того, як його завантажили — не перезаписуємо чужу роботу
    const current = await readRevs(env, coll, upserts.map((u) => u.id));
    const conflict = upserts.find((u) => u.rev === null ? current[u.id] !== undefined : current[u.id] !== u.rev);
    if (conflict) {
      return json({ error: "Цей запис щойно змінив інший користувач. Дані оновлено — перевірте й повторіть дію.", conflict: true,
        data: await readCollections(env, [...touched], actor, { base }) }, 409);
    }
    Object.values(current).forEach((r) => { maxRev = Math.max(maxRev, r); });

    // Скорочений документ (без версій та історії) доповнюємо збереженими в базі; фото профілю, що прийшло посиланням, лишається тим, що в базі
    const needExisting = upserts.filter((u) => coll === "state_users" && typeof u.row.photo === "string" && u.row.photo.includes("/api/photo/"));
    const existing = needExisting.length ? await readRows(env, coll, needExisting.map((u) => u.id)) : {};
    const nowIso = new Date().toISOString();
    for (const u of upserts) {
      const old = existing[u.id] || partialOld[u.id];
      if (coll === "state_docs") {
        stampDoc(u.row, partialOld[u.id], actor, nowIso);
        u.row.versions = compactVersions(u.row.versions);
      }
      if (coll === "state_appeals") stampAppeal(u.row, partialOld[u.id], actor, nowIso);
      if (coll === "state_users" && typeof u.row.photo === "string" && u.row.photo.includes("/api/photo/")) u.row.photo = (old && old.photo) || "";
      if (coll === "state_users" && String(u.row.photo || "").length > MAX_PHOTO) return json({ error: "Фото завелике. Оберіть менше зображення." }, 413);
      u.data = JSON.stringify(u.row);
      if (u.data.length > MAX_ROW) return json({ error: "Запис завеликий (понад 1.9 МБ). Зменште зображення." }, 413);
    }
    prepared.push({ coll, upserts, removes });
  }

  // Версія запису = час зміни; строго більша за попередню, щоб перевірка вище працювала навіть у межах однієї мілісекунди
  const now = Math.max(Date.now(), maxRev + 1);
  const statements = [];
  for (const { coll, upserts, removes } of prepared) {
    upserts.forEach((u) => statements.push(u.rev === null
      ? env.DB.prepare("INSERT INTO rows (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO NOTHING").bind(coll, u.id, u.data, now)
      : env.DB.prepare("UPDATE rows SET data = ?, updated_at = ? WHERE coll = ? AND id = ? AND updated_at = ?").bind(u.data, now, coll, u.id, u.rev)));
    removes.forEach((id) => {
      statements.push(env.DB.prepare("DELETE FROM rows WHERE coll = ? AND id = ?").bind(coll, id));
      // «Надгробок»: браузери з кешем дізнаються, що запис видалено
      statements.push(env.DB.prepare("INSERT INTO tombstones (coll, id, at) VALUES (?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET at = excluded.at").bind(coll, id, now));
    });
    for (const st of await sideEffects(env, actor, coll, upserts, removes, now, notices)) statements.push(st);
  }
  if (statements.length > 500) return json({ error: "Забагато змін за раз." }, 400);
  if (statements.length) await env.DB.batch(statements);
  if (notices.length && ctx) ctx.waitUntil(notifyDiscord(env, env.DISCORD_NOTIFY_WEBHOOK, notices));
  return json({ ok: true, data: await readCollections(env, [...touched], actor, { base }) });
}

async function readRevs(env, coll, ids) {
  const out = {};
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, updated_at FROM rows WHERE coll = ? AND id IN (${chunk.map(() => "?").join(",")})`).bind(coll, ...chunk).all();
    results.forEach((r) => { out[r.id] = r.updated_at; });
  }
  return out;
}

// Повертає текст помилки, якщо запис заборонений, інакше порожньо
async function checkWrite(env, actor, coll, upserts, removes) {
  const noRights = "Недостатньо прав для цієї дії.";
  if (!upserts.length && !removes.length) return "";
  if (coll === "state_users") return actor.can(USER_ADMIN_PERMS) ? checkUsersWrite(env, actor, upserts, removes) : noRights;
  if (["state_offices", "state_positions", "state_approval_routes", "state_doc_types"].includes(coll)) {
    if (!actor.can(STRUCTURE_PERMS)) return noRights;
    return checkStructureWrite(env, actor, coll, upserts, removes);
  }
  if (coll === "state_doc_backgrounds") return actor.staff ? "" : noRights;
  if (coll === "state_docs") return checkDocsWrite(env, actor, upserts, removes);

  // Звернення й заявки на зміну профілю: посадовець (або адміністратор профілів) — будь-які, інші — лише свої
  const ownerField = coll === "state_appeals" ? "ownerLogin" : "login";
  if (coll === "state_appeals" && actor.staff) return "";
  if (coll === "state_profile_requests" && actor.can(["approveProfiles"])) return "";
  const existing = await readRows(env, coll, upserts.map((u) => u.id).concat(removes));
  const own = (row) => row && row[ownerField] === actor.login;
  for (const { id, row } of upserts) {
    if (!own(row) || (existing[id] && !own(existing[id]))) return noRights;
    // Сам собі заявку не підтвердиш
    if (coll === "state_profile_requests" && row.status !== "pending") return noRights;
    const tooBig = sizeProblem(coll, row);
    if (tooBig) return tooBig;
  }
  for (const id of removes) if (existing[id] && !own(existing[id])) return noRights;
  // Частота: громадянин не може завалити звернення чи заявки спамом
  if (upserts.length) {
    const limit = coll === "state_appeals" ? LIMITS.appeal : LIMITS.profile;
    if (!(await hit(env, (coll === "state_appeals" ? "appeal:" : "profile:") + actor.login, limit, upserts.length))) {
      return "Забагато дій за короткий час. Спробуйте пізніше.";
    }
  }
  return "";
}

// Розмір того, що пишуть громадяни: текст звернення, повідомлення, фото
function sizeProblem(coll, row) {
  if (coll === "state_appeals") {
    if (String(row.text || "").length > MAX_APPEAL_TEXT) return "Текст звернення задовгий (до " + MAX_APPEAL_TEXT + " символів).";
    if ((row.thread || []).some((m) => String((m && m.text) || "").length > MAX_APPEAL_TEXT)) return "Повідомлення задовге (до " + MAX_APPEAL_TEXT + " символів).";
    if (JSON.stringify(row).length > MAX_APPEAL_ROW) return "Звернення завелике. Почніть нове звернення.";
  }
  if (coll === "state_profile_requests" && String(row.photo || "").length > MAX_PHOTO) return "Фото завелике. Оберіть менше зображення.";
  return "";
}

/* ---------- Права на документи ----------
   Сервер дозволяє рівно ті дії, що й кнопки сайту (store.js):
   - новий документ — з правом createDocs, автор — лише ви; одразу чинний — лише з правом publishDocs;
   - автор редагує й відправляє свій документ (без підробки голосів і кроків, де погоджував би сам);
   - той, чий зараз крок (або approveAnyDocs), погоджує, повертає — без зміни тексту;
   - конгресмен фіксує підсумок голосування, лише якщо голосів справді більшість;
   - publishDocs — опублікувати свій (або будь-який з approveAnyDocs) поза чергою;
   - manageDocs / editAllDocs — усе, зокрема видалення. */
async function checkDocsWrite(env, actor, upserts, removes) {
  const noRights = "Недостатньо прав для цієї дії з документом.";
  if (!actor.staff) return noRights;
  const manage = actor.can(["manageDocs", "editAllDocs"]);
  if (removes.length && !manage) return noRights;
  if (manage || !upserts.length) return "";
  const existing = await readRows(env, "state_docs", upserts.map((u) => u.id));
  let members = null;
  for (const { id, row } of upserts) {
    const old = existing[id];
    if (!old) {
      if (SEED_DOC_IDS.includes(id) || !actor.can(["createDocs"]) || row.ownerLogin !== actor.login) return noRights;
      if (["ok", "dead", "adopted", "trash"].includes(row.status) && !(row.status === "ok" && actor.can(["publishDocs"]))) return noRights;
      if (["review", "congress"].includes(row.status) && submissionProblem(actor, row)) return noRights;
      continue;
    }
    if (members === null && old.approverOffice === "congress") members = await congressSize(env);
    if (!docTransitionAllowed(actor, old, row, members)) return noRights;
  }
  return "";
}

function sameFields(a, b, fields) {
  return fields.every((k) => JSON.stringify(a[k] === undefined ? null : a[k]) === JSON.stringify(b[k] === undefined ? null : b[k]));
}

// Відправка на погодження: з першого кроку, без голосів наперед і без себе в шляху
function submissionProblem(actor, row) {
  const steps = row.approvalSteps || [];
  const own = ["user:" + actor.login, "position:" + (actor.profile.positionId || "")];
  if (!steps.length || Number(row.approvalIndex || 0) !== 0) return true;
  if (steps.some((st) => own.includes(st))) return true;
  if (row.votes && Object.keys(row.votes).length) return true;
  return row.status !== (steps[0] === "congress" ? "congress" : "review");
}

function isCurrentApprover(actor, doc) {
  const p = actor.profile;
  return doc.approverOffice === p.office || doc.approverOffice === "position:" + (p.positionId || "") ||
    doc.approverOffice === "user:" + actor.login || doc.approverLogin === actor.login;
}

// Крок погодження: або наступний крок того самого шляху, або публікація після останнього кроку
function isAdvance(old, row) {
  const steps = old.approvalSteps || [];
  const i = Number(old.approvalIndex || 0);
  if (JSON.stringify(row.approvalSteps || []) !== JSON.stringify(steps)) return false;
  if (row.status === "ok") return i + 1 >= steps.length;
  return Number(row.approvalIndex) === i + 1 && i + 1 < steps.length && row.status === (steps[i + 1] === "congress" ? "congress" : "review");
}

function docTransitionAllowed(actor, old, row, members) {
  if (!sameFields(old, row, DOC_FROZEN_FIELDS)) return false;
  const owner = old.ownerLogin === actor.login;
  const contentSame = sameFields(old, row, DOC_CONTENT_FIELDS);
  const inRoute = old.status === "review" || old.status === "congress";

  // Автор редагує або відправляє свій документ
  if (owner && actor.can(["createDocs", "editOwnDocs"])) {
    if (["draft"].includes(row.status)) return true;
    if (["review", "congress"].includes(row.status)) {
      // Той самий документ лишився на тому ж кроці (автор лише зберіг) або нове коло погодження
      if (inRoute && contentSame && JSON.stringify(row.approvalSteps || []) === JSON.stringify(old.approvalSteps || []) &&
          Number(row.approvalIndex || 0) === Number(old.approvalIndex || 0) && JSON.stringify(row.votes || {}) === JSON.stringify(old.votes || {})) return true;
      return !submissionProblem(actor, row);
    }
    if (row.status === "ok" && actor.can(["publishDocs"])) return true;
  }
  // Публікація поза чергою: свій документ з правом publishDocs або будь-який з approveAnyDocs
  if (row.status === "ok" && contentSame && actor.can(["publishDocs"]) && (owner || actor.can(["approveAnyDocs"])) &&
      ["draft", "review", "congress", "adopted"].includes(old.status)) return true;
  if (!inRoute || !contentSame) return false;

  // Конгрес: підсумок фіксує конгресмен, лише якщо більшість справді є; голоси не підробиш
  if (old.approverOffice === "congress") {
    if (row.status === "draft" && actor.can(["approveAnyDocs"])) return true;
    if (actor.profile.congressMember !== true) return false;
    // Голоси — лише ті, що вже на сервері (або очищені при переході до наступного кроку); рахуємо за серверними
    const votesSame = JSON.stringify(row.votes || {}) === JSON.stringify(old.votes || {});
    const votesCleared = !Object.keys(row.votes || {}).length && row.status !== "rejected";
    if (!votesSame && !votesCleared) return false;
    const votes = Object.values(old.votes || {}).map((v) => v && v.vote);
    const needed = Math.floor(Math.max(members || 1, 1) / 2) + 1;
    if (row.status === "rejected") return votes.filter((v) => v === "against").length >= needed;
    return votes.filter((v) => v === "for").length >= needed && isAdvance(old, row);
  }
  // Звичайний крок: той, чий він, або approveAnyDocs — погодити далі чи повернути автору
  if (!(isCurrentApprover(actor, old) || actor.can(["approveAnyDocs"]))) return false;
  return row.status === "draft" || row.status === "rejected" || isAdvance(old, row);
}

async function congressSize(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM rows WHERE coll = 'state_users' AND json_extract(data, '$.congressMember') = 1").first();
  return (r && r.n) || 0;
}

/* ---------- Обмеження частоти (таблиця limits) ---------- */
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}

// +n до лічильника ключа у вікні; false — якщо ліміт перевищено
async function hit(env, key, limit, n = 1) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "INSERT INTO limits (key, count, reset_at) VALUES (?1, ?2, ?3 + ?4) ON CONFLICT (key) DO UPDATE SET " +
    "count = CASE WHEN reset_at <= ?3 THEN ?2 ELSE count + ?2 END, reset_at = CASE WHEN reset_at <= ?3 THEN ?3 + ?4 ELSE reset_at END RETURNING count"
  ).bind(key, n, now, limit.window).first();
  return !row || row.count <= limit.max;
}

async function peek(env, key) {
  const row = await env.DB.prepare("SELECT count FROM limits WHERE key = ? AND reset_at > ?").bind(key, Math.floor(Date.now() / 1000)).first();
  return row ? row.count : 0;
}

function tooMany(message) {
  return json({ error: message }, 429);
}

async function readRows(env, coll, ids) {
  const out = {};
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, data FROM rows WHERE coll = ? AND id IN (${chunk.map(() => "?").join(",")})`).bind(coll, ...chunk).all();
    results.forEach((r) => { try { out[r.id] = JSON.parse(r.data); } catch { /* зіпсований рядок */ } });
  }
  return out;
}

// Хто робить запит: профіль (з урахуванням службових акаунтів), роль посадовця і права — як userPermissions() у store.js
async function loadActor(env, login) {
  const row = await env.DB.prepare("SELECT data FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  let stored = {};
  try { stored = row ? JSON.parse(row.data) : {}; } catch { /* зіпсований рядок */ }
  const user = Object.assign({ login }, SEED_PROFILES[login] || {}, stored);
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const staff = STAFF_ROLES.some((r) => roles.includes(r));
  let perms = [];
  if (roles[0] === "governor") perms = ALL_PERMISSIONS;
  else if (staff) {
    const position = await positionFor(env, user.positionId);
    const own = position ? (position.level === "admin" ? ALL_PERMISSIONS : (position.permissions || [])) : [];
    const extra = (Array.isArray(user.extraPermissions) ? user.extraPermissions : []).filter((p) => ALL_PERMISSIONS.includes(p));
    perms = [...new Set(own.concat(extra))];
  }
  const full = ALL_PERMISSIONS.every((p) => perms.includes(p));
  return { login, staff, perms, profile: user, full, rank: rankOf(login, roles, staff, perms), can: (list) => list.some((p) => perms.includes(p)) };
}

/* ---------- Ієрархія ----------
   Ранг: головний адміністратор (100) > повні права — гілка Губернатора чи всі права (80) >
   керують людьми чи структурою (60) > посадовці (40) > громадяни й ті, хто чекає (0).
   Змінювати, позбавляти прав, скидати пароль і видаляти можна лише тих, хто нижчий за рангом;
   підвищити когось до свого рангу чи вище не можна; видати можна лише ті права, які маєш сам. */
function rankOf(login, roles, staff, perms) {
  if (login === SUPER_ADMIN) return 100;
  if ((roles || [])[0] === "governor" || ALL_PERMISSIONS.every((p) => perms.includes(p))) return 80;
  if (perms.some((p) => USER_ADMIN_PERMS.includes(p) || STRUCTURE_PERMS.includes(p))) return 60;
  return staff ? 40 : 0;
}

function outranks(actor, target) {
  if (!target || target.login === SUPER_ADMIN) return false;
  return actor.login === SUPER_ADMIN || actor.rank > target.rank;
}

// Ранг і права, які людина МАЛА Б після зміни (нова посада, роль, особисті права)
async function projectedActor(env, login, row) {
  const roles = Array.isArray(row.roles) ? row.roles : [];
  const staff = STAFF_ROLES.some((r) => roles.includes(r));
  let perms = [];
  if (roles[0] === "governor") perms = ALL_PERMISSIONS;
  else if (staff) {
    const position = await positionFor(env, row.positionId);
    const own = position ? (position.level === "admin" ? ALL_PERMISSIONS : (position.permissions || [])) : [];
    perms = [...new Set(own.concat((Array.isArray(row.extraPermissions) ? row.extraPermissions : []).filter((p) => ALL_PERMISSIONS.includes(p))))];
  }
  return { login, staff, perms, rank: rankOf(login, roles, staff, perms) };
}

const PROFILE_FIELDS = ["name", "post", "statId", "contact", "photo"];
async function checkUsersWrite(env, actor, upserts, removes) {
  const noRights = "Недостатньо прав для цієї дії з людиною.";
  if (removes.length) return noRights; // видалення людей — лише через /api/delete-user
  if (actor.login === SUPER_ADMIN) return "";
  const old = await readRows(env, "state_users", upserts.map((u) => u.id));
  for (const { id, row } of upserts) {
    if (id === SUPER_ADMIN) return "Головного адміністратора може змінювати лише він сам.";
    const before = old[id];
    if (!before) return noRights; // нові люди з'являються лише через реєстрацію
    const changed = Object.keys(Object.assign({}, before, row)).filter((k) => JSON.stringify(before[k] === undefined ? null : before[k]) !== JSON.stringify(row[k] === undefined ? null : row[k]));
    if (!changed.length) continue;
    // Лише профіль (ім'я, посада в підписі, контакти, фото) за підтвердженою заявкою самої людини — дозволено незалежно від рангу
    if (changed.every((k) => PROFILE_FIELDS.includes(k)) && actor.can(["approveProfiles", "managePeople"]) && await matchesApprovedRequest(env, id, row)) continue;
    const target = await loadActor(env, id);
    if (!outranks(actor, target)) return "Ця людина має рівний або вищий рівень доступу — змінити її може лише вищий за рангом.";
    if (changed.includes("congressMember") && !actor.can(["manageCongress"])) return noRights;
    if (changed.some((k) => !["congressMember"].concat(PROFILE_FIELDS).includes(k)) && !actor.can(["managePeople"])) return noRights;
    const after = await projectedActor(env, id, row);
    if (after.rank >= actor.rank) return "Не можна надати людині рівень доступу, рівний вашому чи вищий. Повні права адміністратора видає лише головний адміністратор.";
    const granted = after.perms.filter((p) => !target.perms.includes(p));
    if (granted.some((p) => !actor.perms.includes(p))) return "Видати можна лише ті права, які маєте ви самі.";
  }
  return "";
}

async function matchesApprovedRequest(env, login, row) {
  const r = await env.DB.prepare(
    "SELECT data FROM rows WHERE coll = 'state_profile_requests' AND json_extract(data, '$.login') = ? AND json_extract(data, '$.status') = 'approved' ORDER BY updated_at DESC LIMIT 1"
  ).bind(login).first();
  if (!r) return false;
  try {
    const req = JSON.parse(r.data);
    return ["name", "post", "statId", "contact"].every((k) => !req[k] || req[k] === row[k]);
  } catch { return false; }
}

// Структура: не можна створити посаду/апарат, що дає більше прав, ніж маєте ви; гілку Губернатора й рівень «Адміністратор» — лише головний адміністратор
async function checkStructureWrite(env, actor, coll, upserts, removes) {
  if (actor.login === SUPER_ADMIN) return "";
  const noRights = "Змінювати посади й апарати з правами, яких у вас немає, може лише вищий за рангом.";
  if (coll === "state_positions") {
    const old = await readRows(env, coll, upserts.map((u) => u.id).concat(removes));
    const permsOf = (p) => (!p ? [] : p.level === "admin" ? ALL_PERMISSIONS : (p.permissions || []).concat(LEVEL_PERMISSIONS[DEFAULT_POSITIONS[p.id]] || []));
    for (const { id, row } of upserts) {
      if (id === "governor-chief" || row.level === "admin") return noRights;
      const before = old[id] || (DEFAULT_POSITIONS[id] ? { id, level: DEFAULT_POSITIONS[id] } : null);
      if (permsOf(row).concat(permsOf(before)).some((p) => !actor.perms.includes(p))) return noRights;
    }
    for (const id of removes) if (id === "governor-chief" || permsOf(old[id]).some((p) => !actor.perms.includes(p))) return noRights;
  }
  if (coll === "state_offices") {
    const old = await readRows(env, coll, upserts.map((u) => u.id).concat(removes));
    for (const { id, row } of upserts) if (row.role === "governor" || (old[id] && old[id].role === "governor") || id === "governor") return noRights;
    for (const id of removes) if (id === "governor" || (old[id] && old[id].role === "governor")) return noRights;
  }
  return "";
}

/* ---------- Активні входи ---------- */
function deviceOf(request) {
  const ua = String(request.headers.get("User-Agent") || "");
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(", ").slice(0, 60) || "Невідомий пристрій";
}

async function handleSessions(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const current = await sha256(bearer(request));
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare("SELECT token_hash, created_at, last_seen, ua FROM sessions WHERE login = ? AND expires_at > ? ORDER BY last_seen DESC").bind(login, now).all();
  return json({ items: results.map((r) => ({ id: r.token_hash.slice(0, 16), created: r.created_at, lastSeen: r.last_seen, device: r.ua || "Невідомий пристрій", current: r.token_hash === current })) });
}

async function handleRevokeSessions(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const current = await sha256(bearer(request));
  const body = await readJson(request);
  if (body && body.all) {
    await env.DB.prepare("DELETE FROM sessions WHERE login = ? AND token_hash != ?").bind(login, current).run();
  } else {
    const id = String((body && body.id) || "");
    if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return json({ error: "Невірний запит." }, 400);
    await env.DB.prepare("DELETE FROM sessions WHERE login = ? AND substr(token_hash, 1, 16) = ? AND token_hash != ?").bind(login, id, current).run();
  }
  return handleSessions(request, env);
}

async function positionFor(env, id) {
  if (!id) return null;
  const level = DEFAULT_POSITIONS[id];
  const base = level ? { id, level, permissions: LEVEL_PERMISSIONS[level] } : null;
  const row = await env.DB.prepare("SELECT data FROM rows WHERE coll = 'state_positions' AND id = ?").bind(String(id)).first();
  if (!row) return base;
  try { return Object.assign({}, base || {}, JSON.parse(row.data)); } catch { return base; }
}

/* ---------- Discord: сповіщення, нагадування, помилки ----------
   Вебхуки задаються секретами (без них нічого не надсилається):
   DISCORD_NOTIFY_WEBHOOK — канал для документів (на погодженні, опубліковано, відхилено, нагадування);
   DISCORD_ALERT_WEBHOOK — канал для адміністрації: помилки сервера. Згадки (@everyone тощо) вимкнено. */
async function notifyDiscord(env, webhook, lines) {
  if (!webhook || !lines.length) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n").slice(0, 1900), allowed_mentions: { parse: [] } })
    });
  } catch (err) { console.error("discord", err); }
}

function docLink(env, id) {
  return env.FRONTEND_URL ? "\n" + env.FRONTEND_URL + "acts/view/?id=" + encodeURIComponent(id) : "";
}

async function stepTitle(env, step) {
  const raw = String(step || "");
  if (raw === "congress") return "голосування Конгресу";
  if (raw.startsWith("position:")) {
    const p = await positionFor(env, raw.slice(9));
    const titles = { "governor-chief": "Губернатор штату", director: "Директор департаменту", "prosecutor-chief": "Генеральний прокурор", "court-chief": "Голова Верховного Суду" };
    return (p && p.title) || titles[raw.slice(9)] || raw.slice(9);
  }
  if (raw.startsWith("user:")) return "особисто " + raw.slice(5);
  return raw || "погодження";
}

// Помилка сервера → канал адміністрації; однакова помилка — не частіше разу на 10 хвилин
async function reportError(env, err, where) {
  if (!env.DISCORD_ALERT_WEBHOOK) return;
  const message = String((err && err.message) || err).slice(0, 300);
  const key = "alert:" + (await sha256(where + "|" + message)).slice(0, 24);
  try {
    if (env.BACKUPS) {
      if (await env.BACKUPS.get(key)) return;
      await env.BACKUPS.put(key, "1", { expirationTtl: 600 });
    }
  } catch { /* без KV — надсилаємо без обмеження */ }
  await notifyDiscord(env, env.DISCORD_ALERT_WEBHOOK, ["⚠️ Помилка сервера порталу (" + where + "): " + message]);
}

// Нагадування: документи, що чекають рішення понад добу
async function overdueReminder(env) {
  if (!env.DISCORD_NOTIFY_WEBHOOK) return;
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const { results } = await env.DB.prepare(
    "SELECT id, json_extract(data, '$.title') AS title, json_extract(data, '$.approverOffice') AS step, updated_at FROM rows " +
    "WHERE coll = 'state_docs' AND json_extract(data, '$.status') IN ('review', 'congress') AND updated_at < ? ORDER BY updated_at LIMIT 20"
  ).bind(dayAgo).all();
  if (!results.length) return;
  const lines = ["⏰ Чекають рішення понад добу:"];
  for (const r of results) lines.push("• «" + r.title + "» — " + await stepTitle(env, r.step) + " (" + Math.floor((Date.now() - r.updated_at) / 3600000) + " год)");
  if (env.FRONTEND_URL) lines.push(env.FRONTEND_URL + "cabinet/inbox/");
  await notifyDiscord(env, env.DISCORD_NOTIFY_WEBHOOK, lines);
}

/* ---------- Щоденна резервна копія ----------
   Уся база (записи, акаунти з хешами паролів, журнал дій) → Cloudflare KV, ключ backup:РРРР-ММ-ДД, зберігається 31 день.
   Відновлення — worker/scripts/restore-from-backup.mjs. Окремо D1 сам дозволяє відкотити базу на будь-який момент (Time Travel). */
async function dailyBackup(env) {
  if (!env.BACKUPS) return;
  const rows = await env.DB.prepare("SELECT coll, id, updated_at, data FROM rows").all();
  const accounts = await env.DB.prepare("SELECT login, salt, hash, created_at, must_change, discord_id, discord_name FROM accounts").all();
  const audit = await env.DB.prepare("SELECT id, at, actor, action, target, details FROM audit ORDER BY id DESC LIMIT 5000").all();
  // data вже JSON-текст: зберігаємо як рядок, без повторного розбору (економія процесорного часу)
  const text = '{"v":1,"at":' + JSON.stringify(new Date().toISOString()) +
    ',"rows":[' + rows.results.map((r) => '{"coll":' + JSON.stringify(r.coll) + ',"id":' + JSON.stringify(r.id) + ',"updated_at":' + r.updated_at + ',"data":' + JSON.stringify(r.data) + "}").join(",") +
    '],"accounts":' + JSON.stringify(accounts.results) + ',"audit":' + JSON.stringify(audit.results) + "}";
  await env.BACKUPS.put("backup:" + new Date().toISOString().slice(0, 10), text, { expirationTtl: 31 * 24 * 3600 });
}

/* ---------- Журнали підписує сервер ----------
   Записи журналу документа, погоджень і версій, а також повідомлення у зверненнях підписуються справжнім
   користувачем і часом сервера. Наявні записи змінити не можна (нові лише додаються), голоси — лише через /api/vote. */
function appendStamped(oldList, newList, actor, nowIso, keepName) {
  const before = Array.isArray(oldList) ? oldList : [];
  const seen = new Set(before.map((e) => JSON.stringify(e)));
  const name = actor.profile.name || actor.login;
  const fresh = (Array.isArray(newList) ? newList : [])
    .filter((e) => e && typeof e === "object" && !seen.has(JSON.stringify(e)))
    .map((e) => Object.assign({}, e, { by: actor.login, byName: keepName && keepName(e) ? e.byName : name, at: nowIso }));
  return before.concat(fresh);
}

const DOC_BY_FIELDS = ["approvedBy", "lastApprovedBy", "trashedBy", "returnedBy", "rejectedBy", "deletedBy"];
function stampDoc(row, old, actor, nowIso) {
  const o = old || {};
  row.history = appendStamped(o.history, row.history, actor, nowIso).slice(-80);
  row.versions = appendStamped(o.versions, row.versions, actor, nowIso).slice(-30);
  // Рішення Конгресу підписане «Конгрес штату» — це колективне рішення, хто його зафіксував, видно в by
  row.approvals = appendStamped(o.approvals, row.approvals, actor, nowIso, (e) => e.step === "congress");
  DOC_BY_FIELDS.forEach((k) => { if (row[k] && row[k] !== o[k]) row[k] = actor.login; });
  // Голоси змінюються лише через /api/vote; тут — або ті самі, або очищені при переході до наступного кроку
  const votes = row.votes && typeof row.votes === "object" ? row.votes : {};
  if (Object.keys(votes).length && JSON.stringify(votes) !== JSON.stringify(o.votes || {})) row.votes = o.votes || {};
}

function stampAppeal(row, old, actor, nowIso) {
  const o = old || {};
  row.thread = appendStamped(o.thread, row.thread, actor, nowIso);
  if (row.closedBy && row.closedBy !== o.closedBy) { row.closedBy = actor.login; row.closedByName = actor.profile.name || actor.login; }
}

// Поля документа, яких немає в легкому списку: їх доповнює сервер, коли документ приходить скороченим
const DOC_HEAVY_FIELDS = ["html", "docHtml", "editor"];

// Версія зберігає вигляд документа (docHtml, разом із фоном бланку) лише коли він змінився —
// інакше 30 копій фону переповнили б запис (ліміт D1 — 2 МБ)
function compactVersions(versions) {
  if (!Array.isArray(versions)) return versions;
  let last = null;
  return versions.map((v) => {
    if (!v || typeof v !== "object") return v;
    if (!v.docHtml || v.docHtml === last) {
      const copy = Object.assign({}, v);
      delete copy.docHtml;
      return copy;
    }
    last = v.docHtml;
    return v;
  });
}

function rowId(coll, row) {
  const id = String((coll === "state_users" ? row.login : row.id) || "").trim();
  return id && id.length <= 128 ? id : "";
}

// Що кому віддавати. Фільтрує й обрізає сама база (json_extract), а Worker лише склеює готові рядки:
// розбір і збирання мегабайтів JSON (фото профілів) не вкладалися в ліміт процесорного часу Workers.
// actor = null — анонім. Посадовці бачать усе, крім чужих заявок на зміну профілю (їх бачать ті, хто їх підтверджує);
// громадяни й анонім — публічні документи (як publicLegislativeDocs() і homeDocs() у store.js), свої звернення, заявки й профіль.
// У розглянутих заявок фото не віддається — воно вже в профілі.
// data -> '$.k' повертає JSON-значення (true лишається true, а не 1)
const PUBLIC_USER_SQL = "json_object(" + PUBLIC_USER_FIELDS.map((k) => k === "roles"
  ? `'roles', json(COALESCE(data -> '$.roles', '[]'))`
  : `'${k}', json(data -> '$.${k}')`).join(", ") + ")";
const LEGISLATIVE_SQL = LEGISLATIVE_TYPES.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");

/* Легка видача: документи — без версій та історії (вони завантажуються на сторінці документа через /api/doc/…),
   фото профілів — посиланням на /api/photo/… (браузер кешує картинку), до кожного запису додається _rev — версія запису
   для захисту від перезапису. opts.since — лише записи, змінені після цієї версії (живе оновлення, /api/changes). */
const DOC_LIST_SQL = "json_set(json_remove(data, '$.versions', '$.history', '$.html', '$.docHtml', '$.editor'), '$._partial', json('true'), " +
  "'$._versions', COALESCE(json_array_length(data, '$.versions'), 0), '$._history', COALESCE(json_array_length(data, '$.history'), 0))";

async function readCollections(env, colls, actor, opts = {}) {
  const list = colls.filter((c) => COLLECTIONS.includes(c));
  const full = actor && actor.staff ? 1 : 0;
  const me = (actor && actor.login) || "";
  const reviewer = actor && actor.can(["approveProfiles"]) ? 1 : 0;
  const since = Number(opts.since) || 0;
  const sql = `
    SELECT coll, id, updated_at, json_set(
      CASE
        WHEN coll = 'state_users' THEN json_set(
          CASE WHEN ?1 = 0 AND id != ?2 THEN ${PUBLIC_USER_SQL} ELSE data END,
          '$.photo', CASE WHEN json_extract(data, '$.photo') LIKE 'data:%' THEN ?4 || '/api/photo/' || id || '?v=' || updated_at
                          ELSE COALESCE(json_extract(data, '$.photo'), '') END)
        WHEN coll = 'state_profile_requests' AND COALESCE(json_extract(data, '$.status'), '') != 'pending' THEN json_remove(data, '$.photo')
        WHEN coll = 'state_docs' THEN ${DOC_LIST_SQL}
        ELSE data
      END, '$._rev', updated_at) AS data
    -- Живе оновлення читає лише змінені записи (індекс за часом зміни), а не всю таблицю
    FROM rows${since ? " INDEXED BY rows_updated" : ""}
    WHERE coll IN (${list.map((c) => `'${c}'`).join(", ")})
      AND updated_at > ?5
      AND (coll != 'state_appeals' OR ?1 = 1 OR json_extract(data, '$.ownerLogin') = ?2)
      AND (coll != 'state_profile_requests' OR ?3 = 1 OR json_extract(data, '$.login') = ?2)
      AND (coll != 'state_docs' OR ?1 = 1
        OR json_extract(data, '$.status') IN ('ok', 'dead')
        OR (json_extract(data, '$.status') IN ('review', 'congress', 'adopted', 'draft') AND (
          json_extract(data, '$.type') IN (${LEGISLATIVE_SQL})
          OR json_extract(data, '$.type') IN (SELECT json_extract(t.data, '$.label') FROM rows t WHERE t.coll = 'state_doc_types' AND json_extract(t.data, '$.congress') = 1)))
        OR (json_extract(data, '$.publishHome') = 1 AND COALESCE(json_extract(data, '$.status'), '') NOT IN ('trash', 'rejected', 'deleted')))
    ORDER BY rowid`;
  const { results } = await env.DB.prepare(sql).bind(full, me, reviewer, opts.base || "", since).all();
  const parts = {};
  list.forEach((c) => { parts[c] = []; });
  let maxRev = since;
  const ids = [];
  results.forEach((r) => { parts[r.coll].push(r.data); maxRev = Math.max(maxRev, r.updated_at); ids.push({ coll: r.coll, id: r.id }); });
  const raw = new RawJson("{" + list.map((c) => JSON.stringify(c) + ":[" + parts[c].join(",") + "]").join(",") + "}");
  raw.maxRev = maxRev;
  raw.ids = ids;
  return raw;
}

function baseOf(request) {
  return new URL(request.url).origin;
}

/* ---------- Журнал дій адміністрації та наслідки змін ----------
   Записуємо те, що важливо для довіри до порталу: призначення й права людей, видалення акаунтів, скидання паролів,
   зміни структури, публікацію, скасування й видалення документів. Скасування актів (links.repeals) виконується тут же:
   коли документ стає чинним, акти, які він скасовує, втрачають чинність. */
function auditStatement(env, actor, action, target, details) {
  return env.DB.prepare("INSERT INTO audit (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)")
    .bind(Date.now(), actor ? actor.login : "", action, String(target || "").slice(0, 200), String(details || "").slice(0, 1000));
}

const DOC_STATUS_NAMES = { ok: "Чинний", dead: "Втратив чинність", trash: "У кошику", draft: "Проєкт", review: "На погодженні",
  congress: "На голосуванні Конгресу", rejected: "Відхилено", adopted: "Прийнято", deleted: "Видалено" };

async function sideEffects(env, actor, coll, upserts, removes, now, notices = []) {
  const out = [];
  const ids = upserts.map((u) => u.id).concat(removes);
  if (!ids.length) return out;
  const names = { state_offices: "Апарат", state_positions: "Посада", state_approval_routes: "Маршрут", state_doc_types: "Тип документа" };

  if (coll === "state_users") {
    const old = await readRows(env, coll, ids);
    for (const { id, row } of upserts) {
      const o = old[id] || {};
      const changes = [];
      if ((o.office || "") !== (row.office || "") || (o.positionId || "") !== (row.positionId || "")) changes.push("посада: " + (o.positionId || "—") + " → " + (row.positionId || "—"));
      if (JSON.stringify(o.roles || []) !== JSON.stringify(row.roles || [])) changes.push("роль: " + (o.roles || []).join(",") + " → " + (row.roles || []).join(","));
      const a = (o.extraPermissions || []).slice().sort().join(","), b = (row.extraPermissions || []).slice().sort().join(",");
      if (a !== b) changes.push("особисті права: [" + (a || "—") + "] → [" + (b || "—") + "]");
      if (!!o.congressMember !== !!row.congressMember) changes.push(row.congressMember ? "надано статус конгресмена" : "знято статус конгресмена");
      ["name", "post", "statId", "contact"].forEach((k) => { if ((o[k] || "") !== (row[k] || "") && old[id]) changes.push(k + ": «" + (o[k] || "") + "» → «" + (row[k] || "") + "»"); });
      if (changes.length) out.push(auditStatement(env, actor, old[id] ? "Змінено людину" : "Додано людину", id, changes.join("; ")));
    }
    return out;
  }

  if (names[coll]) {
    const { results } = await env.DB.prepare(`SELECT id, COALESCE(json_extract(data, '$.name'), json_extract(data, '$.title'), json_extract(data, '$.label'), id) AS name FROM rows WHERE coll = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(coll, ...ids).all();
    const known = Object.fromEntries(results.map((r) => [r.id, r.name]));
    upserts.forEach(({ id, row }) => out.push(auditStatement(env, actor, names[coll] + (known[id] ? ": змінено" : ": створено"), row.name || row.title || row.label || id, "")));
    removes.forEach((id) => out.push(auditStatement(env, actor, names[coll] + ": видалено", known[id] || id, "")));
    return out;
  }

  if (coll === "state_docs") {
    const { results } = await env.DB.prepare(`SELECT id, json_extract(data, '$.status') AS status, json_extract(data, '$.ownerLogin') AS owner, json_extract(data, '$.title') AS title, json_extract(data, '$.html') AS html, json_extract(data, '$.approvalIndex') AS approvalIndex FROM rows WHERE coll = 'state_docs' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    const old = Object.fromEntries(results.map((r) => [r.id, r]));
    for (const { id, row } of upserts) {
      const o = old[id];
      const title = row.title || (o && o.title) || id;
      const was = o ? o.status : null;
      if (was !== row.status && ["ok", "dead", "trash", "deleted", "rejected"].includes(row.status)) {
        const last = (row.approvals || []).slice(-1)[0];
        const how = row.status === "ok" && last && last.step === "admin" ? " (поза чергою)" : "";
        out.push(auditStatement(env, actor, "Документ: " + (DOC_STATUS_NAMES[row.status] || row.status).toLowerCase() + how, title, was ? "було: " + (DOC_STATUS_NAMES[was] || was) : "новий"));
      } else if (was === "trash" && row.status !== "trash") {
        out.push(auditStatement(env, actor, "Документ: відновлено з кошика", title, ""));
      } else if (o && o.owner && o.owner !== actor.login && o.html !== row.html) {
        out.push(auditStatement(env, actor, "Документ: змінено текст чужого документа", title, "автор: " + o.owner));
      }
      // Сповіщення в Discord: новий крок погодження, публікація, відхилення, повернення
      const stepChanged = was !== row.status || (o && Number(row.approvalIndex || 0) !== Number((old[id] && old[id].approvalIndex) || 0));
      const link = docLink(env, id);
      if (["review", "congress"].includes(row.status) && (stepChanged || !o)) notices.push("📄 На погодженні: «" + title + "» — " + await stepTitle(env, row.approverOffice) + link);
      else if (row.status === "ok" && was !== "ok") notices.push("✅ Опубліковано: «" + title + "»" + link);
      else if (row.status === "rejected" && was !== "rejected") notices.push("❌ Відхилено: «" + title + "»" + link);
      else if (row.status === "draft" && ["review", "congress"].includes(was)) notices.push("↩️ Повернено на доопрацювання: «" + title + "»" + link);
      // Скасування актів: документ щойно став чинним — акти зі списку links.repeals втрачають чинність
      const repeals = row.links && Array.isArray(row.links.repeals) ? row.links.repeals.map(String).filter((x) => x && x !== id).slice(0, 50) : [];
      if (row.status === "ok" && was !== "ok" && repeals.length) {
        const entry = JSON.stringify({ at: new Date(now).toISOString(), by: actor.login, byName: actor.profile.name || actor.login, action: "Втратив чинність", summary: "Скасовано документом «" + title + "»." });
        repeals.forEach((target) => {
          out.push(env.DB.prepare(
            "UPDATE rows SET data = json_insert(json_set(data, '$.status', 'dead', '$.repealedBy', ?1, '$.repealedAt', ?2, '$.history', json(COALESCE(data -> '$.history', '[]'))), '$.history[#]', json(?3)), " +
            "updated_at = ?4 WHERE coll = 'state_docs' AND id = ?5 AND json_extract(data, '$.status') = 'ok'"
          ).bind(id, new Date(now).toISOString(), entry, now + 1, target));
        });
        out.push(auditStatement(env, actor, "Документ: скасовує інші акти", title, repeals.join(", ")));
      }
    }
    removes.forEach((id) => out.push(auditStatement(env, actor, "Документ: видалено остаточно", (old[id] && old[id].title) || id, "")));
  }
  return out;
}

// Скидання пароля адміністратором: тимчасовий пароль показується адміну один раз, людина змінює його після входу
async function handleResetPassword(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.can(["managePeople"])) return json({ error: "Недостатньо прав для цієї дії." }, 403);
  const body = await readJson(request);
  const target = String((body && body.login) || "").trim().toLowerCase();
  if (!target || target === login) return json({ error: "Свій пароль змініть у профілі." }, 400);
  if (!outranks(actor, await loadActor(env, target))) return json({ error: "Ця людина має рівний або вищий рівень доступу — скинути їй пароль може лише вищий за рангом." }, 403);
  const account = await env.DB.prepare("SELECT 1 FROM accounts WHERE login = ?").bind(target).first();
  if (!account) return json({ error: "Акаунт не знайдено або ще жодного разу не входив." }, 404);
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const temp = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  const { salt, hash } = await hashPassword(temp);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET salt = ?, hash = ?, must_change = 1 WHERE login = ?").bind(salt, hash, target),
    env.DB.prepare("DELETE FROM sessions WHERE login = ?").bind(target),
    env.DB.prepare("DELETE FROM limits WHERE key = ?").bind("auth-fail:" + target),
    auditStatement(env, actor, "Скинуто пароль", target, "видано тимчасовий пароль")
  ]);
  return json({ ok: true, password: temp });
}

// Журнал — для адміністрації (люди, структура або реєстр документів)
async function handleAudit(request, env, url) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.can(["managePeople", "manageStructure", "manageDocs", "manageRoutes"])) return json({ error: "Недостатньо прав для цієї дії." }, 403);
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const { results } = await env.DB.prepare("SELECT id, at, actor, action, target, details FROM audit WHERE id < ? ORDER BY id DESC LIMIT 100").bind(before).all();
  return json({ items: results });
}

// «Область видимості» відповіді: змінюється разом із правами — тоді браузер перезавантажує кеш повністю
function scopeOf(actor) {
  if (!actor) return "anon";
  return actor.login + ":" + (actor.staff ? "staff" : "public") + (actor.can(["approveProfiles"]) ? ":rev" : "");
}

// Зміни після версії since — для живого оновлення сторінок (голосування, повідомлення)
async function handleChanges(request, env, url) {
  const since = Number(url.searchParams.get("since")) || 0;
  if (!since) return json({ error: "Потрібен параметр since." }, 400);
  const login = await tokenLogin(request, env);
  const actor = login ? await loadActor(env, login) : null;
  // Перекриття на хвилину: запис, збережений паралельно з трохи меншою версією, теж не загубиться (злиття за id — безпечне)
  const from = Math.max(1, since - 60000);
  const data = await readCollections(env, COLLECTIONS, actor, { base: baseOf(request), since: from });
  // Видалені записи й ті, що стали невидимими для цього користувача (наприклад, документ перенесли в кошик)
  const gone = await env.DB.prepare(
    "SELECT t.coll, t.id FROM tombstones t WHERE t.at > ? AND NOT EXISTS (SELECT 1 FROM rows r WHERE r.coll = t.coll AND r.id = t.id AND r.updated_at > t.at)"
  ).bind(from).all();
  const changed = await env.DB.prepare("SELECT coll, id FROM rows INDEXED BY rows_updated WHERE updated_at > ?").bind(from).all();
  const visible = new Set(data.ids.map((x) => x.coll + "\u0000" + x.id));
  const removed = gone.results.map((r) => ({ coll: r.coll, id: r.id }))
    .concat(changed.results.filter((r) => COLLECTIONS.includes(r.coll) && !visible.has(r.coll + "\u0000" + r.id)).map((r) => ({ coll: r.coll, id: r.id })));
  return json({ user: login, scope: scopeOf(actor), now: Math.max(since, data.maxRev), removed, data });
}

// Повний документ з версіями та історією (для сторінки документа) — з тими ж правилами видимості
async function handleDoc(request, env, url) {
  const id = decodeURIComponent(url.pathname.slice("/api/doc/".length)).slice(0, 128);
  const login = await tokenLogin(request, env);
  const actor = login ? await loadActor(env, login) : null;
  const row = await env.DB.prepare(
    "SELECT json_set(data, '$._rev', updated_at) AS data, json_extract(data, '$.status') AS status, json_extract(data, '$.type') AS type, json_extract(data, '$.publishHome') AS home FROM rows WHERE coll = 'state_docs' AND id = ?"
  ).bind(id).first();
  if (!row) return json({ error: "Документ не знайдено." }, 404);
  if (!(actor && actor.staff)) {
    let visible = row.status === "ok" || row.status === "dead" || (row.home === 1 && !["trash", "rejected", "deleted"].includes(row.status));
    if (!visible && ["review", "congress", "adopted", "draft"].includes(row.status)) {
      const custom = await env.DB.prepare("SELECT 1 FROM rows WHERE coll = 'state_doc_types' AND json_extract(data, '$.label') = ? AND json_extract(data, '$.congress') = 1").bind(row.type).first();
      visible = LEGISLATIVE_TYPES.includes(row.type) || !!custom;
    }
    if (!visible) return json({ error: "Документ не знайдено." }, 404);
  }
  return json({ doc: new RawJson(row.data) });
}

// Фото профілю окремою картинкою: браузер кешує її назавжди (адреса змінюється разом із фото — ?v=версія)
async function handlePhoto(env, url) {
  const login = decodeURIComponent(url.pathname.slice("/api/photo/".length)).slice(0, 64);
  const row = await env.DB.prepare("SELECT json_extract(data, '$.photo') AS photo FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  const m = row && /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(row.photo || "");
  if (!m) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// Голос Конгресу записується одним атомарним оновленням у базі: одночасні голоси не затирають один одного
async function handleVote(request, env, url) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.staff || actor.profile.congressMember !== true) return json({ error: "Голосувати можуть лише конгресмени." }, 403);
  const body = await readJson(request);
  const id = String((body && body.id) || "").slice(0, 128);
  const vote = body && body.vote === "against" ? "against" : "for";
  const record = JSON.stringify({ vote, name: String(actor.profile.name || login).slice(0, 64), at: new Date().toISOString() });
  const res = await env.DB.prepare(
    "UPDATE rows SET data = json_set(json_set(data, '$.votes', json(COALESCE(data -> '$.votes', '{}'))), '$.votes.' || json_quote(?1), json(?2)), " +
    "updated_at = MAX(updated_at + 1, ?3) " +
    "WHERE coll = 'state_docs' AND id = ?4 AND json_extract(data, '$.status') = 'congress' AND json_extract(data, '$.approverOffice') = 'congress'"
  ).bind(login, record, Date.now(), id).run();
  const row = await env.DB.prepare(`SELECT json_set(${DOC_LIST_SQL}, '$._rev', updated_at) AS data FROM rows WHERE coll = 'state_docs' AND id = ?`).bind(id).first();
  if (!res.meta.changes) return json({ error: "Голосування за цим документом уже завершене.", doc: row ? new RawJson(row.data) : null }, 409);
  return json({ ok: true, doc: new RawJson(row.data) });
}

// Готовий JSON-текст, який json() вставляє у відповідь без повторного перетворення
class RawJson {
  constructor(text) { this.text = text; }
}

async function tokenLogin(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT login, expires_at, last_seen FROM sessions WHERE token_hash = ?").bind(hash).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expires_at <= now) return null;
  if ((row.last_seen || 0) < now - 3600) await env.DB.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").bind(now, hash).run();
  return row.login;
}

function bearer(request) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get("Authorization") || "");
  return m ? m[1] : "";
}

function seedAccounts(env) {
  try {
    const parsed = JSON.parse(env.SEED_ACCOUNTS || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return null;
  try {
    const text = await request.text();
    return text.length > MAX_BODY ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { salt: b64url(salt), hash: b64url(new Uint8Array(bits)) };
}

async function sha256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/* ---------- Допоміжне ---------- */
function origins(env) {
  return String(env.FRONTEND_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return origin && origins(env).includes(origin) ? origin : "";
}

function randomToken(bytes) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function securityHeaders(headers) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function redirect(location) {
  return new Response(null, { status: 302, headers: securityHeaders(new Headers({ Location: location })) });
}

function json(data, status = 200) {
  // RawJson (готові дані з бази) вставляються як є, без повторного JSON.stringify мегабайтного тексту
  const raws = [];
  let text = JSON.stringify(data, (key, value) => {
    if (value instanceof RawJson) { raws.push(value.text); return "__raw_json_" + (raws.length - 1) + "__"; }
    return value;
  });
  raws.forEach((raw, i) => { text = text.replace('"__raw_json_' + i + '__"', () => raw); });
  return new Response(text, {
    status,
    headers: securityHeaders(new Headers({ "Content-Type": "application/json; charset=utf-8" }))
  });
}

function cors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
