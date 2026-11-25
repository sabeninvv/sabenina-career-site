// Скрипт сайта Евгении Сабениной. Подключается с defer.

/**
 * Липкая кнопка на телефоне: видна, когда на экране нет основной кнопки действия
 * (.actions, .final, .svc) и окна формы (.form-embed), иначе дублирует кнопку или закрывает поля (HANDOFF 6.2).
 */
function initSticky() {
  const bar = document.querySelector(".sticky");
  if (!bar) return;
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target);
    bar.hidden = seen.size > 0;
  });
  document.querySelectorAll(".actions .btn, .final .btn, .svc .btn, .form-embed").forEach((el) => io.observe(el));
}

/**
 * Мобильное меню (<details class="menu">): закрывается по клику вне меню и по клавише Escape,
 * чтобы список разделов не оставался открытым поверх страницы.
 */
function initMenu() {
  const menu = document.querySelector("details.menu");
  if (!menu) return;
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
}

/** Ключи меток источника, которые сайт передаёт форме, счётчикам и следующей странице. */
const TAG_KEYS = ["utm_source", "utm_content"];

/**
 * Метки источника из адреса текущей страницы. Ничего не хранит в браузере:
 * на другие страницы метки уходят в адресе внутренних ссылок (carryTags).
 * @returns {{utm_source?: string, utm_content?: string}}
 */
function pageTags() {
  const query = new URLSearchParams(location.search);
  const tags = {};
  for (const key of TAG_KEYS) {
    const value = query.get(key);
    if (value) tags[key] = value.slice(0, 100);
  }
  return tags;
}

/**
 * Дописывает метки из адреса к ссылкам на страницы сайта, чтобы форма на другой странице знала, откуда человек пришёл.
 * Не трогает якоря этой страницы (#zapis), внешние адреса (t.me, youtube.com), картинки и PDF; якорь ссылки остаётся в конце.
 */
function carryTags() {
  const tags = pageTags();
  if (!Object.keys(tags).length) return;
  for (const link of document.querySelectorAll("a[href]")) {
    const raw = link.getAttribute("href");
    if (raw.startsWith("#") || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;
    const url = new URL(raw, document.baseURI);
    if (!url.pathname.endsWith(".html")) continue;
    for (const [key, value] of Object.entries(tags)) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    link.href = url.href;
  }
}

/** Подставляет имя страницы и метки из адреса в адрес окна Яндекс Формы и подгружает её скрипт. */
function embedForms() {
  const frames = document.querySelectorAll("iframe[data-form]");
  if (!frames.length) return;
  const page = document.documentElement.dataset.page || "";
  const tags = pageTags();
  for (const frame of frames) {
    const query = new URLSearchParams({ iframe: "1", page });
    for (const key of TAG_KEYS) if (tags[key]) query.set(key, tags[key]);
    frame.src = `https://forms.yandex.ru/u/${frame.dataset.form}/?${query}`;
  }
  const script = document.createElement("script");
  script.src = "https://forms.yandex.ru/_static/embed.js";
  document.body.append(script);
}

/**
 * Слой 1, «+1» без согласия: просмотр страницы, нажатие на ссылку с data-goal, показ окна формы.
 * С каждым событием уходят страница, событие, метки из адреса, домен, откуда пришли, и «телефон» или «компьютер».
 * Ничего не пишет и не читает в хранилище браузера, cookie нет. Выключен, пока в common.toml hit_url = "" (у <html> нет data-hit).
 */
function initHits() {
  const root = document.documentElement;
  const url = root.dataset.hit;
  if (!url || navigator.webdriver || !window.fetch) return;
  const tags = pageTags();
  let ref = "";
  try { ref = new URL(document.referrer).hostname.replace(/^www\./, ""); } catch {}
  if (ref && ref === location.hostname.replace(/^www\./, "")) ref = "self";
  const base = {
    page: root.dataset.page,
    utm_source: tags.utm_source || "",
    utm_content: tags.utm_content || "",
    ref: ref.slice(0, 60),
    screen: matchMedia("(min-width: 860px)").matches ? "desktop" : "phone",
  };
  const send = (event) => fetch(url, {
    method: "POST",
    body: JSON.stringify({ ...base, event }),
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
  send("view");
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-goal]");
    if (link) send(`click_${link.dataset.goal}`);
  });
  const frames = document.querySelectorAll("iframe[data-form]");
  if (frames.length) {
    const seen = new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      send("form_seen");
      observer.disconnect();
    });
    frames.forEach((frame) => seen.observe(frame));
  }
}

