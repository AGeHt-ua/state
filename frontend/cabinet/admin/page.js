/* Скрипт сторінки «cabinet/admin». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const me = requireAuth();
  if (!me) return;
  const can = {
    people: hasPermission(me, "managePeople"),
    structure: hasPermission(me, "manageStructure"),
    routes: hasPermission(me, "manageRoutes") || hasPermission(me, "manageStructure"),
    profiles: hasPermission(me, "approveProfiles") || hasPermission(me, "managePeople"),
    congress: hasPermission(me, "manageCongress"),
    audit: ["managePeople", "manageStructure", "manageDocs", "manageRoutes"].some((p) => hasPermission(me, p))
  };
  if (!Object.values(can).some(Boolean)) location.href = "../../denied/";

  const $ = (id) => document.getElementById(id);
  const role = (u) => (u.roles && u.roles[0]) || "pending";
  const initials = (u) => String(u.name || u.login || "?").split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const positionsOf = (officeId) => allPositions().filter((p) => p.office === officeId);
  const levelLabel = (p) => { const l = accessLevelOf(p); return l === "custom" ? "Особливі права" : ACCESS_LEVELS[l].label; };
  const toast = (text) => {
    let t = $("admin-toast");
    if (!t) { t = document.createElement("div"); t.id = "admin-toast"; t.className = "admin-toast"; document.body.appendChild(t); }
    t.textContent = text; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
  };

  /* ---------- Вкладки ---------- */
  const TABS = [
    { id: "todo", label: "Потребує уваги", show: can.people || can.profiles, count: () => (can.people ? pendingUsers().length : 0) + (can.profiles ? pendingProfileRequests().length : 0) },
    { id: "people", label: "Люди", show: can.people },
    { id: "structure", label: "Структура", show: can.structure || can.routes },
    { id: "congress", label: "Конгрес", show: can.congress, count: () => congressMembers().length, neutral: true },
    { id: "audit", label: "Журнал", show: can.audit }
  ].filter((t) => t.show);
  let current = (location.hash || "").slice(1);
  if (!TABS.some((t) => t.id === current)) current = TABS[0].id;
  function drawTabs() {
    $("admin-tabs").innerHTML = TABS.map((t) => {
      const n = t.count ? t.count() : 0;
      return `<button type="button" role="tab" data-tab-btn="${t.id}" class="${t.id === current ? "active" : ""}" aria-selected="${t.id === current}">${t.label}${n ? `<span class="${t.neutral ? "pill" : "nav-badge"}">${n}</span>` : ""}</button>`;
    }).join("");
    document.querySelectorAll(".admin-tab").forEach((s) => { s.hidden = s.dataset.tab !== current; });
  }
  function showTab(id) { current = id; history.replaceState(null, "", "#" + id); drawTabs(); if (id === "audit") { auditLoaded = false; drawAudit(); } }

  /* ---------- Спільні списки ---------- */
  // Гілку Губернатора (повні права) може призначати лише головний адміністратор
  function officeOptions(selected, withNone) {
    return (withNone ? `<option value="">— Оберіть апарат —</option>` : "") +
      allOffices().filter((o) => o.role !== "governor" || isSuperAdmin(me) || o.id === selected)
        .map((o) => `<option value="${attr(o.id)}"${o.id === selected ? " selected" : ""}>${esc(o.name)}</option>`).join("");
  }
  function positionOptions(officeId, selected) {
    const list = positionsOf(officeId);
    if (!list.length) return `<option value="">У цьому апараті ще немає посад</option>`;
    // Типово — співробітник, щоб випадково не видати права керівника
    const pick = selected && list.some((p) => p.id === selected) ? selected : (list.find((p) => accessLevelOf(p) === "staff") || list[0]).id;
    return list.map((p) => `<option value="${attr(p.id)}"${p.id === pick ? " selected" : ""}>${esc(p.title)} — ${esc(levelLabel(p))}</option>`).join("");
  }
  function pendingUsers() { return allUsers().filter((u) => role(u) === "pending"); }
  // Прив'язки Discord знає лише сервер (у профілі не зберігаються): завантажуються разом зі сторінкою
  let discordLinks = {};
  function loadLinks() {
    if (!can.people) return;
    const res = loadDiscordLinks();
    if (res.ok) discordLinks = res.map;
  }
  function userBadges(u) {
    const r = role(u);
    let b = r === "pending" ? `<span class="badge warn">Без призначення</span>` : r === "citizen" ? `<span class="badge dead">Громадянин</span>` : "";
    const d = discordLinks[u.login];
    if (d) b += `<span class="badge discord" title="${attr(d.viaDiscord ? "Акаунт створено входом через Discord" : "Discord прив'язано до акаунта з паролем")}">Discord · ${esc(d.name)}</span>`;
    if (isCongressMember(u)) b += `<span class="badge draft">Конгресмен</span>`;
    if (isStaff(u) && isFullAdmin(u)) b += `<span class="badge ok">Адміністратор</span>`;
    else if ((u.extraPermissions || []).length && isStaff(u)) b += `<span class="badge draft">+${u.extraPermissions.length} прав</span>`;
    return b;
  }
  function userMeta(u) {
    if (role(u) === "citizen") return `<span>${esc(u.login)}</span><span>Громадянин штату</span>`;
    if (role(u) === "pending") return `<span>${esc(u.login)}</span><span>${esc(u.post || "посаду не вказано")}</span>`;
    const p = positionById(u.positionId);
    return `<span>${esc(u.login)}</span><span>${esc(officeName(u.office || userOffice(u)))}</span><span>${esc(p ? p.title : "без посади")}</span>`;
  }

  /* ---------- Потребує уваги ---------- */
  function drawTodo() {
    $("pending-card").hidden = !can.people;
    $("profiles-card").hidden = !can.profiles;
    const pend = pendingUsers();
    $("pending-box").innerHTML = pend.length ? pend.map((u) => `
      <article class="admin-list-row is-attention assign-row" data-login="${attr(u.login)}">
        <div class="user-avatar">${esc(initials(u))}</div>
        <div class="admin-row-main">
          <div class="admin-row-title"><b>${esc(u.name || u.login)}</b></div>
          <div class="admin-row-meta"><span>${esc(u.login)}</span><span>Бажана посада: ${esc(u.post || "не вказано")}</span>${u.contact ? `<span>${esc(u.contact)}</span>` : ""}</div>
          <div class="assign-controls">
            <select data-assign-office>${officeOptions("", true)}</select>
            <select data-assign-position disabled><option value="">Спершу оберіть апарат</option></select>
          </div>
        </div>
        <div class="admin-row-actions">
          <button class="btn gold" type="button" data-act="assign" disabled>Призначити</button>
          <button class="btn ghost" type="button" data-act="make-citizen" title="Відкрити кабінет громадянина без посади">Як громадянина</button>
        </div>
      </article>`).join("") : `<div class="admin-empty">Нових учасників немає. Як тільки хтось зареєструється, він з'явиться тут.</div>`;
    const reqs = pendingProfileRequests();
    $("profiles-box").innerHTML = reqs.length ? reqs.map((r) => {
      const u = allUsers().find((x) => x.login === r.login) || {};
      const diff = [["Ім'я", u.name, r.name], ["Підпис", u.post, r.post], ["Stat ID", u.statId, r.statId], ["Контакт", u.contact, r.contact]]
        .filter(([, a, b]) => (a || "") !== (b || "")).map(([k, a, b]) => `<span>${k}: ${esc(a || "—")} → <b>${esc(b || "—")}</b></span>`).join("");
      return `<article class="admin-list-row is-attention">
        ${r.photo && r.photo !== u.photo ? `<img class="user-avatar" src="${attr(r.photo)}" alt="" style="object-fit:cover">` : `<div class="user-avatar">${esc(initials(u))}</div>`}
        <div class="admin-row-main">
          <div class="admin-row-title"><b>${esc(u.name || r.login)}</b>${r.photo && r.photo !== u.photo ? `<span class="badge draft">Нове фото</span>` : ""}</div>
          <div class="admin-row-meta">${diff || "<span>Лише фото</span>"}</div>
        </div>
        <div class="admin-row-actions">
          <button class="btn gold" type="button" data-profile="${attr(r.id)}" data-ok="1">Підтвердити</button>
          <button class="btn ghost danger" type="button" data-profile="${attr(r.id)}">Відхилити</button>
        </div>
      </article>`;
    }).join("") : `<div class="admin-empty">Заявок на зміну профілю немає.</div>`;
  }

  /* ---------- Люди ---------- */
  function drawPeople() {
    const q = $("people-q").value.trim().toLowerCase();
    const f = $("people-f").value;
    const list = allUsers().filter((u) => {
      const r = role(u);
      if (f === "staff" && !isStaff(u)) return false;
      if (f === "citizen" && r !== "citizen") return false;
      if (f === "pending" && r !== "pending") return false;
      if (f === "congress" && !isCongressMember(u)) return false;
      if (f === "discord" && !discordLinks[u.login]) return false;
      if (f === "nodiscord" && discordLinks[u.login]) return false;
      const p = positionById(u.positionId);
      const d = discordLinks[u.login];
      return !q || `${u.name || ""} ${u.login} ${u.post || ""} ${p ? p.title : ""} ${d ? d.name : ""}`.toLowerCase().includes(q);
    }).sort((a, b) => String(a.name || a.login).localeCompare(String(b.name || b.login), "uk"));
    $("people-box").innerHTML = list.length ? list.map((u) => `
      <article class="admin-list-row">
        ${u.photo ? `<img class="user-avatar" src="${attr(u.photo)}" alt="" style="object-fit:cover">` : `<div class="user-avatar">${esc(initials(u))}</div>`}
        <div class="admin-row-main">
          <div class="admin-row-title"><b>${esc(u.name || u.login)}</b>${userBadges(u)}</div>
          <div class="admin-row-meta">${userMeta(u)}</div>
        </div>
        <div class="admin-row-actions"><button class="btn ghost" type="button" data-edit-user="${attr(u.login)}">Змінити</button></div>
      </article>`).join("") : `<div class="admin-empty">Нікого не знайдено.</div>`;
  }
  function openUser(login) {
    const u = allUsers().find((x) => x.login === login);
    if (!u) return;
    const form = $("user-form");
    form.login.value = u.login;
    $("user-title").textContent = u.name || u.login;
    $("user-sub").textContent = u.login + (u.contact ? " · " + u.contact : "");
    const office = isStaff(u) ? (u.office || userOffice(u)) : "";
    form.office.innerHTML = officeOptions(office, true);
    form.positionId.innerHTML = office ? positionOptions(office, u.positionId) : `<option value="">Спершу оберіть апарат</option>`;
    form.positionId.disabled = !office;
    form.post.value = u.post || "";
    form.congressMember.checked = isCongressMember(u);
    $("user-congress-wrap").hidden = !can.congress;
    editingExtra = (u.extraPermissions || []).slice();
    drawUserPerms();
    $("user-perm-details").open = editingExtra.length > 0;
    // Рівний чи вищий за рангом — лише перегляд (так само перевіряє сервер)
    const manageable = canManageUser(me, u);
    form.querySelectorAll("select, input, [type=submit]").forEach((el) => { if (el.name !== "login") el.disabled = !manageable; });
    if (manageable) form.positionId.disabled = !office;
    $("user-rank-note").hidden = manageable;
    $("user-rank-note").textContent = isSuperAdmin(u) ? "Це головний адміністратор порталу — змінити його може лише він сам."
      : "Ця людина має рівний або вищий рівень доступу — змінити, позбавити прав чи видалити її може лише вищий за рангом.";
    form.querySelector("[data-act=revoke]").hidden = !manageable || !isStaff(u) || u.login === me.login;
    form.querySelector("[data-act=delete-user]").hidden = !manageable || !can.people || u.seeded || u.login === me.login;
    form.querySelector("[data-act=reset-password]").hidden = !manageable || !can.people || u.login === me.login;
    // Discord: хто прив'язаний і чи створено акаунт через Discord; відв'язати — за тими ж правилами рангу
    const d = discordLinks[u.login];
    $("user-discord").hidden = !can.people;
    $("user-discord-line").innerHTML = d
      ? `<b>Discord:</b> ${esc(d.name)} <small class="muted">· ${d.viaDiscord ? "акаунт створено входом через Discord" : "прив'язано до акаунта з паролем"}</small>`
      : `<b>Discord:</b> <span class="muted">не прив'язано</span>`;
    $("user-discord-unlink").hidden = !d || !(manageable || u.login === me.login);
    $("user-discord-unlink").disabled = false;
    syncLevelHelp();
    $("user-modal").hidden = false;
  }
  // Особисті права: права посади — позначені й заблоковані; видати можна лише ті, що є в самого адміна
  let editingExtra = [];
  function drawUserPerms() {
    const form = $("user-form");
    const staffSelected = !!form.office.value;
    $("user-perm-details").hidden = !can.people || !staffSelected;
    if (!staffSelected) return;
    const p = positionById(form.positionId.value);
    const fromPos = p ? (p.permissions || []) : [];
    $("user-perm-list").innerHTML = Object.keys(PERMISSION_LABELS).map((k) => {
      const byPos = fromPos.includes(k);
      const mine = hasPermission(me, k);
      return `<label class="inline-check"${byPos ? ` title="Є в посади"` : !mine ? ` title="У вас немає цього права"` : ""}><input type="checkbox" name="uperm" value="${k}"${byPos || editingExtra.includes(k) ? " checked" : ""}${byPos || !mine ? " disabled" : ""}> ${esc(PERMISSION_LABELS[k])}${byPos ? ` <small class="muted">· від посади</small>` : ""}</label>`;
    }).join("");
    syncFullAdmin();
  }
  // Повні права адміністратора видає лише головний адміністратор
  function syncFullAdmin() {
    const boxes = Array.from(document.querySelectorAll("#user-perm-list input"));
    $("user-full-admin").checked = boxes.length > 0 && boxes.every((b) => b.checked);
    $("user-full-admin").disabled = !isSuperAdmin(me) || boxes.some((b) => !b.checked && b.disabled);
    $("user-full-admin").closest("label").title = isSuperAdmin(me) ? "" : "Повні права видає лише головний адміністратор";
  }
  $("user-perm-list").addEventListener("change", () => {
    editingExtra = Array.from(document.querySelectorAll("#user-perm-list input:checked:not(:disabled)")).map((b) => b.value);
    syncFullAdmin();
  });
  $("user-full-admin").addEventListener("change", (e) => {
    document.querySelectorAll("#user-perm-list input:not(:disabled)").forEach((b) => { b.checked = e.target.checked; });
    editingExtra = Array.from(document.querySelectorAll("#user-perm-list input:checked:not(:disabled)")).map((b) => b.value);
  });
  function syncLevelHelp() {
    const form = $("user-form");
    const p = positionById(form.positionId.value);
    form.post.placeholder = p ? p.title : "";
    const l = p ? accessLevelOf(p) : "";
    $("user-level-help").textContent = p ? (l === "custom" ? "Особливий набір прав." : ACCESS_LEVELS[l].hint + ".") : "";
  }

  /* ---------- Структура ---------- */
  function routeText(officeId) {
    const a = officeApproval(officeId);
    const steps = [a.head ? "Керівник апарату" : "", a.governor ? "Губернатор" : ""].filter(Boolean);
    return steps.length ? steps.join(" → ") + " → публікація" : "без погодження";
  }
  function drawStructure() {
    $("offices-box").innerHTML = allOffices().map((o) => {
      const posts = positionsOf(o.id);
      const people = allUsers().filter((u) => isStaff(u) && (u.office || userOffice(u)) === o.id);
      const branch = BRANCHES.find((b) => b.role === o.role);
      return `<article class="office-card">
        <header>
          <div><b>${esc(o.name)}</b><small>${esc(branch ? branch.label : "")} · ${people.length} ${people.length === 1 ? "людина" : "людей"}</small></div>
          ${can.structure ? `<button class="btn ghost" type="button" data-edit-office="${attr(o.id)}">Змінити</button>` : ""}
        </header>
        <ul class="position-list">
          ${posts.map((p) => {
            const holders = people.filter((u) => u.positionId === p.id);
            return `<li>
              <div><b>${esc(p.title)}</b><small>${esc(levelLabel(p))}${holders.length ? " · " + holders.map((u) => esc(u.name || u.login)).join(", ") : " · вакантно"}</small></div>
              ${can.structure ? `<button class="link-btn" type="button" data-edit-position="${attr(p.id)}">змінити</button>` : ""}
            </li>`;
          }).join("") || `<li class="muted">Посад немає</li>`}
        </ul>
        <footer>
          ${can.structure ? `<button class="link-btn" type="button" data-new-position="${attr(o.id)}">+ посада</button>` : ""}
          <span class="route-inline" title="Хто погоджує документи цього апарату">Погодження: ${esc(routeText(o.id))}</span>
          ${can.structure || can.routes ? `<button class="link-btn" type="button" data-edit-office="${attr(o.id)}">змінити</button>` : ""}
        </footer>
      </article>`;
    }).join("");
  }
  function openOffice(id) {
    const o = id ? allOffices().find((x) => x.id === id) : null;
    const form = $("office-form");
    form.id.value = o ? o.id : "";
    form.name.value = o ? o.name : "";
    $("office-title").textContent = o ? "Апарат" : "Новий апарат";
    $("office-auto-note").hidden = !!o;
    const approval = o ? officeApproval(o.id) : { head: true, governor: true };
    form.apHead.checked = approval.head;
    form.apGov.checked = approval.governor;
    const cur = o ? o.role : "official";
    $("branch-list").innerHTML = BRANCHES.filter((b) => b.role !== "governor" || cur === "governor").map((b) => `
      <label class="choice"><input type="radio" name="role" value="${b.role}"${b.role === cur ? " checked" : ""}${o && isDefaultOffice(o.id) ? " disabled" : ""}><span><b>${esc(b.label)}</b><small>${esc(b.hint)}</small></span></label>`).join("");
    form.querySelector("[data-act=delete-office]").hidden = !o || isDefaultOffice(o.id);
    $("office-modal").hidden = false;
    form.name.focus();
  }
  function openPosition(id, officeId) {
    const p = id ? positionById(id) : null;
    const form = $("position-form");
    form.id.value = p ? p.id : "";
    form.office.value = p ? p.office : officeId;
    form.title.value = p ? p.title : "";
    $("position-title").textContent = (p ? "Посада · " : "Нова посада · ") + officeName(p ? p.office : officeId);
    const lvl = p ? accessLevelOf(p) : "staff";
    $("level-list").innerHTML = Object.keys(ACCESS_LEVELS).filter((k) => k !== "admin" || isSuperAdmin(me) || k === lvl).map((k) => `
      <label class="choice"><input type="radio" name="level" value="${k}"${k === lvl ? " checked" : ""}><span><b>${esc(ACCESS_LEVELS[k].label)}</b><small>${esc(ACCESS_LEVELS[k].hint)}</small></span></label>`).join("") +
      (lvl === "custom" ? `<label class="choice"><input type="radio" name="level" value="custom" checked><span><b>Особливі права</b><small>налаштовані вручну нижче</small></span></label>` : "");
    const perms = p ? (p.permissions || []) : ACCESS_LEVELS.staff.permissions;
    $("perm-list").innerHTML = Object.keys(PERMISSION_LABELS).map((k) =>
      `<label class="inline-check"><input type="checkbox" name="perm" value="${k}"${perms.includes(k) ? " checked" : ""}> ${esc(PERMISSION_LABELS[k])}</label>`).join("");
    $("perm-details").open = lvl === "custom";
    const holders = p ? allUsers().filter((u) => u.positionId === p.id).length : 0;
    const del = form.querySelector("[data-act=delete-position]");
    del.hidden = !p || isDefaultPosition(p.id);
    del.disabled = holders > 0;
    del.title = holders ? "Спершу переведіть людей на іншу посаду" : "";
    $("position-modal").hidden = false;
    form.title.focus();
  }
  // Рівень доступу ↔ галочки прав тримаємо узгодженими
  $("level-list").addEventListener("change", (e) => {
    const l = e.target.value;
    if (!ACCESS_LEVELS[l]) return;
    document.querySelectorAll("#perm-list input").forEach((i) => { i.checked = ACCESS_LEVELS[l].permissions.includes(i.value); });
  });
  $("perm-list").addEventListener("change", () => {
    const perms = Array.from(document.querySelectorAll("#perm-list input:checked")).map((i) => i.value).sort().join();
    const match = Object.keys(ACCESS_LEVELS).find((k) => ACCESS_LEVELS[k].permissions.slice().sort().join() === perms);
    document.querySelectorAll("#level-list input").forEach((i) => { i.checked = i.value === (match || "custom"); });
    if (!match && !document.querySelector("#level-list input[value=custom]")) {
      $("level-list").insertAdjacentHTML("beforeend", `<label class="choice"><input type="radio" name="level" value="custom" checked><span><b>Особливі права</b><small>налаштовані вручну нижче</small></span></label>`);
    }
  });

  /* ---------- Конгрес ---------- */
  function drawCongress() {
    const members = congressMembers();
    const t = { members: members.length, needed: Math.floor(Math.max(members.length, 1) / 2) + 1 };
    $("congress-rule").innerHTML = `<b>Як голосує Конгрес</b>Зараз конгресменів: ${t.members}. Щоб документ пройшов, потрібно ${t.needed} ${t.needed === 1 ? "голос" : "голоси"} «за». Якщо стільки ж проголосує «проти» — документ відхиляється. Документ потрапляє на голосування, якщо: автор обрав «Конгрес штату» у вікні «На погодження»; у маршруті апарату є крок «Голосування Конгресу»; або це «Закон» (для законів крок Конгресу додається автоматично перед Губернатором).`;
    const candidates = allUsers().filter((u) => isStaff(u) && !isCongressMember(u));
    $("congress-pick").innerHTML = candidates.length
      ? candidates.map((u) => `<option value="${attr(u.login)}">${esc(u.name || u.login)} · ${esc(officeName(u.office || userOffice(u)))}</option>`).join("")
      : `<option value="">Усі посадовці вже конгресмени</option>`;
    $("congress-box").innerHTML = members.length ? members.map((u) => `
      <article class="admin-list-row">
        <div class="user-avatar">${esc(initials(u))}</div>
        <div class="admin-row-main">
          <div class="admin-row-title"><b>${esc(u.name || u.login)}</b><span class="badge draft">Конгресмен</span></div>
          <div class="admin-row-meta">${userMeta(u)}</div>
        </div>
        <div class="admin-row-actions"><button class="btn ghost danger" type="button" data-congress-remove="${attr(u.login)}">Зняти статус</button></div>
      </article>`).join("") : `<div class="admin-empty">Конгресменів ще немає. Оберіть посадовця вище й натисніть «Надати статус».</div>`;
  }

  /* ---------- Типи документів ---------- */
  function drawDocTypes() {
    const items = customDocTypes();
    $("doctypes-box").innerHTML = items.length ? items.map((t) => {
      const who = (t.offices || []).length ? t.offices.map(officeName).join(", ") : "усі апарати";
      const n = docTypeUsage(t.label);
      return `<article class="admin-list-row">
        <div class="admin-row-main">
          <div class="admin-row-title"><b>${esc(t.label)}</b>${t.congress ? ` <span class="badge">Конгрес</span>` : ""}</div>
          <div class="admin-row-meta">${t.showInBase !== false ? "Розділ «" + esc(t.section || t.label) + "»" : "Без окремого розділу"} · створюють: ${esc(who)} · документів: ${n}</div>
        </div>
        <div class="admin-row-actions"><button class="btn ghost" type="button" data-edit-doctype="${attr(t.id)}">Змінити</button></div>
      </article>`;
    }).join("") : `<div class="admin-empty">Власних типів ще немає. Вбудовані (закони, накази, укази…) працюють як і раніше.</div>`;
  }
  function openDocType(id) {
    const t = customDocTypes().find((x) => x.id === id) || { offices: [], showInBase: true };
    const f = $("doctype-form");
    f.id.value = t.id || "";
    f.label.value = t.label || "";
    f.section.value = t.section && t.section !== t.label ? t.section : "";
    f.showInBase.checked = t.showInBase !== false;
    f.congress.checked = !!t.congress;
    f.title.value = t.title && t.title !== (t.label + " №{НОМЕР}") ? t.title : "";
    f.subject.value = t.subject || "";
    f.preamble.value = t.preamble || "";
    f.effective.value = t.effective || "";
    $("doctype-offices").innerHTML = allOffices().map((o) => `<label class="inline-check"><input type="checkbox" value="${attr(o.id)}" ${(t.offices || []).includes(o.id) ? "checked" : ""}> ${esc(o.name)}</label>`).join("");
    $("doctype-title").textContent = t.id ? "Тип «" + t.label + "»" : "Новий тип документа";
    const n = t.id ? docTypeUsage(t.label) : 0;
    $("doctype-usage").textContent = n ? "Документів цього типу: " + n + ". Назву типу змінити не можна — інакше вони випадуть із розділу." : "";
    f.label.readOnly = n > 0;
    f.querySelector("[data-act=delete-doctype]").hidden = !t.id;
    $("doctype-modal").hidden = false;
  }

  /* ---------- Журнал ---------- */
  let auditItems = [];
  let auditLoaded = false;
  function drawAudit(more) {
    if (!can.audit) return;
    if (!auditLoaded || more) {
      const res = loadAudit(more && auditItems.length ? auditItems[auditItems.length - 1].id : 0);
      if (!res.ok) { $("audit-box").innerHTML = `<div class="admin-empty">${esc(res.error)}</div>`; return; }
      auditItems = more ? auditItems.concat(res.items) : res.items;
      auditLoaded = true;
      $("audit-more").hidden = res.items.length < 100;
    }
    const q = $("audit-q").value.trim().toLowerCase();
    const list = auditItems.filter((it) => !q || `${it.actor} ${it.action} ${it.target} ${it.details}`.toLowerCase().includes(q));
    const who = (login) => { const u = allUsers().find((x) => x.login === login); return u ? (u.name || login) + " (" + login + ")" : login || "—"; };
    $("audit-box").innerHTML = list.length ? list.map((it) => `
      <article class="audit-row">
        <time>${esc(formatDocWhen({ date: new Date(it.at).toISOString() }))}</time>
        <div><b>${esc(it.action)}</b> · ${esc(it.target)}${it.details ? `<small>${esc(it.details)}</small>` : ""}</div>
        <span class="muted">${esc(who(it.actor))}</span>
      </article>`).join("") : `<div class="admin-empty">Записів немає.</div>`;
  }

  /* ---------- Малювання всього ---------- */
  function refresh() {
    loadLinks();
    drawTabs();
    if (can.people || can.profiles) drawTodo();
    if (can.people) drawPeople();
    if (can.structure || can.routes) drawStructure();
    if (can.structure || can.routes) drawDocTypes();
    if (can.congress) drawCongress();
    if (current === "audit") drawAudit();
    if (typeof enhanceCabinetNavigation === "function" && document.querySelector(".side-me")) enhanceCabinetNavigation();
  }
  const closeAll = () => document.querySelectorAll(".modal-backdrop").forEach((m) => { m.hidden = true; });

  /* ---------- Події ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab-btn]");
    if (tab) return showTab(tab.dataset.tabBtn);
    if (t.closest("[data-close]") || t.classList.contains("modal-backdrop")) return closeAll();
    const act = t.closest("[data-act]");
    const a = act && act.dataset.act;
    if (a === "assign") {
      const row = act.closest(".assign-row");
      const office = row.querySelector("[data-assign-office]").value;
      const pos = row.querySelector("[data-assign-position]").value;
      const u = assignUser(row.dataset.login, { office, positionId: pos, post: "" }, me);
      toast((u.name || u.login) + " → " + positionById(pos).title);
      return refresh();
    }
    if (a === "make-citizen") {
      const login = act.closest(".assign-row").dataset.login;
      const u = allUsers().find((x) => x.login === login);
      saveUser(Object.assign({}, u, { roles: ["citizen"], office: "citizens", positionId: "" }));
      toast("Відкрито кабінет громадянина");
      return refresh();
    }
    if (a === "revoke") {
      const form = $("user-form");
      const u = allUsers().find((x) => x.login === form.login.value);
      if (!confirm("Забрати в «" + (u.name || u.login) + "» доступ до службового кабінету?\nЛюдина повернеться в список «Нові учасники».")) return;
      assignUser(u.login, { office: "" }, me);
      if (can.congress) setCongressMember(u.login, false, me);
      closeAll(); toast("Доступ забрано");
      return refresh();
    }
    if (a === "reset-password") {
      const login = $("user-form").login.value;
      const u = allUsers().find((x) => x.login === login);
      if (!u || !confirm("Скинути пароль «" + (u.name || u.login) + "» (" + u.login + ")?\n\nСтарий пароль перестане діяти, людину буде виведено з усіх пристроїв. Ви отримаєте тимчасовий пароль — передайте його людині особисто.")) return;
      const res = resetUserPassword(login);
      if (!res.ok) { alert(res.error); return; }
      prompt("Тимчасовий пароль для " + login + " (скопіюйте й передайте людині; після входу система попросить його змінити):", res.password);
      toast("Пароль " + login + " скинуто");
      return;
    }
    if (a === "discord-unlink") {
      const login = $("user-form").login.value;
      const u = allUsers().find((x) => x.login === login);
      const d = discordLinks[login];
      if (!u || !d) return;
      const hint = d.viaDiscord
        ? "\n\nАкаунт створено через Discord, пароля людина не знає: після відв'язки вона зможе увійти лише з тимчасовим паролем («Скинути пароль»)."
        : "\n\nЛюдина зможе входити паролем і прив'язати Discord знову у своєму профілі.";
      if (!confirm("Відв'язати Discord «" + d.name + "» від акаунта «" + (u.name || u.login) + "» (" + u.login + ")?" + hint)) return;
      const res = adminDiscordUnlink(login);
      if (!res.ok) { alert(res.error); return; }
      discordLinks = res.map;
      openUser(login);
      toast("Discord відв'язано");
      return drawPeople();
    }
    if (a === "audit-more") return drawAudit(true);
    if (a === "delete-user") {
      const login = $("user-form").login.value;
      const u = allUsers().find((x) => x.login === login);
      if (!u || !confirm("Видалити акаунт «" + (u.name || u.login) + "» (" + u.login + ")?\n\nЛюдина більше не зможе увійти, профіль і заявки буде видалено. " +
        "Її документи та звернення лишаться в реєстрі. Скасувати це не можна.")) return;
      const res = deleteUserAccount(login, me);
      if (!res.ok) { alert(res.error); return; }
      closeAll(); toast("Акаунт " + login + " видалено");
      return refresh();
    }
    if (a === "new-doctype") return openDocType("");
    const dt = t.closest("[data-edit-doctype]");
    if (dt) return openDocType(dt.dataset.editDoctype);
    if (a === "delete-doctype") {
      const f = $("doctype-form");
      const n = docTypeUsage(f.label.value);
      if (!confirm("Видалити тип «" + f.label.value + "»?" + (n ? "\n\n" + n + " документ(ів) цього типу лишаться в реєстрі й у розділі «Усі акти», але окремого розділу вже не буде." : ""))) return;
      deleteDocType(f.id.value);
      closeAll(); toast("Тип видалено");
      return refresh();
    }
    if (a === "new-office") return openOffice("");
    if (a === "delete-office") {
      const id = $("office-form").id.value;
      if (!confirm("Видалити апарат «" + officeName(id) + "» разом із його посадами?")) return;
      if (!deleteOffice(id)) { alert("Не можна видалити: в апараті є люди. Спершу переведіть їх."); return; }
      closeAll(); toast("Апарат видалено");
      return refresh();
    }
    if (a === "delete-position") {
      const id = $("position-form").id.value;
      if (!confirm("Видалити посаду?")) return;
      if (!deletePosition(id)) { alert("Не можна видалити: на посаді є люди."); return; }
      closeAll(); toast("Посаду видалено");
      return refresh();
    }
    if (a === "congress-add") {
      const login = $("congress-pick").value;
      if (!login) return;
      setCongressMember(login, true, me);
      toast("Статус конгресмена надано");
      return refresh();
    }
    const cr = t.closest("[data-congress-remove]");
    if (cr) {
      if (!confirm("Зняти статус конгресмена?")) return;
      setCongressMember(cr.dataset.congressRemove, false, me);
      return refresh();
    }
    const pr = t.closest("[data-profile]");
    if (pr) { decideProfileRequest(pr.dataset.profile, me, !!pr.dataset.ok); toast(pr.dataset.ok ? "Профіль оновлено" : "Заявку відхилено"); return refresh(); }
    const eu = t.closest("[data-edit-user]");
    if (eu) return openUser(eu.dataset.editUser);
    const eo = t.closest("[data-edit-office]");
    if (eo) return openOffice(eo.dataset.editOffice);
    const ep = t.closest("[data-edit-position]");
    if (ep) return openPosition(ep.dataset.editPosition);
    const np = t.closest("[data-new-position]");
    if (np) return openPosition("", np.dataset.newPosition);
  });
  document.addEventListener("change", (e) => {
    const office = e.target.closest("[data-assign-office]");
    if (office) {
      const row = office.closest(".assign-row");
      const pos = row.querySelector("[data-assign-position]");
      pos.innerHTML = office.value ? positionOptions(office.value) : `<option value="">Спершу оберіть апарат</option>`;
      pos.disabled = !office.value;
      row.querySelector("[data-act=assign]").disabled = !office.value || !pos.value;
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  $("people-q").addEventListener("input", drawPeople);
  $("people-f").addEventListener("change", drawPeople);
  $("user-form").office.addEventListener("change", (e) => {
    const f = $("user-form");
    f.positionId.innerHTML = e.target.value ? positionOptions(e.target.value) : `<option value="">Спершу оберіть апарат</option>`;
    f.positionId.disabled = !e.target.value;
    syncLevelHelp();
    drawUserPerms();
  });
  $("user-form").positionId.addEventListener("change", () => { syncLevelHelp(); drawUserPerms(); });
  $("user-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const patch = f.office.value ? { office: f.office.value, positionId: f.positionId.value, post: f.post.value } : { office: "" };
    if (can.congress) patch.congressMember = f.congressMember.checked;
    assignUser(f.login.value, patch, me);
    // Права посади в особисті не дублюємо
    const pos = positionById(f.positionId.value);
    if (can.people && f.office.value) setUserPermissions(f.login.value, editingExtra.filter((k) => !(pos && (pos.permissions || []).includes(k))), me);
    closeAll(); toast("Збережено");
    refresh();
  });
  $("doctype-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const res = saveDocType({
      id: f.id.value,
      label: f.label.value,
      section: f.section.value,
      showInBase: f.showInBase.checked,
      congress: f.congress.checked,
      offices: Array.from(document.querySelectorAll("#doctype-offices input:checked")).map((i) => i.value),
      title: f.title.value,
      subject: f.subject.value,
      preamble: f.preamble.value,
      effective: f.effective.value
    });
    if (!res.ok) { alert(res.error); return; }
    closeAll();
    toast(f.id.value ? "Тип збережено" : "Тип «" + res.type.label + "» створено");
    refresh();
  });
  $("office-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const checked = f.querySelector("input[name=role]:checked");
    const roleVal = checked ? checked.value : "official";
    const approval = { head: f.apHead.checked, governor: f.apGov.checked };
    if (!approval.head && !approval.governor) { alert("Оберіть хоча б одного, хто погоджує документи апарату."); return; }
    if (f.id.value) {
      const o = allOffices().find((x) => x.id === f.id.value);
      const role = isDefaultOffice(o.id) ? o.role : roleVal;
      saveOffice(Object.assign({}, o, { name: f.name.value, role, approval }));
      // Люди апарату отримують роль нової гілки влади
      if (role !== o.role) allUsers().filter((u) => isStaff(u) && u.office === o.id).forEach((u) => saveUser(Object.assign({}, u, { roles: [roleForOffice(o.id)] })));
      toast("Апарат збережено");
    } else {
      createOffice({ name: f.name.value, role: roleVal, approval });
      toast("Апарат створено з посадами «Керівник» і «Співробітник»");
    }
    closeAll();
    refresh();
  });
  $("position-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const lvl = (f.querySelector("input[name=level]:checked") || {}).value || "custom";
    const perms = Array.from(document.querySelectorAll("#perm-list input:checked")).map((i) => i.value);
    savePosition({ id: f.id.value || undefined, office: f.office.value, title: f.title.value, level: lvl, permissions: perms });
    closeAll(); toast("Посаду збережено");
    refresh();
  });

  refresh();
  $("audit-q").addEventListener("input", () => drawAudit());
});
