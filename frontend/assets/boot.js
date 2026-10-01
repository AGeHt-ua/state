/* Запускається в <head> до показу сторінки (окремим файлом — політика безпеки забороняє вбудовані скрипти):
   - сайт не можна вбудувати в чужу сторінку (захист від клікджекінгу);
   - тема (світла/темна) ставиться одразу, без спалаху світлої. */
(function () {
  if (window.top !== window.self) {
    try { window.top.location = window.self.location; } catch (e) { document.documentElement.style.display = "none"; }
  }
  try {
    var t = localStorage.getItem("state_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = t;
  } catch (e) { /* приватний режим */ }
})();