/**
 * Показывает баннер согласия, пока нет ответа; Метрика грузится только после «да».
 * Баннера нет в HTML, пока в common.toml metrika_id = 0: тогда функция ничего не делает.
 */
function consent() {
  const banner = document.querySelector(".consent");
  if (!banner) return;
  const id = Number(banner.dataset.metrika);
  let answer = null;
  try { answer = localStorage.getItem("consent"); } catch {}
  if (answer === "yes") return loadMetrika(id);
  if (answer === "no") return;
  banner.hidden = false;
  banner.addEventListener("click", (event) => {
    const value = event.target.dataset.consent;
    if (!value) return;
    try { localStorage.setItem("consent", value); } catch {}
    banner.hidden = true;
    if (value === "yes") loadMetrika(id);
  });
}

/**
 * Подключает счётчик и считает нажатия на ссылки с data-goal по имени страницы и меткам TAG_KEYS.
 * Вебвизор и карта кликов выключены (HANDOFF 8, «Счётчик»).
 * @param {number} id номер счётчика Метрики
 */
function loadMetrika(id) {
  window.ym = window.ym || function () { (ym.a = ym.a || []).push(arguments); };
  ym.l = Date.now();
  const script = document.createElement("script");
  script.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.append(script);
  ym(id, "init", { clickmap: false, trackLinks: true, webvisor: false });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-goal]");
    if (!link) return;
    const tags = pageTags();
    ym(id, "reachGoal", `click_${link.dataset.goal}`, {
      page: document.documentElement.dataset.page || "",
      utm_source: tags.utm_source || "",
      utm_content: tags.utm_content || "",
    });
  });
}

/**
 * Скриншоты переписки из отзыва открываются окном поверх страницы, а не новой вкладкой.
 * Закрывается кнопкой, Esc или кликом по фону; страница остаётся на месте, фокус возвращается на ссылку.
 * Без JS остаётся <details> со ссылками на картинки.
 */
function initProof() {
  const box = document.querySelector(".lightbox");
  if (!box?.showModal) return;
  const body = box.querySelector(".lightbox-body");
  let opener = null;
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".proof summary, .proof a");
    if (!trigger || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const shots = trigger.closest(".proof").querySelectorAll("img");
    body.replaceChildren(...[...shots].map((img) => Object.assign(img.cloneNode(), { loading: "eager" })));
    opener = trigger;
    box.showModal();
    body.scrollTop = 0;
  });
  box.addEventListener("click", (event) => {
    const r = box.getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside || event.target.closest(".lightbox-close")) box.close();
  });
  box.addEventListener("close", () => opener?.focus({ preventScroll: true }));
}

/**
 * Раскрывает свёрнутый блок #usloviya (<details>), если посетитель перешёл к нему по якорю #usloviya
 * при загрузке страницы, смене хеша или клике по ссылке на #usloviya.
 */
function initTermsAnchor() {
  const terms = document.getElementById("usloviya");
  if (!terms || terms.tagName !== "DETAILS") return;
  const openIfMatched = () => {
    if (location.hash === "#usloviya") terms.open = true;
  };
  openIfMatched();
  window.addEventListener("hashchange", openIfMatched);
  document.addEventListener("click", (event) => {
    if (event.target.closest('a[href="#usloviya"]')) terms.open = true;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  carryTags();
  initSticky();
  initMenu();
  embedForms();
  initHits();
  consent();
  initProof();
  initTermsAnchor();
});
