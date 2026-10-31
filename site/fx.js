/* Ефекти «Сови»: заставка входу, «ДОСТУП НАДАНО», гриф і годинник у кабінеті, лічильники плиток, поява розділів.
   Нічого не змінює в логіці app.js — лише стежить за #app і додає оформлення. */
(() => {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const app = document.getElementById("app");
  const kyiv = (o) => new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", ...o });
  let wasLogin = false, booted = false;
  const seen = new WeakSet();

  function boot() {
    try { if (sessionStorage.getItem("sova-boot")) return; sessionStorage.setItem("sova-boot", "1"); } catch (e) {}
    if (calm) return;
    const lines = [
      "<b>СЛУЖБА БЕЗПЕКИ ШТАТУ NG</b>",
      "ЄІС «СОВА» · захищений вузол зв'язку",
      "",
      "> ініціалізація каналу ............ <i>OK</i>",
      "> шифрування сеансу ED25519 ....... <i>OK</i>",
      "> перевірка ролей Discord ......... <i>OK</i>",
      "> гриф: ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ",
      "",
      "Очікую автентифікацію співробітника…",
    ];
    const el = document.createElement("div");
    el.className = "fx-boot";
    el.innerHTML = "<pre></pre><small>НАТИСНІТЬ, ЩОБ ПРОПУСТИТИ</small>";
    document.body.append(el);
    const pre = el.firstChild;
    let i = 0, done = false;
    const close = () => { if (done) return; done = true; el.classList.add("out"); setTimeout(() => el.remove(), 600); };
    el.onclick = close;
    (function next() {
      if (done) return;
      if (i >= lines.length) return setTimeout(close, 700);
      pre.innerHTML += lines[i++] + "\n";
      setTimeout(next, i < 3 ? 220 : 170);
    })();
  }

  function decorateLogin() {
    const card = app.querySelector(".login-card");
    if (!card || card.dataset.fx) return;
    card.dataset.fx = 1;
    const img = card.querySelector("img");
    const ring = document.createElement("div");
    ring.className = "fx-ring";
    img.replaceWith(ring);
    ring.append(img);
    card.querySelector("h1")?.classList.add("fx-glitch");
    card.insertAdjacentHTML("afterbegin", '<span class="fx-grif">ДСК</span>');
    card.insertAdjacentHTML("beforeend", `<div class="fx-meta"><span>ВУЗОЛ: NG-SBU-01</span><span id="fx-lt">${kyiv({ hour: "2-digit", minute: "2-digit" })}</span></div>`);
  }

  function granted() {
    if (calm) return;
    const el = document.createElement("div");
    el.className = "fx-granted";
    el.innerHTML = "<div>ДОСТУП НАДАНО<span>ЛАСКАВО ПРОСИМО ДО СИСТЕМИ</span></div>";
    document.body.append(el);
    setTimeout(() => el.remove(), 1600);
  }

  function decorateShell() {
    const main = app.querySelector("main.main");
    if (main && !main.querySelector(".fx-class")) {
      main.insertAdjacentHTML("afterbegin", '<div class="fx-class"><span>ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ</span><span class="r"><span class="live">ЗАХИЩЕНИЙ СЕАНС</span></span></div>');
      main.querySelector(".top .right")?.insertAdjacentHTML("afterbegin", '<span class="fx-clock" id="fx-clock"></span>');
      tick();
    }
  }

  function countUp(root) {
    if (calm) return;
    root.querySelectorAll(".tile .v.num").forEach((v) => {
      const end = Number(v.textContent.trim());
      if (!Number.isFinite(end) || end <= 0 || v.dataset.fx) return;
      v.dataset.fx = 1;
      const t0 = performance.now(), dur = 700;
      (function step(t) {
        const k = Math.min(1, (t - t0) / dur);
        v.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  function tick() {
    const c = document.getElementById("fx-clock");
    if (c) c.textContent = kyiv({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const l = document.getElementById("fx-lt");
    if (l) l.textContent = kyiv({ hour: "2-digit", minute: "2-digit" });
  }
  setInterval(tick, 1000);

  new MutationObserver(() => {
    const login = !!app.querySelector(".login");
    if (login) { decorateLogin(); if (!booted) { booted = true; boot(); } }
    if (app.querySelector(".shell")) {
      if (wasLogin) granted();
      decorateShell();
      const view = document.getElementById("view");
      const first = view && view.firstElementChild;
      if (first && !view.querySelector(".empty .spin") && !seen.has(first)) {
        seen.add(first);
        view.classList.remove("fx-in"); void view.offsetWidth; view.classList.add("fx-in");
        countUp(view);
      }
    }
    wasLogin = login;
  }).observe(app, { childList: true, subtree: true });

})();
