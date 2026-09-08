const app = document.getElementById("app");

const ui = {
  screen: "boot",
  tab: "week",
  lang: localStorage.getItem("swapshift-lang") || "cs",
  theme: localStorage.getItem("swapshift-theme") || "system",
  data: null,
  week: mondayOf(todayYmd()),
  month: `${todayYmd().slice(0, 7)}-01`,
  pickDate: "",
  day: todayYmd(),
  filterMine: false,
  sheet: null,
  error: "",
  toast: "",
  setupKind: "cafe",
  setupStep: "kind",
  setupRole: "",
  setupShopName: "",
  setupOwnerName: "",
  shopId: localStorage.getItem("swapshift-shop") || "",
  shops: [],
  pendingJoins: [],
  user: null,
  authMode: "login",
  claimEmail: "",
  remember: true,
  joinCode: "",
  addRoleElevated: false,
  hoursCapBusy: false,
  statsSel: null,
  statsView: null,
  dialog: null,
  manageTab: "shop",
  preview: true,
};

const COOKIE_CONSENT_KEY = "swapshift-cookie-consent";
const COOKIE_CONSENT_NAME = "swapshift_consent";

const KINDS = ["cafe", "retail", "gym", "clinic"];
const ROLES_BY_KIND = {
  cafe: { en: ["Barista", "Kitchen", "Floor", "Till"], cs: ["Barista", "Kuchyně", "Sál", "Pokladna"] },
  retail: { en: ["Floor", "Till", "Stock", "Fitting"], cs: ["Prodejna", "Pokladna", "Sklad", "Zkušebna"] },
  gym: { en: ["Coach", "Reception", "Floor"], cs: ["Trenér", "Recepce", "Sál"] },
  clinic: { en: ["Reception", "Nurse", "Therapist"], cs: ["Recepce", "Sestra", "Terapeut"] },
};
const KIND_I18N = { cafe: "kindCafe", retail: "kindRetail", gym: "kindGym", clinic: "kindClinic" };
const TIMES = [
  ["07:00", "15:00"],
  ["09:00", "17:00"],
  ["12:00", "20:00"],
];
const NAME_HINT = {
  cafe: { en: "Café Luka", cs: "Kavárna Luka" },
  retail: { en: "Shop Luka", cs: "Obchod Luka" },
  gym: { en: "Gym Luka", cs: "Fitko Luka" },
  clinic: { en: "Clinic Luka", cs: "Ordinace Luka" },
};

function t(key) {
  const pack = STR[ui.lang] || STR.en;
  return pack[key] ?? STR.en[key] ?? key;
}
function err(code) {
  const pack = STR[ui.lang] || STR.en;
  return pack.errors[code] || STR.en.errors[code] || code;
}
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayYmd() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}
function mondayOf(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const day = new Date(utc).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(utc + diff * 86400000).toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function clampResetDay(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(31, Math.max(1, Math.round(n)));
}
function dateOnDay(y, m, day) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(day, last);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function periodRange(resetDay, dateStr) {
  const D = clampResetDay(resetDay);
  const [y, m] = String(dateStr).split("-").map(Number);
  if (!y || !m) return null;
  const startThisMonth = dateOnDay(y, m, D);
  if (dateStr >= startThisMonth) {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return { from: startThisMonth, to: addDays(dateOnDay(nextY, nextM, D), -1) };
  }
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return { from: dateOnDay(prevY, prevM, D), to: addDays(startThisMonth, -1) };
}
function periodAfter(resetDay, toStr) {
  return periodRange(resetDay, addDays(toStr, 1));
}
function periodBefore(resetDay, fromStr) {
  return periodRange(resetDay, addDays(fromStr, -1));
}
function isStatsTab() {
  return ui.tab === "stats" || ui.tab === "hours";
}
function needsSignIn(p) {
  const me = ui.data?.me;
  return Boolean(p.email && !p.userId && !personIsOwner(p) && p.id !== me?.id);
}
function rosterPeople() {
  return (ui.data?.people || []).filter((p) => !p.leftAt);
}
function assignablePeople(selectedId) {
  return (ui.data?.people || []).filter((p) => !p.leftAt || p.id === selectedId);
}
function statsPayload() {
  return ui.statsView || ui.data?.stats;
}
function viewingCurrentPeriod() {
  const s = statsPayload();
  if (!s?.current) return true;
  return s.from === s.current.from && s.to === s.current.to;
}
function periodLabel(from, to) {
  const aDay = Number(String(from).slice(8));
  const aMon = Number(String(from).slice(5, 7));
  const bDay = Number(String(to).slice(8));
  const bMon = Number(String(to).slice(5, 7));
  const aYear = String(from).slice(0, 4);
  const bYear = String(to).slice(0, 4);
  if (ui.lang === "cs") {
    if (aYear !== bYear) return `${aDay}.${aMon}.${aYear} – ${bDay}.${bMon}.${bYear}`;
    return `${aDay}.${aMon}.–${bDay}.${bMon}.`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (aYear !== bYear) return `${aDay} ${months[aMon - 1]} ${aYear} – ${bDay} ${months[bMon - 1]} ${bYear}`;
  if (aMon === bMon) return `${aDay}–${bDay} ${months[aMon - 1]}`;
  return `${aDay} ${months[aMon - 1]} – ${bDay} ${months[bMon - 1]}`;
}
function monthStart(dateStr) {
  return `${String(dateStr).slice(0, 7)}-01`;
}
function monthEnd(dateStr) {
  const [y, m] = String(dateStr).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
function addMonths(dateStr, n) {
  const [y, m] = String(dateStr).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthStart(next.toISOString().slice(0, 10));
}
function isDesktop() {
  return window.matchMedia("(min-width: 900px)").matches;
}

function personById(id) {
  return ui.data?.people.find((p) => p.id === id);
}
function fmtHours(n) {
  const rounded = Math.round((n || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
function weekLabel(week) {
  const end = addDays(week, 6);
  const a = Number(week.slice(8));
  const b = Number(end.slice(8));
  const month = Number(week.slice(5, 7));
  if (ui.lang === "cs") return `${a}.–${b}. ${month}.`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${a}–${b} ${months[month - 1]}`;
}
function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  const cs = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
  const en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return ui.lang === "cs" ? `${cs[m - 1]} ${y}` : `${en[m - 1]} ${y}`;
}
function weekdayShort(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cs = ["ne", "po", "út", "st", "čt", "pá", "so"];
  return ui.lang === "cs" ? cs[weekday] : en[weekday];
}
function fullDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const csDays = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  const enDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const enMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (ui.lang === "cs") return `${csDays[weekday]} ${d}. ${m}. ${y}`;
  return `${enDays[weekday]} ${d} ${enMonths[m - 1]} ${y}`;
}
function dayName(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const csDays = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  const enDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const csMonths = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  const enMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (ui.lang === "cs") return `${csDays[weekday]} ${d}. ${csMonths[m - 1]}`;
  return `${enDays[weekday]} ${d} ${enMonths[m - 1]}`;
}
function shortName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}
function calendarRange() {
  if (!isDesktop()) return { from: ui.week, to: addDays(ui.week, 6) };
  const start = mondayOf(ui.month);
  const end = addDays(mondayOf(monthEnd(ui.month)), 6);
  return { from: start, to: end };
}
function fetchRange() {
  const visible = calendarRange();
  if (!isDesktop()) return { from: addDays(visible.from, -7), to: addDays(visible.to, 7) };
  return visible;
}

function canManage() {
  return Boolean(ui.data?.me?.canManage);
}
function rolesNow() {
  return (ui.data?.roles || []).map((r) => r.name);
}
function personIsOwner(p) {
  return Boolean(p?.isOwner || p?.is_owner);
}
function personRoles(p) {
  if (Array.isArray(p?.roles) && p.roles.length) return p.roles;
  return p?.role ? [p.role] : [];
}
function personHasRole(p, shiftRole) {
  const want = String(shiftRole ?? "").trim().toLowerCase();
  return personRoles(p).some((r) => r.trim().toLowerCase() === want);
}
function rolePills(p) {
  const roles = personRoles(p);
  if (!roles.length) return "";
  return `<span class="role-pills">${roles.map((r) => `<span class="person-role${roleGrantsAccess(r) ? " elevated" : ""}">${esc(r)}</span>`).join("")}</span>`;
}
function roleGrantsAccess(roleName) {
  return Boolean((ui.data?.roles || []).find((r) => r.name === roleName)?.elevated);
}
function personGrantsAccess(p) {
  return personRoles(p).some((name) => roleGrantsAccess(name));
}

function applyTheme(pref) {
  ui.theme = pref || ui.theme || "system";
  if (canStorePrefs()) localStorage.setItem("swapshift-theme", ui.theme);
  const dark =
    ui.theme === "dark" ||
    (ui.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.getElementById("themeColor");
  if (meta) meta.content = dark ? "#141311" : "#1f5c4d";
}

async function api(path, opts = {}) {
  const url = new URL(path, window.location.origin);
  if (ui.week) url.searchParams.set("week", isDesktop() ? mondayOf(todayYmd()) : ui.week);
  if (!url.searchParams.has("from") || !url.searchParams.has("to")) {
    const range = fetchRange();
    url.searchParams.set("from", range.from);
    url.searchParams.set("to", range.to);
  }
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(ui.shopId ? { "x-shop-id": ui.shopId } : {}),
      ...(opts.headers || {}),
    },
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "server"), { code: data.error || "server" });
  return data;
}

function setLang(lang) {
  ui.lang = lang === "en" ? "en" : "cs";
  if (canStorePrefs()) localStorage.setItem("swapshift-lang", ui.lang);
  document.documentElement.lang = ui.lang;
}

function showToast(message) {
  ui.toast = message;
  render();
  setTimeout(() => {
    ui.toast = "";
    render();
  }, 2800);
}

async function flushNotices(payload) {
  const notices = payload?.notices || [];
  if (!notices.length) return;
  const ids = notices.map((n) => n.id).filter(Boolean);
  if (ids.length) {
    try {
      await api("/api/notices/ack", { method: "POST", body: { ids } });
    } catch {
      /* still toast */
    }
  }
  const kicked = notices.filter((n) => n.kind === "kicked");
  if (!kicked.length) return;
  const names = [...new Set(kicked.map((n) => n.shopName).filter(Boolean))];
  const msg = names.length
    ? t("kickedFrom").replace("SHOP", names.join(", "))
    : t("kickedOut");
  showToast(msg);
}

function rememberAuth(data) {
  ui.user = data.user || ui.user;
  ui.shops = data.shops || [];
  ui.pendingJoins = data.pendingJoins || [];
  if (data.shop?.id) {
    ui.shopId = data.shop.id;
    if (canStorePrefs()) localStorage.setItem("swapshift-shop", ui.shopId);
  }
}

function consentMode() {
  let raw = "";
  try {
    raw = localStorage.getItem(COOKIE_CONSENT_KEY) || "";
  } catch {
    /* private mode */
  }
  if (raw === "accepted") raw = "all";
  if (raw === "all" || raw === "necessary" || raw === "declined") return raw;
  const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_CONSENT_NAME}=`));
  if (!part) return "";
  let value = part.slice(COOKIE_CONSENT_NAME.length + 1);
  if (value === "1" || value === "accepted") value = "all";
  if (value === "all" || value === "necessary" || value === "declined") return value;
  return "";
}

function cookiesDecided() {
  return Boolean(consentMode());
}

function canStorePrefs() {
  const mode = consentMode();
  return mode === "" || mode === "all";
}

function canRememberLogin() {
  const mode = consentMode();
  return mode === "" || mode === "all";
}

function allowsSessionCookie() {
  return consentMode() !== "declined";
}

function writeConsentCookie(mode) {
  if (mode === "declined") {
    document.cookie = `${COOKIE_CONSENT_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
    return;
  }
  document.cookie = `${COOKIE_CONSENT_NAME}=${mode}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function setConsent(mode) {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, mode);
  } catch {
    /* private mode */
  }
  writeConsentCookie(mode);
  if (mode !== "all") ui.remember = false;
}

function cookieBanner() {
  if (ui.preview || cookiesDecided()) return "";
  return `<aside class="cookie-bar" role="region" aria-label="${esc(t("cookiesTitle"))}">
    <div class="cookie-card">
      <div class="cookie-copy">
        <p class="kicker">${esc(t("app"))}</p>
        <h2>${esc(t("cookiesTitle"))}</h2>
        <p class="lede">${esc(t("cookiesBody"))}</p>
      </div>
      <div class="cookie-actions">
        <button class="commit" type="button" data-act="cookies" data-mode="all">${esc(t("cookiesAccept"))}</button>
        <button class="ghost" type="button" data-act="cookies" data-mode="necessary">${esc(t("cookiesNecessary"))}</button>
        <button class="text-btn" type="button" data-act="cookies" data-mode="declined">${esc(t("cookiesDecline"))}</button>
      </div>
    </div>
  </aside>`;
}

function previewBanner() {
  if (!ui.preview) return "";
  return `<aside class="preview-banner">${esc(t("previewBanner"))}</aside>`;
}

async function boot() {
  applyTheme(ui.theme);
  try {
    const boot = await api("/api/bootstrap");
    ui.preview = Boolean(boot.preview);
    setLang(localStorage.getItem("swapshift-lang") || boot.lang || "cs");
    if (!boot.user) {
      ui.screen = "login";
      render();
      return;
    }
    rememberAuth(boot);
    await flushNotices(boot);
    const preferred = boot.shopId || ui.shopId;
    if (preferred && ui.shops.some((s) => s.id === preferred)) {
      ui.shopId = preferred;
      if (canStorePrefs()) localStorage.setItem("swapshift-shop", ui.shopId);
      await loadWeek();
      return;
    }
    ui.screen = "picker";
    render();
  } catch {
    ui.screen = "login";
    render();
  }
}

async function loadWeek() {
  const data = await fetchShopState();
  if (!data) return;
  ui.data = data;
  setLang(localStorage.getItem("swapshift-lang") || ui.data.shop.lang);
  if (!localStorage.getItem("swapshift-theme") && ui.data.shop.theme) applyTheme(ui.data.shop.theme);
  ui.screen = "app";
  if (isDesktop() && ui.tab === "settings") ui.tab = "week";
  if (!canManage() && (ui.tab === "queue" || ui.tab === "manage" || ui.tab === "people")) {
    ui.tab = ui.tab === "people" ? "stats" : "week";
  }
  if (ui.tab === "hours") ui.tab = "stats";
  await refreshStatsView(data);
  render();
}

let stateGen = 0;
let liveEs = null;
let livePoll = null;
let pickerPoll = null;
let liveShopId = "";
let liveRev = -1;
let liveBusy = false;
let liveQueued = false;

function stopLive() {
  liveEs?.close();
  liveEs = null;
  liveShopId = "";
  clearInterval(livePoll);
  livePoll = null;
}

function stopPickerLive() {
  clearInterval(pickerPoll);
  pickerPoll = null;
}

function fetchShopState() {
  const gen = ++stateGen;
  const hoursWeek = isDesktop() ? mondayOf(todayYmd()) : ui.week;
  const range = fetchRange();
  return api(`/api/state?week=${hoursWeek}&from=${range.from}&to=${range.to}`).then((data) => {
    if (gen !== stateGen) return null;
    return data;
  });
}

async function refreshStatsView(data) {
  if (isStatsTab() && ui.statsSel) {
    ui.statsView = await api(`/api/stats?from=${ui.statsSel.from}&to=${ui.statsSel.to}`);
  } else if (!ui.statsSel) {
    ui.statsView = data?.stats;
  }
}

function typingInField() {
  const el = document.activeElement;
  return Boolean(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function shouldSkipLiveRender() {
  if (ui.hoursCapBusy || Date.now() < liveHoldUntil) return true;
  if (ui.dialog || ui.sheet) return true;
  return typingInField();
}

function isGoneFromShop(error) {
  return error?.code === "no_shop" || error?.code === "unauthorized";
}

async function bounceFromShop(error) {
  stopLive();
  ui.shopId = "";
  ui.data = null;
  ui.sheet = null;
  ui.dialog = null;
  try {
    localStorage.removeItem("swapshift-shop");
  } catch {
    /* private mode */
  }
  if (error?.code === "unauthorized") {
    ui.user = null;
    ui.shops = [];
    ui.pendingJoins = [];
    ui.screen = "login";
    render();
    return;
  }
  try {
    const boot = await api("/api/bootstrap");
    rememberAuth(boot);
    ui.screen = "picker";
    render();
    await flushNotices(boot);
  } catch {
    /* still leave the shop */
    ui.screen = "picker";
    render();
    showToast(t("kickedOut"));
  }
}

function ensureLive() {
  if (ui.screen === "picker") {
    stopLive();
    ensurePickerLive();
    return;
  }
  stopPickerLive();
  if (ui.screen !== "app" || !ui.shopId) {
    stopLive();
    return;
  }
  if (liveEs && liveShopId === ui.shopId) return;
  stopLive();
  liveShopId = ui.shopId;
  liveRev = -1;
  const src = `/api/events?shop=${encodeURIComponent(ui.shopId)}`;
  liveEs = new EventSource(src);
  liveEs.onmessage = () => {
    liveRefresh();
  };
  livePoll = setInterval(() => {
    if (liveEs?.readyState === EventSource.OPEN) return;
    liveRefresh();
  }, 4000);
}

function ensurePickerLive() {
  if (ui.screen !== "picker" || !(ui.pendingJoins || []).length) {
    stopPickerLive();
    return;
  }
  if (pickerPoll) return;
  pickerPoll = setInterval(async () => {
    if (ui.screen !== "picker" || !(ui.pendingJoins || []).length) {
      stopPickerLive();
      return;
    }
    try {
      const boot = await api("/api/bootstrap");
      rememberAuth(boot);
      render();
      await flushNotices(boot);
    } catch {
      /* keep last picker */
    }
  }, 4000);
}

async function liveRefresh() {
  if (ui.screen !== "app" || !ui.shopId) return;
  if (liveBusy) {
    liveQueued = true;
    return;
  }
  liveBusy = true;
  try {
    do {
      liveQueued = false;
      const tick = await api("/api/tick");
      if (liveRev < 0) {
        liveRev = tick.revision;
        continue;
      }
      if (tick.revision === liveRev) continue;
      liveRev = tick.revision;
      const prevPending = ui.data?.pendingCount ?? 0;
      const data = await fetchShopState();
      if (!data) continue;
      ui.data = data;
      await refreshStatsView(data);
      const lost = dropManageAccess();
      if (lost) {
        showToast(t("noPermission"));
        continue;
      }
      if (shouldSkipLiveRender()) continue;
      render();
      if (canManage() && data.pendingCount > prevPending) showToast(t("newRequest"));
    } while (liveQueued);
  } catch (error) {
    if (isGoneFromShop(error)) await bounceFromShop(error);
  } finally {
    liveBusy = false;
  }
}

function dropManageAccess() {
  if (canManage()) return false;
  const manageSheet =
    ui.sheet?.type === "person" ||
    ui.sheet?.type === "add-shift" ||
    ui.sheet?.type === "copy-day" ||
    (ui.sheet?.type === "shift" && ui.sheet.mode === "edit");
  const manageTab = ui.tab === "manage" || ui.tab === "queue" || ui.tab === "people";
  if (!manageSheet && !manageTab && !ui.dialog) return false;
  if (ui.tab === "people") ui.tab = "stats";
  else if (ui.tab === "queue" || ui.tab === "manage") ui.tab = "week";
  if (ui.sheet?.type === "shift" && ui.sheet.mode === "edit") ui.sheet = { ...ui.sheet, mode: "view" };
  else if (ui.sheet?.type === "person" || ui.sheet?.type === "add-shift" || ui.sheet?.type === "copy-day") {
    ui.sheet = null;
  }
  if (ui.dialog) {
    const resolve = ui.dialog.resolve;
    ui.dialog = null;
    resolve?.(false);
  }
  return true;
}

function langToggle() {
  return `<div class="lang-toggle">
    <button type="button" data-act="lang" data-lang="cs" class="${ui.lang === "cs" ? "on" : ""}">CS</button>
    <button type="button" data-act="lang" data-lang="en" class="${ui.lang === "en" ? "on" : ""}">EN</button>
  </div>`;
}
function themeToggle() {
  return `<div class="theme-toggle">
    <button type="button" data-act="theme" data-theme="system" class="${ui.theme === "system" ? "on" : ""}">${esc(t("themeSystem"))}</button>
    <button type="button" data-act="theme" data-theme="light" class="${ui.theme === "light" ? "on" : ""}">${esc(t("themeLight"))}</button>
    <button type="button" data-act="theme" data-theme="dark" class="${ui.theme === "dark" ? "on" : ""}">${esc(t("themeDark"))}</button>
  </div>`;
}
function kindChips(selected, act = "setup-kind") {
  return `<div class="chips">${KINDS.map((k) => `<button type="button" data-act="${act}" data-kind="${k}" class="${selected === k ? "on" : ""}">${esc(t(KIND_I18N[k]))}</button>`).join("")}</div>`;
}
function rolesForKind(kind, lang = ui.lang) {
  const pack = ROLES_BY_KIND[kind] || ROLES_BY_KIND.cafe;
  return pack[lang] || pack.en;
}
function selectedSetupRole() {
  const roles = rolesForKind(ui.setupKind);
  return roles.includes(ui.setupRole) ? ui.setupRole : roles[0];
}
function setupRoleChips() {
  const roles = rolesForKind(ui.setupKind);
  const selected = selectedSetupRole();
  return `<div class="chips">${roles.map((r) => `<button type="button" data-act="setup-role" data-role="${esc(r)}" class="${r === selected ? "on" : ""}">${esc(r)}</button>`).join("")}</div>
    <input type="hidden" name="role" value="${esc(selected)}" />`;
}
function kindCards(selected) {
  return `<div class="who-list">${KINDS.map((k) => {
    const roles = rolesForKind(k).join(" · ");
    return `<button type="button" class="who-btn${selected === k ? " on" : ""}" data-act="setup-kind" data-kind="${k}">
      <b>${esc(t(KIND_I18N[k]))}</b>
      <span class="role-preview">${esc(roles)}</span>
    </button>`;
  }).join("")}</div>`;
}
function readSetupDraft() {
  const form = document.querySelector("[data-form=setup]");
  if (!form) return;
  const data = formData(form);
  ui.setupShopName = data.shopName || "";
  ui.setupOwnerName = data.ownerName || "";
  if (data.role) ui.setupRole = data.role;
}
function roleChips(selected) {
  const roles = rolesNow();
  if (!roles.length) return "";
  return `<div class="chips">${roles.map((r) => `<button type="button" data-act="preset-role" data-role="${esc(r)}" class="${selected === r ? "on" : ""}">${esc(r)}</button>`).join("")}</div>`;
}
function personRoleChips(selected) {
  const picked = Array.isArray(selected) ? selected : selected ? [selected] : [];
  const catalog = rolesNow();
  const extra = picked.filter((r) => !catalog.some((c) => c.toLowerCase() === r.toLowerCase()));
  const roles = [...catalog, ...extra];
  return `<div class="chips">${roles.map((r) => `<button type="button" data-act="toggle-person-role" data-role="${esc(r)}" class="${picked.some((p) => p.toLowerCase() === r.toLowerCase()) ? "on" : ""}">${esc(r)}</button>`).join("")}</div>
    <input type="hidden" name="roles" value="${esc(picked.join("|"))}" />`;
}

function addPersonRoleChip(form, name) {
  let hidden = form.querySelector('input[name="roles"]');
  if (!hidden) {
    hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = "roles";
    form.prepend(hidden);
  }
  const current = String(hidden.value || "").split("|").filter(Boolean);
  if (!current.some((r) => r.toLowerCase() === name.toLowerCase())) {
    hidden.value = [...current, name].join("|");
  }
  let chips = form.querySelector(".chips");
  if (!chips) {
    chips = document.createElement("div");
    chips.className = "chips";
    const createRow = form.querySelector(".role-create");
    form.insertBefore(chips, createRow || form.firstChild);
  }
  let btn = [...chips.querySelectorAll("[data-role]")].find((el) => el.dataset.role.toLowerCase() === name.toLowerCase());
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.act = "toggle-person-role";
    btn.dataset.role = name;
    btn.textContent = name;
    chips.appendChild(btn);
  }
  btn.classList.add("on");
}

function hoursCapOn() {
  const cap = ui.data?.shop?.hoursCap;
  if (cap == null) return true;
  return Boolean(Number(cap));
}

function shopTypeLabel(shop = ui.data?.shop) {
  if (!shop) return "";
  const cat = (ui.data?.categories || []).find((c) => c.id === shop.categoryId);
  if (cat?.name) return cat.name;
  return t(KIND_I18N[shop.kind] || "kindCafe");
}

function toggleControl(on, act, label, attrs = "") {
  return `<button type="button" class="toggle${on ? " on" : ""}" data-act="${esc(act)}" aria-pressed="${on ? "true" : "false"}" ${attrs}>${esc(label)}</button>`;
}

function paintToggle(btn, on) {
  if (!btn) return;
  btn.classList.toggle("on", Boolean(on));
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function accessBadge() {
  return `<span class="tag">${esc(t("accessBadge"))}</span>`;
}

let liveHoldUntil = 0;
function holdLive(ms = 1800) {
  liveHoldUntil = Date.now() + ms;
}

function shopSwitchBar() {
  return "";
}

function joinCodeCard() {
  const code = ui.data.shop.joinCode || "";
  if (!canManage() || !code) return "";
  return `<section class="card join-code-card">
    <h2>${esc(t("joinCode"))}</h2>
    <p class="lede join-code">${esc(code)}</p>
    <p class="lede">${esc(t("joinCodeHint"))}</p>
    <div class="row-2">
      <button type="button" class="ghost" data-act="copy-code">${esc(t("copyCode"))}</button>
      <button type="button" class="ghost" data-act="new-code">${esc(t("newCode"))}</button>
    </div>
  </section>`;
}

function viewWelcome() {
  return `<main class="page">
    <div class="toolbar">
      <div>
        <p class="kicker">${esc(t("app"))}</p>
        <h1>${esc(t("welcomeTitle"))}</h1>
      </div>
      ${langToggle()}
    </div>
    <p class="lede">${esc(t("welcomeHint"))}</p>
    <p class="lede">${esc(t("kindLabel"))}</p>
    ${kindCards(ui.setupKind)}
    <div class="form">
      <button class="commit" type="button" data-act="setup-next">${esc(t("continue"))}</button>
    </div>
  </main>`;
}

function viewSetup() {
  if (ui.setupStep !== "details") return viewWelcome();
  return `<main class="page">
    <button class="text-btn" data-act="setup-back">${esc(t("back"))}</button>
    <p class="kicker">${esc(t(KIND_I18N[ui.setupKind]))}</p>
    <h1>${esc(t("setupTitle"))}</h1>
    <p class="lede">${esc(t("setupHint"))}</p>
    <form class="form" data-form="setup">
      ${ui.error ? `<p class="error">${esc(ui.error === "pinMismatch" ? t("pinMismatch") : err(ui.error))}</p>` : ""}
      <label><span>${esc(t("shopName"))}</span><input name="shopName" required maxlength="60" value="${esc(ui.setupShopName)}" placeholder="${esc((NAME_HINT[ui.setupKind] || NAME_HINT.cafe)[ui.lang])}" /></label>
      <label><span>${esc(t("yourName"))}</span><input name="ownerName" required maxlength="40" value="${esc(ui.setupOwnerName || ui.user?.name || "")}" /></label>
      <span class="lede-label">${esc(t("yourRole"))}</span>
      <p class="lede">${esc(t("roleHint"))}</p>
      ${setupRoleChips()}
      <button class="commit" type="submit">${esc(t("createShop"))}</button>
    </form>
  </main>`;
}

function viewLogin() {
  const signup = ui.authMode === "signup";
  const invite = ui.authMode === "invite";
  const claim = ui.authMode === "claim";
  const title = claim || invite ? t("ownerAddedTitle") : signup ? t("signUp") : t("signIn");
  const lede = claim
    ? t("ownerAddedPasswordHint")
    : invite
      ? t("ownerAddedHint")
      : signup
        ? t("signupHint")
        : "";
  const doors = [
    signup || invite || claim ? `<button class="text-btn" data-act="auth-mode" data-mode="login">${esc(t("haveAccount"))}</button>` : "",
    !signup ? `<button class="text-btn" data-act="auth-mode" data-mode="signup">${esc(t("needAccount"))}</button>` : "",
    !invite && !claim ? `<button class="text-btn" data-act="auth-mode" data-mode="invite">${esc(t("ownerAddedYou"))}</button>` : "",
  ].filter(Boolean).join("");
  return `<main class="page">
    <div class="toolbar">
      <div><p class="kicker">${esc(t("app"))}</p><h1>${esc(title)}</h1></div>
      ${langToggle()}
    </div>
    ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
    ${ui.error ? `<p class="error">${esc(t(ui.error) === ui.error ? err(ui.error) : t(ui.error))}</p>` : ""}
    <form class="form" data-form="${claim ? "claim" : invite ? "invite-check" : signup ? "signup" : "login"}">
      ${signup ? `<label><span>${esc(t("fullName"))}</span><input name="name" required minlength="3" maxlength="80" autocomplete="name" placeholder="${esc(t("fullNameHint"))}" /></label>` : ""}
      ${claim
        ? `<input type="hidden" name="email" value="${esc(ui.claimEmail)}" /><p class="lede">${esc(ui.claimEmail)}</p>`
        : `<label><span>${esc(t("email"))}</span><input name="email" type="email" inputmode="email" required autocomplete="username" value="${esc(invite || signup ? ui.claimEmail : "")}" /></label>`}
      ${invite ? "" : `<label><span>${esc(t("password"))}</span><input name="password" type="password" required minlength="6" autocomplete="${signup || claim ? "new-password" : "current-password"}" /></label>`}
      ${signup || claim ? `<label><span>${esc(t("passwordAgain"))}</span><input name="password2" type="password" required minlength="6" autocomplete="new-password" /></label>` : ""}
      ${!invite && canRememberLogin() ? `<label class="check"><input type="checkbox" name="remember" ${ui.remember ? "checked" : ""} /> ${esc(t("rememberMe"))}</label>` : ""}
      <button class="commit" type="submit">${esc(claim ? t("setPassword") : invite ? t("continueEmail") : signup ? t("signUp") : t("signIn"))}</button>
    </form>
    <div class="auth-doors">${doors}</div>
  </main>`;
}

function viewPicker() {
  const shops = ui.shops || [];
  const waiting = ui.pendingJoins || [];
  return `<main class="page">
    <div class="toolbar">
      <div><p class="kicker">${esc(ui.user?.email || t("app"))}</p><h1>${esc(t("pickShop"))}</h1></div>
      ${langToggle()}
    </div>
    ${ui.error ? `<p class="error">${esc(err(ui.error))}</p>` : ""}
    ${shops.length ? `<div class="who-list">${shops.map((s) => `<button class="who-btn" data-act="open-shop" data-id="${esc(s.id)}">
      <b>${esc(s.name)}</b>
      <span class="role-preview">${esc(t(KIND_I18N[s.kind] || "kindCafe"))}${s.isOwner || s.role ? ` · ${esc(s.isOwner ? t("owner") : s.role)}` : ""}</span>
    </button>`).join("")}</div>` : `<p class="lede">${esc(t("noShopsYet"))}</p>`}
    ${waiting.length ? `<p class="lede">${esc(t("joinWaiting"))}</p><div class="who-list">${waiting.map((j) => `<div class="who-btn"><b>${esc(j.shopName)}</b><span class="role-preview">${esc(t("pending"))}</span></div>`).join("")}</div>` : ""}
    <form class="form" data-form="join">
      <label><span>${esc(t("enterCode"))}</span><input name="code" required maxlength="8" placeholder="${esc(t("joinCode"))}" style="text-transform:uppercase" /></label>
      <button class="ghost" type="submit">${esc(t("joinShop"))}</button>
    </form>
    <div class="form">
      <button class="commit" type="button" data-act="create-shop">${esc(t("createAnother"))}</button>
      ${ui.preview ? "" : `<button class="text-btn" data-act="logout">${esc(t("logout"))}</button>`}
    </div>
  </main>`;
}

function isMine(s) {
  return s.personId === ui.data?.me?.id;
}
function isWeekend(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 || weekday === 6;
}
function selectedDay() {
  const today = todayYmd();
  if (ui.day && ui.day.slice(0, 7) === ui.month.slice(0, 7)) return ui.day;
  if (today.slice(0, 7) === ui.month.slice(0, 7)) return today;
  return ui.month;
}
function shiftClasses(s) {
  return [
    !s.personId ? "is-open" : "",
    isMine(s) ? "is-mine" : "",
    s.offered ? "is-offered" : "",
  ].filter(Boolean).join(" ");
}
function nearbyDays(dateStr) {
  const first = mondayOf(dateStr);
  return Array.from({ length: 14 }, (_, i) => addDays(first, i));
}
function copyDayChips(sourceDate) {
  return `<div class="copy-days">
    <p class="lede">${esc(t("copyTo"))}</p>
    <div class="copy-chips">${nearbyDays(sourceDate).map((d) => {
      if (d === sourceDate) {
        return `<span class="day-check source"><span>${esc(weekdayShort(d))} ${Number(d.slice(8))}.</span></span>`;
      }
      return `<label class="day-check"><input type="checkbox" name="copyDates" value="${esc(d)}" /><span>${esc(weekdayShort(d))} ${Number(d.slice(8))}.</span></label>`;
    }).join("")}</div>
  </div>`;
}

function hoursBar() {
  if (!ui.data?.me || !hoursCapOn()) return "";
  const used = ui.data.hours[ui.data.me.id] || 0;
  return `<div class="hours-line"><span>${esc(t("hoursWeek"))}</span><b>${fmtHours(used)} ${esc(t("h"))} ${esc(t("ofCap"))} ${fmtHours(ui.data.me.maxHours)}</b></div>`;
}

function shiftCard(s) {
  const who = personById(s.personId);
  const mine = isMine(s);
  return `<button class="shift ${shiftClasses(s)}" data-act="open-shift" data-id="${esc(s.id)}">
    <span class="when">${esc(s.start)}–${esc(s.end)}</span>
    <span class="shift-flags">
      ${mine ? `<span class="badge mine-tag">${esc(t("you"))}</span>` : ""}
      ${s.offered ? `<span class="badge">${esc(t("offered"))}</span>` : ""}
    </span>
    <span class="who">${esc(who?.name || t("openSlot"))}</span>
    <span class="job">${esc(s.role)}</span>
  </button>`;
}

function monthChip(s) {
  const who = personById(s.personId);
  return `<button class="m-shift ${shiftClasses(s)}" data-act="open-shift" data-id="${esc(s.id)}" title="${esc(`${s.start}–${s.end} ${s.role} · ${who?.name || ""}`)}">
    <span class="m-time">${esc(s.start.slice(0, 5))}</span>
    <span class="m-who">${esc(shortName(who?.name) || t("openSlot"))}</span>
  </button>`;
}

function calLegend() {
  return `<div class="cal-legend">
    <span class="lg lg-mine">${esc(t("you"))}</span>
    <span class="lg lg-open">${esc(t("openSlot"))}</span>
    <span class="lg lg-offer">${esc(t("offered"))}</span>
    <span class="lg lg-other">${esc(t("others"))}</span>
    <button type="button" class="filter-mine ${ui.filterMine ? "on" : ""}" data-act="filter-mine" aria-pressed="${ui.filterMine ? "true" : "false"}">${esc(t("onlyMine"))}</button>
  </div>`;
}

function viewWeek() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(ui.week, i));
  const shifts = ui.data.shifts || [];
  const emptyPeople = rosterPeople().length < 2;
  const empty = !days.some((date) => shifts.some((s) => s.date === date));
  const today = todayYmd();
  const grid = `<div class="week-grid">${days.map((date) => {
    let items = shifts.filter((s) => s.date === date);
    if (ui.filterMine) items = items.filter(isMine);
    return `<section class="day-col${date === today ? " is-today" : ""}"><h2>${esc(dayName(date))}</h2>${items.map(shiftCard).join("")}${canManage() ? `<button class="day-add" data-act="add-on-date" data-date="${esc(date)}">+</button>` : ""}</section>`;
  }).join("")}</div>`;

  return `<main class="page wide">
    <div class="toolbar">
      <div>
        ${shopSwitchBar()}
        <div class="week-nav">
          <button class="icon-btn" data-act="week" data-dir="-1" aria-label="prev">‹</button>
          <h1>${esc(weekLabel(ui.week))}</h1>
          <button class="icon-btn" data-act="week" data-dir="1" aria-label="next">›</button>
        </div>
      </div>
      <div class="toolbar-actions">
        <button class="ghost" data-act="today">${esc(t("today"))}</button>
        ${canManage() ? `<button class="primary" data-act="add-shift">${esc(t("addShift"))}</button>` : ""}
        ${canManage() && empty && !emptyPeople ? `<button class="ghost" data-act="demo">${esc(t("loadDemo"))}</button>` : ""}
      </div>
    </div>
    ${hoursBar()}
    ${calLegend()}
    ${empty ? `<div class="empty"><p>${esc(emptyPeople && canManage() ? t("emptyPeople") : t("emptyShifts"))}</p>
      ${canManage() && emptyPeople ? `<div class="actions"><button class="primary" data-act="tab" data-tab="people">${esc(t("addPerson"))}</button></div>` : ""}
    </div>` : grid}
  </main>`;
}

function viewDayPanel(date) {
  let items = (ui.data.shifts || []).filter((s) => s.date === date);
  if (ui.filterMine) items = items.filter(isMine);
  const today = date === todayYmd();
  return `<aside class="day-panel">
    <header class="day-panel-head">
      <p class="kicker">${esc(weekdayShort(date))}${today ? ` · ${esc(t("today"))}` : ""}</p>
      <h2>${esc(fullDate(date))}</h2>
    </header>
    ${items.length ? items.map(shiftCard).join("") : `<div class="empty"><p>${esc(t("noShiftsDay"))}</p></div>`}
    ${canManage() ? `<div class="day-panel-actions">
      <button class="primary" data-act="add-on-date" data-date="${esc(date)}">${esc(t("addShift"))}</button>
      ${items.length ? `<button class="ghost" data-act="copy-day" data-date="${esc(date)}">${esc(t("copyDay"))}</button>` : ""}
    </div>` : ""}
  </aside>`;
}

function viewMonth() {
  const shifts = ui.data.shifts || [];
  const emptyPeople = rosterPeople().length < 2;
  const ym = ui.month.slice(0, 7);
  const inMonth = shifts.filter((s) => s.date.slice(0, 7) === ym);
  const empty = inMonth.length === 0;
  const today = todayYmd();
  const day = selectedDay();
  ui.day = day;
  const start = mondayOf(ui.month);
  const end = addDays(mondayOf(monthEnd(ui.month)), 6);
  const heads = Array.from({ length: 7 }, (_, i) => `<div class="month-head">${esc(weekdayShort(addDays(start, i)))}</div>`).join("");
  const cells = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    let items = shifts.filter((s) => s.date === date);
    const mineCount = items.filter(isMine).length;
    if (ui.filterMine) items = items.filter(isMine);
    const shown = items.slice(0, 3);
    const rest = items.length - shown.length;
    const out = date.slice(0, 7) === ym ? "" : " is-out";
    const cls = [
      "month-cell",
      out,
      date === today ? " is-today" : "",
      date === day ? " is-on" : "",
      mineCount ? " has-mine" : "",
      isWeekend(date) ? " is-weekend" : "",
    ].join("");
    cells.push(`<section class="${cls}" data-act="pick-day" data-date="${esc(date)}">
      <div class="month-top">
        <span class="month-num">${Number(date.slice(8))}</span>
        ${mineCount ? `<span class="mine-dot" title="${esc(t("you"))}"></span>` : ""}
      </div>
      <div class="month-shifts">${shown.map(monthChip).join("")}</div>
      ${rest > 0 ? `<span class="m-more">+${rest}</span>` : ""}
    </section>`);
  }

  return `<main class="page wide">
    <div class="toolbar">
      <div>
        ${shopSwitchBar()}
        <div class="week-nav">
          <button class="icon-btn" data-act="month" data-dir="-1" aria-label="prev">‹</button>
          <h1>${esc(monthLabel(ui.month))}</h1>
          <button class="icon-btn" data-act="month" data-dir="1" aria-label="next">›</button>
        </div>
      </div>
      <div class="toolbar-actions">
        <button class="ghost" data-act="today">${esc(t("today"))}</button>
        ${canManage() ? `<button class="primary" data-act="add-shift">${esc(t("addShift"))}</button>` : ""}
        ${canManage() && empty && !emptyPeople ? `<button class="ghost" data-act="demo">${esc(t("loadDemo"))}</button>` : ""}
      </div>
    </div>
    ${hoursBar()}
    ${calLegend()}
    ${empty && emptyPeople && canManage() ? `<div class="empty"><p>${esc(t("emptyPeople"))}</p>
      <div class="actions"><button class="primary" data-act="tab" data-tab="people">${esc(t("addPerson"))}</button></div>
    </div>` : ""}
    <div class="cal-layout">
      <div class="month-cal">${heads}${cells.join("")}</div>
      ${viewDayPanel(day)}
    </div>
  </main>`;
}

function viewQueue() {
  const pending = ui.data.pending || [];
  const joins = ui.data.joinRequests || [];
  const head = `<div class="page-head"><p class="kicker">${esc(t("needsYou"))}</p><h1>${esc(t("queue"))}</h1></div>`;
  if (!pending.length && !joins.length) {
    return `<main class="page wide">${head}<div class="empty"><p>${esc(t("emptyQueue"))}</p></div></main>`;
  }
  const joinCards = joins.map((jr) => `<article class="queue-card">
    <h3>${esc(jr.name)} ${esc(t("wantsJoin"))}</h3>
    <p>${esc(jr.email)}</p>
    <div class="row-2">
      <button class="primary" data-act="approve-join" data-id="${esc(jr.id)}">${esc(t("approve"))}</button>
      <button class="danger" data-act="reject-join" data-id="${esc(jr.id)}">${esc(t("reject"))}</button>
    </div>
  </article>`).join("");
  const swapCards = pending.map((sw) => {
      const sh = sw.shift;
      const offerer = personById(sw.offeredBy);
      const claimer = personById(sw.claimedBy);
      const label = sh ? `${sh.date} ${sh.start}–${sh.end} ${sh.role}` : t("shift");
      const h3 = !sh?.personId
        ? `${esc(claimer?.name || "")} ${esc(t("wantsOpen"))}`
        : `${esc(claimer?.name || "")} ${esc(t("swapWith"))} ${esc(offerer?.name || "")}`;
      return `<article class="queue-card">
        <h3>${h3}</h3>
        <p>${esc(label)}</p>
        ${sw.reason ? `<p class="note">${esc(t("reason"))}: ${esc(sw.reason)}</p>` : ""}
        ${sw.offerReason ? `<p class="meta">${esc(t("offered"))}: ${esc(sw.offerReason)}</p>` : ""}
        <div class="row-2">
          <button class="primary" data-act="approve" data-id="${esc(sw.id)}">${esc(t("approve"))}</button>
          <button class="danger" data-act="reject" data-id="${esc(sw.id)}">${esc(t("reject"))}</button>
        </div>
      </article>`;
    }).join("");
  return `<main class="page wide">
    ${head}
    ${joinCards}${swapCards}
  </main>`;
}

function hoursBoard(hours) {
  const map = hours || {};
  const rows = (ui.data.people || [])
    .filter((p) => !p.leftAt || (map[p.id] || 0) > 0)
    .map((p) => ({ p, n: map[p.id] || 0 }))
    .sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name));
  if (!rows.length || !rows.some((r) => r.n)) return `<p class="lede">${esc(t("emptyStats"))}</p>`;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return `<ol class="hours-board">${rows.map((r, i) => `<li>
    <span class="hours-rank">${i + 1}</span>
    <div class="hours-bar-copy">
      <b>${esc(r.p.name)}</b>
      <span class="hours-track"><i style="width:${((r.n / max) * 100).toFixed(1)}%"></i></span>
    </div>
    <span class="person-hours">${fmtHours(r.n)} ${esc(t("h"))}</span>
  </li>`).join("")}</ol>`;
}

function periodHours(row) {
  return Number(row?.total ?? row?.hours ?? 0);
}

function shortPeriod(ymd) {
  if (!ymd) return "";
  const day = Number(String(ymd).slice(8));
  const mon = Number(String(ymd).slice(5, 7));
  if (ui.lang === "cs") return `${day}.${mon}.`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[mon - 1]} ${day}`;
}

function trendGraph(history) {
  const rows = history || [];
  if (!rows.length) return `<p class="lede">${esc(t("emptyStats"))}</p>`;
  const max = Math.max(1, ...rows.map(periodHours));
  return `<div class="hours-history">${rows.map((r) => `<div class="hours-hist-col">
    <span class="hours-track vert"><i style="height:${((periodHours(r) / max) * 100).toFixed(1)}%"></i></span>
    <span>${fmtHours(periodHours(r))}</span>
    <span class="hours-hist-date">${esc(shortPeriod(r.from))}</span>
  </div>`).join("")}</div>`;
}

function kpiCard(label, value, extra = "") {
  return `<section class="card kpi-card">
    <p class="kicker">${esc(label)}</p>
    <p class="kpi-value">${esc(value)}</p>
    ${extra}
  </section>`;
}

function managerKpis(s) {
  const values = Object.values(s.hours || {});
  const total = values.reduce((sum, n) => sum + n, 0);
  const worked = values.filter((n) => n > 0).length;
  const avg = worked ? total / worked : 0;
  return `<div class="stats-kpis">
    ${kpiCard(t("statsTotal"), `${fmtHours(total)} ${t("h")}`)}
    ${kpiCard(t("statsWorked"), String(worked))}
    ${kpiCard(t("statsAverage"), `${fmtHours(avg)} ${t("h")}`)}
  </div>`;
}

function staffKpis(s, me) {
  const mine = s.hours?.[me.id] || 0;
  const hist = s.history || [];
  const last = hist.length >= 2 ? hist[hist.length - 2] : null;
  const lastHours = last == null ? null : periodHours(last);
  const diff = lastHours == null ? null : mine - lastHours;
  let vs = `<p class="kpi-value">—</p>`;
  if (diff != null) {
    const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const sign = diff > 0 ? "+" : "";
    vs = `<p class="kpi-value kpi-delta ${cls}">${sign}${esc(fmtHours(diff))} ${esc(t("h"))}</p>`;
  }
  return `<div class="stats-kpis staff">
    <section class="card kpi-card">
      <p class="kicker">${esc(t("yourHours"))}</p>
      <p class="kpi-value">${esc(fmtHours(mine))} ${esc(t("h"))}</p>
    </section>
    <section class="card kpi-card">
      <p class="kicker">${esc(t("statsVsLast"))}</p>
      ${vs}
    </section>
  </div>`;
}

function peopleSubNav() {
  if (!canManage()) return "";
  const onTeam = ui.tab === "people";
  const onStats = isStatsTab();
  return `<div class="sub-tabs">
    <button type="button" class="${onTeam ? "on" : ""}" data-act="tab" data-tab="people">${esc(t("team"))}</button>
    <button type="button" class="${onStats ? "on" : ""}" data-act="tab" data-tab="stats">${esc(t("hoursNav"))}</button>
  </div>`;
}

function viewTeam() {
  if (!canManage()) return viewStats();
  return `<main class="page wide">
    <div class="toolbar">
      <div>${shopSwitchBar()}<p class="kicker">${esc(t("whosHere"))}</p><h1>${esc(t("team"))}</h1></div>
      <button class="primary" data-act="add-person">${esc(t("addPerson"))}</button>
    </div>
    ${!isDesktop() ? peopleSubNav() : ""}
    <p class="lede">${esc(t("teamJoinHint"))}</p>
    ${rosterPeople().map((p) => {
      const used = ui.data.hours[p.id] || 0;
      const waiting = needsSignIn(p) ? `<span class="tag">${esc(t("waitingInvite"))}</span>` : "";
      return `<button class="person-row" data-act="edit-person" data-id="${esc(p.id)}">
        <div class="person-copy">
          <b class="person-name">${esc(p.name)}${p.canManage ? accessBadge() : ""}${waiting}</b>
          ${rolePills(p)}
        </div>
        <span class="person-hours">${hoursCapOn() ? `${fmtHours(used)} / ${fmtHours(p.maxHours)} ${esc(t("h"))}` : `${fmtHours(used)} ${esc(t("h"))}`}</span>
      </button>`;
    }).join("")}
  </main>`;
}

function viewStats() {
  const manage = canManage();
  const s = statsPayload() || { hours: {}, history: [] };
  const me = ui.data.me;
  const range = s.from && s.to ? periodLabel(s.from, s.to) : t("hoursNav");
  const resetDay = s.resetDay || 1;
  const prev = s.from ? periodBefore(resetDay, s.from) : null;
  const next = s.to ? periodAfter(resetDay, s.to) : null;
  const nextOk = next && next.from <= todayYmd();
  const currentMark = viewingCurrentPeriod() ? `<span class="tag">${esc(t("currentPeriod"))}</span>` : "";
  const setCurrent = manage && !viewingCurrentPeriod()
    ? `<button type="button" class="ghost" data-act="stats-current">${esc(t("useCurrentPeriod"))}</button>`
    : "";
  return `<main class="page wide">
    <div class="toolbar">
      <div>
        ${shopSwitchBar()}
        <p class="kicker">${esc(t("hoursNav"))}</p>
        <div class="week-nav">
          <button type="button" class="icon-btn" data-act="stats-prev" aria-label="${esc(t("previousPeriod"))}" ${prev ? "" : "disabled"}>‹</button>
          <h1>${esc(range)}</h1>
          <button type="button" class="icon-btn" data-act="stats-next" aria-label="${esc(t("nextPeriod"))}" ${nextOk ? "" : "disabled"}>›</button>
        </div>
        ${currentMark}
      </div>
      <div class="toolbar-actions">${setCurrent}</div>
    </div>
    ${!isDesktop() && manage ? peopleSubNav() : ""}
    ${manage ? managerKpis(s) : staffKpis(s, me)}
    <div class="manage-grid stats-grid${manage ? "" : " staff-only"}">
      <section class="card">
        <h2>${esc(t("statsTrend"))}</h2>
        ${trendGraph(s.history)}
      </section>
      ${manage ? `<section class="card">
        <h2>${esc(t("statsByPerson"))}</h2>
        ${hoursBoard(s.hours)}
      </section>` : ""}
    </div>
  </main>`;
}

function periodResetCard() {
  const s = statsPayload() || {};
  const resetDayPick = Number(ui.resetDayDraft ?? s.resetDay ?? 1);
  return `<section class="card">
    <h2>${esc(t("resetDayTitle"))}</h2>
    <p class="hint">${esc(t("resetDay"))}</p>
    <form class="form" data-form="stats-reset">
      <select name="day">${Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        return `<option value="${day}" ${day === resetDayPick ? "selected" : ""}>${day}</option>`;
      }).join("")}</select>
      <p class="hint">${esc(t("resetDayHint"))}</p>
      ${resetDayPick >= 29 ? `<p class="hint">${esc(t("resetDayShortMonth"))}</p>` : ""}
      <button class="ghost" type="submit">${esc(t("save"))}</button>
    </form>
  </section>`;
}

function manageTabNow() {
  return ui.manageTab === "roles" || ui.manageTab === "hours" ? ui.manageTab : "shop";
}

function manageSubNav() {
  if (!canManage()) return "";
  const tab = manageTabNow();
  return `<div class="sub-tabs">
    <button type="button" class="${tab === "shop" ? "on" : ""}" data-act="manage-tab" data-tab="shop">${esc(t("manageShop"))}</button>
    <button type="button" class="${tab === "roles" ? "on" : ""}" data-act="manage-tab" data-tab="roles">${esc(t("manageRoles"))}</button>
    <button type="button" class="${tab === "hours" ? "on" : ""}" data-act="manage-tab" data-tab="hours">${esc(t("manageHours"))}</button>
  </div>`;
}

function manageShopCards() {
  const currentKind = ui.data.shop.kind || "cafe";
  const cats = ui.data.categories || [];
  const currentCat = ui.data.shop.categoryId;
  return `${joinCodeCard()}
    <section class="card">
      <h2>${esc(t("shopName"))}</h2>
      <form class="form" data-form="shop-name">
        <input name="name" required maxlength="60" value="${esc(ui.data.shop.name)}" />
        <button class="commit" type="submit">${esc(t("save"))}</button>
      </form>
    </section>
    <section class="card types-card">
      <h2>${esc(t("types"))}</h2>
      <p class="hint">${esc(t("kindManageHint"))}</p>
      ${kindChips(currentKind, "shop-kind")}
      <p class="lede-label">${esc(t("customType"))}</p>
      ${cats.map((c) => `<form class="form cat-row" data-form="edit-cat" data-id="${esc(c.id)}">
        <input name="name" required maxlength="40" value="${esc(c.name)}" />
        <div class="cat-actions">
          <button class="${c.id === currentCat ? "primary" : "ghost"}" type="button" data-act="use-cat" data-id="${esc(c.id)}">${esc(c.id === currentCat ? t("useType") : t("pickType"))}</button>
          <button class="ghost" type="submit">${esc(t("save"))}</button>
          <button class="danger" type="button" data-act="del-cat" data-id="${esc(c.id)}">${esc(t("remove"))}</button>
        </div>
      </form>`).join("")}
    </section>`;
}

function manageRolesCards() {
  const roles = ui.data.roles || [];
  return `<section class="card">
      <h2>${esc(t("roles"))}</h2>
      <p class="hint">${esc(t("elevatedHint"))}</p>
      ${roles.map((r) => `<form class="form role-form" data-form="edit-role" data-id="${esc(r.id)}">
        <input name="name" required value="${esc(r.name)}" />
        <input type="hidden" name="elevated" value="${r.elevated ? "1" : ""}" />
        ${toggleControl(Boolean(r.elevated), "role-access", t("elevated"), `data-id="${esc(r.id)}"`)}
        <div class="row-2">
          <button class="ghost" type="submit">${esc(t("save"))}</button>
          <button class="danger" type="button" data-act="del-role" data-id="${esc(r.id)}">${esc(t("remove"))}</button>
        </div>
      </form>`).join("")}
      <form class="form role-form" data-form="add-role">
        <input name="name" required maxlength="40" placeholder="${esc(t("addRole"))}" />
        <input type="hidden" name="elevated" value="${ui.addRoleElevated ? "1" : ""}" />
        ${toggleControl(Boolean(ui.addRoleElevated), "draft-role-access", t("elevated"))}
        <button class="ghost" type="submit">${esc(t("addRole"))}</button>
      </form>
    </section>`;
}

function manageHoursCards() {
  return `<section class="card">
      <h2>${esc(t("hoursCap"))}</h2>
      <p class="hint">${esc(t("hoursCapHint"))}</p>
      ${toggleControl(hoursCapOn(), "hours-cap", t("hoursCapOn"))}
    </section>
    ${periodResetCard()}`;
}

function viewManage() {
  const tab = manageTabNow();
  const title = tab === "roles" ? t("manageRoles") : tab === "hours" ? t("manageHours") : t("manageShop");
  const cards = tab === "roles" ? manageRolesCards() : tab === "hours" ? manageHoursCards() : manageShopCards();
  return `<main class="page wide">
    <div class="page-head"><p class="kicker">${esc(t("manage"))}</p><h1>${esc(title)}</h1></div>
    ${!isDesktop() ? manageSubNav() : ""}
    ${ui.error ? `<p class="error">${esc(err(ui.error))}</p>` : ""}
    <div class="manage-grid">${cards}</div>
  </main>`;
}

function claimCheck(shift) {
  const me = ui.data.me;
  const extra = shift.hours || 0;
  const after = (ui.data.hours[me.id] || 0) + extra;
  const roleMatch = personHasRole(me, shift.role);
  const hoursOk = !hoursCapOn() || after <= me.maxHours;
  return { auto: roleMatch && hoursOk, after };
}

function afterHoursCopy(after, me) {
  if (!hoursCapOn()) return "";
  return `${esc(t("afterHours"))}: ${fmtHours(after)} / ${fmtHours(me.maxHours)} ${esc(t("h"))}`;
}

function shiftStatus(shift, open) {
  if (open?.status === "pending") return t("pending");
  if (!shift.personId) return t("openSlot");
  if (shift.offered) return t("offered");
  return t("assigned");
}

function shiftActions(shift) {
  const me = ui.data.me;
  const mine = shift.personId === me.id;
  const vacant = !shift.personId;
  const open = (ui.data.swaps || []).find((s) => s.shiftId === shift.id && (s.status === "open" || s.status === "pending"));
  const pending = open?.status === "pending";
  const check = claimCheck(shift);
  const hoursNote = afterHoursCopy(check.after, me);
  const claimLead = `<p class="note ${check.auto ? "ok" : "warn"}">${esc(check.auto ? t("claimAuto") : t("claimQueue"))}${hoursNote ? `<br>${hoursNote}` : ""}</p>`;
  if (vacant && !pending) {
    return `${claimLead}
      <form class="form" data-form="claim-shift" data-id="${esc(shift.id)}">
        <button class="primary" type="submit">${esc(t("pickShift"))}</button>
      </form>`;
  }
  if (mine && !shift.offered) {
    return `<form class="form" data-form="offer-shift" data-id="${esc(shift.id)}">
      <label><span>${esc(t("offerReason"))}</span><textarea name="reason" maxlength="280" placeholder="${esc(t("reasonHint"))}"></textarea></label>
      <button class="primary" type="submit">${esc(t("offer"))}</button>
    </form>`;
  }
  if (mine && shift.offered && !pending) {
    return `${open?.offerReason ? `<p class="note">${esc(t("reason"))}: ${esc(open.offerReason)}</p>` : ""}
      <button class="ghost" data-act="cancel-offer" data-id="${esc(shift.id)}">${esc(t("cancelOffer"))}</button>`;
  }
  if (!mine && shift.offered && !pending) {
    return `${claimLead}
      ${open?.offerReason ? `<p class="meta">${esc(t("offered"))}: ${esc(open.offerReason)}</p>` : ""}
      <form class="form" data-form="claim-shift" data-id="${esc(shift.id)}">
        <button class="primary" type="submit">${esc(t("claim"))}</button>
      </form>`;
  }
  if (pending) {
    return `<p class="note warn">${esc(t("pending"))}</p>
      ${open?.reason ? `<p class="note">${esc(t("reason"))}: ${esc(open.reason)}</p>` : ""}`;
  }
  return "";
}

function shiftDetail(shift) {
  const who = personById(shift.personId);
  const open = (ui.data.swaps || []).find((s) => s.shiftId === shift.id && (s.status === "open" || s.status === "pending"));
  const used = ui.data.hours[shift.personId] || 0;
  const rows = [
    [t("date"), esc(fullDate(shift.date))],
    [t("start"), esc(shift.start)],
    [t("end"), esc(shift.end)],
    [t("duration"), `${esc(fmtHours(shift.hours))} ${esc(t("h"))}`],
    [t("role"), `<span class="person-role">${esc(shift.role)}</span>`],
    [t("assigned"), esc(who?.name || t("openSlot"))],
    ...(who && hoursCapOn() ? [[t("hoursWeek"), `${fmtHours(used)} / ${fmtHours(who.maxHours)} ${esc(t("h"))}`]] : []),
    [t("status"), esc(shiftStatus(shift, open))],
  ];
  let extra = "";
  if (open?.offerReason) extra += `<p class="note">${esc(t("offerReason"))}: ${esc(open.offerReason)}</p>`;
  if (open?.reason) extra += `<p class="note">${esc(t("claimReason"))}: ${esc(open.reason)}</p>`;
  return `<dl class="detail">${rows.map(([k, v]) => `<div class="detail-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>${extra}`;
}

function shiftEditForm(shift) {
  return `<form class="form" data-form="edit-shift" data-id="${esc(shift.id)}">
    ${ui.error ? `<p class="error">${esc(err(ui.error))}</p>` : ""}
    <label><span>${esc(t("date"))}</span><input name="date" type="date" value="${esc(shift.date)}" required /></label>
    <div class="chips">${TIMES.map(([a, b]) => `<button type="button" data-act="preset-time" data-start="${a}" data-end="${b}">${a}–${b}</button>`).join("")}</div>
    <div class="row-2">
      <label><span>${esc(t("start"))}</span><input name="start" type="time" value="${esc(shift.start)}" required /></label>
      <label><span>${esc(t("end"))}</span><input name="end" type="time" value="${esc(shift.end)}" required /></label>
    </div>
    <label><span>${esc(t("role"))}</span><input name="role" value="${esc(shift.role)}" required /></label>
    ${roleChips(shift.role)}
    <label><span>${esc(t("assigned"))}</span>
      <select name="personId">
        <option value="" ${shift.personId ? "" : "selected"}>${esc(t("openSlot"))}</option>
        ${assignablePeople(shift.personId).map((p) => `<option value="${esc(p.id)}" ${p.id === shift.personId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
      </select>
    </label>
    <p class="lede">${esc(t("openHint"))}</p>
    <button class="commit" type="submit">${esc(t("save"))}</button>
    <button class="danger" type="button" data-act="delete-shift" data-id="${esc(shift.id)}">${esc(t("deleteShift"))}</button>
  </form>`;
}

function shiftSheet(shift) {
  if (!shift) return "";
  const editing = canManage() && ui.sheet?.mode === "edit";
  if (editing) {
    return sheetWrap(
      t("editShift"),
      shiftEditForm(shift),
      `<button class="text-btn" data-act="view-shift">${esc(t("back"))}</button>`,
    );
  }
  const editBtn = "<span></span>";
  return sheetWrap(
    `${shift.start}–${shift.end}`,
    `${shiftDetail(shift)}${shiftActions(shift)}${canManage() ? `<div class="sheet-actions"><button class="primary" data-act="edit-shift-mode">${esc(t("edit"))}</button></div>` : ""}`,
    editBtn,
  );
}

function addShiftSheet() {
  const fallback = isDesktop()
    ? (ui.month <= todayYmd() && todayYmd() <= monthEnd(ui.month) ? todayYmd() : ui.month)
    : (ui.week <= todayYmd() && todayYmd() <= addDays(ui.week, 6) ? todayYmd() : ui.week);
  const date = ui.pickDate || fallback;
  const slot = TIMES[0];
  return sheetWrap(t("addShift"), `<form class="form" data-form="add-shift">
    ${ui.error ? `<p class="error">${esc(err(ui.error))}</p>` : ""}
    <label><span>${esc(t("date"))}</span><input name="date" type="date" value="${esc(date)}" required /></label>
    <div class="chips">${TIMES.map(([a, b]) => `<button type="button" data-act="preset-time" data-start="${a}" data-end="${b}">${a}–${b}</button>`).join("")}</div>
    <div class="row-2">
      <label><span>${esc(t("start"))}</span><input name="start" type="time" value="${esc(slot[0])}" required /></label>
      <label><span>${esc(t("end"))}</span><input name="end" type="time" value="${esc(slot[1])}" required /></label>
    </div>
    <label><span>${esc(t("role"))}</span><input name="role" required /></label>
    ${roleChips("")}
    <label><span>${esc(t("assigned"))}</span>
      <select name="personId">
        <option value="" selected>${esc(t("openSlot"))}</option>
        ${assignablePeople().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
      </select>
    </label>
    <p class="lede">${esc(t("openHint"))}</p>
    ${copyDayChips(date)}
    <button class="commit" type="submit">${esc(t("save"))}</button>
  </form>`);
}

function copyDaySheet(date) {
  return sheetWrap(t("copyDay"), `<form class="form" data-form="copy-day" data-from="${esc(date)}">
    ${ui.error ? `<p class="error">${esc(err(ui.error))}</p>` : ""}
    <p class="lede">${esc(t("copyDayHint"))} ${esc(fullDate(date))}.</p>
    ${copyDayChips(date)}
    <button class="commit" type="submit">${esc(t("copyDay"))}</button>
  </form>`);
}

function personSheet(person) {
  const joinId = ui.sheet?.joinRequestId;
  const isJoin = Boolean(joinId);
  const founder = personIsOwner(person);
  const formName = isJoin ? "approve-join" : person?.id ? "edit-person" : "add-person";
  const title = isJoin || person?.name ? person.name : t("addPerson");
  const access = founder
    ? `<p class="hint">${esc(t("founderHint"))}</p>`
    : `<input type="hidden" name="elevated" value="${person?.elevated ? "1" : ""}" />
      ${toggleControl(Boolean(person?.elevated), "sheet-access", t("elevated"))}
      <p class="hint">${esc(personGrantsAccess(person) ? t("roleAlreadyAccess") : t("personAccessHint"))}</p>`;
  const marked = founder || Boolean(person?.canManage) || Boolean(person?.elevated) || personGrantsAccess(person);
  return sheetWrap(title, `<form class="form" data-form="${formName}" ${person?.id ? `data-id="${esc(person.id)}"` : ""} ${isJoin ? `data-join="${esc(joinId)}"` : ""}>
    ${ui.error ? `<p class="error">${esc(err(ui.error))}</p>` : ""}
    ${isJoin ? `<p class="lede">${esc(t("approveJoinHint"))}</p>` : ""}
    <label><span>${esc(t("fullName"))}</span><input name="name" required minlength="3" maxlength="80" autocomplete="name" placeholder="${esc(t("fullNameHint"))}" value="${esc(person?.name || "")}" /></label>
    <span class="lede-label">${esc(t("roles"))}</span>
    <p class="lede">${esc(t("rolesHint"))}</p>
    ${personRoleChips(personRoles(person))}
    <div class="role-create">
      <label><span>${esc(t("addRole"))}</span><input name="extraRole" maxlength="40" placeholder="${esc(t("addRole"))}" autocomplete="off" /></label>
      <button class="primary" type="button" data-act="create-person-role">${esc(t("create"))}</button>
    </div>
    ${access}
    ${hoursCapOn() ? `<label><span>${esc(t("hoursCap"))}</span><input name="maxHours" type="number" min="1" max="80" step="0.5" value="${esc(person?.maxHours ?? 40)}" required /></label>` : ""}
    <label><span>${esc(t("emailForLogin"))}</span><input name="email" type="email" value="${esc(person?.email || "")}" /></label>
    ${isJoin ? "" : `<p class="hint">${esc(t("calendarOnlyHint"))}</p><p class="hint">${esc(t("emailInviteHint"))}</p>`}
    ${!isJoin && person?.id && person.email && !person.userId ? `<p class="lede">${esc(t("noPasswordYet"))}</p>` : ""}
    <button class="commit" type="submit">${esc(isJoin ? t("approve") : t("save"))}</button>
  </form>${!isJoin && person?.id && canManage() && person.id !== ui.data.me.id && !founder ? `<button type="button" class="danger kick-btn" data-act="kick-person" data-id="${esc(person.id)}" data-name="${esc(person.name)}">${esc(t("kickFromShop"))}</button>` : ""}`, marked ? accessBadge() : "<span></span>");
}

function askConfirm({ title, body, ok, danger }) {
  return new Promise((resolve) => {
    ui.dialog = { title, body, ok: ok || t("save"), danger: Boolean(danger), resolve };
    render();
  });
}

function clashDateLabel(dateStr) {
  return `${weekdayShort(dateStr)} ${Number(String(dateStr).slice(8))}.`;
}

function clashConfirmBody(clashes) {
  const lines = clashes.map((c) =>
    t("overlapLine")
      .replace("NAME", c.name)
      .replace("DATE", clashDateLabel(c.date))
      .replace("START", c.start)
      .replace("END", c.end),
  );
  return `${lines.join(" ")} ${t("overlapContinue")}`;
}

async function confirmClashes(clashes) {
  if (!clashes?.length) return true;
  return askConfirm({
    title: t("overlapTitle"),
    body: clashConfirmBody(clashes),
    ok: t("continue"),
  });
}

function closeDialog(ok) {
  const resolve = ui.dialog?.resolve;
  ui.dialog = null;
  render();
  resolve?.(Boolean(ok));
}

function confirmDialog() {
  const d = ui.dialog;
  if (!d) return "";
  return `<section class="confirm-overlay">
    <button type="button" class="confirm-backdrop" data-act="dialog-cancel" aria-label="${esc(t("cancel"))}"></button>
    <div class="confirm-card" role="dialog" aria-modal="true">
      <h2>${esc(d.title)}</h2>
      <p class="lede">${esc(d.body)}</p>
      <div class="row-2">
        <button type="button" class="ghost" data-act="dialog-cancel">${esc(t("cancel"))}</button>
        <button type="button" class="${d.danger ? "danger" : "commit"}" data-act="dialog-ok">${esc(d.ok)}</button>
      </div>
    </div>
  </section>`;
}

function sheetWrap(title, body, extra = "<span></span>") {
  return `<section class="sheet"><div class="sheet-card">
    <header class="sheet-bar"><button class="text-btn" data-act="close">${esc(t("close"))}</button><h2>${esc(title)}</h2>${extra}</header>
    ${body}
  </div></section>`;
}

function sidebarNav() {
  const manage = canManage();
  const peopleOpen = ui.tab === "people" || isStatsTab();
  const manageOpen = ui.tab === "manage";
  const weekBtn = `<button class="nav-btn ${ui.tab === "week" ? "on" : ""}" data-act="tab" data-tab="week">${esc(t("calendar"))}</button>`;
  const queueBtn = manage
    ? `<button class="nav-btn ${ui.tab === "queue" ? "on" : ""}" data-act="tab" data-tab="queue">${esc(t("queue"))}${ui.data.pendingCount ? `<span class="count">${ui.data.pendingCount}</span>` : ""}</button>`
    : "";
  if (!manage) {
    return `${weekBtn}<button class="nav-btn ${isStatsTab() ? "on" : ""}" data-act="tab" data-tab="stats">${esc(t("hoursNav"))}</button>`;
  }
  const tab = manageTabNow();
  return `${weekBtn}${queueBtn}
    <div class="nav-group${peopleOpen ? " open" : ""}">
      <button type="button" class="nav-btn nav-parent ${peopleOpen ? "on" : ""}" data-act="people-toggle">${esc(t("people"))}</button>
      ${peopleOpen ? `<button class="nav-btn nav-sub ${ui.tab === "people" ? "on" : ""}" data-act="tab" data-tab="people">${esc(t("team"))}</button>
        <button class="nav-btn nav-sub ${isStatsTab() ? "on" : ""}" data-act="tab" data-tab="stats">${esc(t("hoursNav"))}</button>` : ""}
    </div>
    <div class="nav-group${manageOpen ? " open" : ""}">
      <button type="button" class="nav-btn nav-parent ${manageOpen ? "on" : ""}" data-act="manage-toggle">${esc(t("manage"))}</button>
      ${manageOpen ? `<button class="nav-btn nav-sub ${tab === "shop" ? "on" : ""}" data-act="manage-tab" data-tab="shop">${esc(t("manageShop"))}</button>
        <button class="nav-btn nav-sub ${tab === "roles" ? "on" : ""}" data-act="manage-tab" data-tab="roles">${esc(t("manageRoles"))}</button>
        <button class="nav-btn nav-sub ${tab === "hours" ? "on" : ""}" data-act="manage-tab" data-tab="hours">${esc(t("manageHours"))}</button>` : ""}
    </div>`;
}

function navButtons({ forDock = false } = {}) {
  const items = [{ id: "week", label: t("calendar") }];
  if (canManage()) {
    items.push({ id: "queue", label: t("queue"), count: ui.data.pendingCount });
    items.push({ id: "people", label: t("people") });
    items.push({ id: "manage", label: t("manage") });
  } else {
    items.push({ id: "stats", label: t("hoursNav") });
  }
  if (forDock) items.push({ id: "settings", label: t("settings") });
  return items.map((item) => {
    const on = item.id === "people"
      ? ui.tab === "people" || isStatsTab()
      : item.id === "stats"
        ? isStatsTab()
        : ui.tab === item.id;
    return `<button class="${on ? "on" : ""}" data-act="tab" data-tab="${item.id}">${esc(item.label)}${item.count ? `<span class="count">${item.count}</span>` : ""}</button>`;
  }).join("");
}

function signedInBlock() {
  const me = ui.data?.me;
  const name = me?.name || "";
  if (!name) return "";
  return `<div class="signed-in"><p class="kicker">${esc(t("you"))}</p><p class="signed-in-name">${esc(name)}</p>${rolePills(me)}</div>`;
}

function sidebar() {
  if (ui.screen !== "app") return "";
  return `<aside class="sidebar">
    <div class="brand">
      <p class="kicker">${esc(t("app"))}</p>
      <h1>${esc(ui.data.shop.name)}</h1>
      <p class="shop-type">${esc(shopTypeLabel())}</p>
      <button type="button" class="ghost shop-switch-btn" data-act="picker">${esc(t("switchShop"))}</button>
    </div>
    <div class="sidebar-nav">${sidebarNav()}</div>
    <div class="sidebar-foot">
      ${signedInBlock()}
      ${langToggle()}
      ${themeToggle()}
      ${ui.preview ? "" : `<button class="ghost" data-act="logout">${esc(t("logout"))}</button>`}
    </div>
  </aside>`;
}

function dock() {
  if (ui.screen !== "app") return "";
  return `<nav class="dock">${navButtons({ forDock: true })}<button class="dock-shop" data-act="picker">${esc(t("switchShop"))}</button></nav>`;
}

function viewSettings() {
  return `<main class="page wide">
    <p class="kicker">${esc(t("app"))}</p>
    <h1>${esc(t("settings"))}</h1>
    <div class="settings-page">
    ${signedInBlock()}
    <section class="card">
      <h2>${esc(t("lang"))}</h2>
      ${langToggle()}
    </section>
    <section class="card">
      <h2>${esc(t("appearance"))}</h2>
      ${themeToggle()}
    </section>
    <div class="form">
      ${ui.preview ? "" : `<button class="ghost" data-act="logout">${esc(t("logout"))}</button>`}
    </div>
    </div>
  </main>`;
}

function mainView() {
  if (ui.tab === "queue") return viewQueue();
  if (ui.tab === "people") return viewTeam();
  if (isStatsTab()) return viewStats();
  if (ui.tab === "manage") return viewManage();
  if (ui.tab === "settings") return viewSettings();
  return isDesktop() ? viewMonth() : viewWeek();
}

function render() {
  let html = previewBanner();
  if (ui.screen === "boot") html += `<main class="page"><p class="lede">${esc(t("app"))}</p></main>`;
  else if (ui.screen === "setup") html += viewSetup();
  else if (ui.screen === "login") html += viewLogin();
  else if (ui.screen === "picker") html += viewPicker();
  else {
    html += `<div class="shell">${sidebar()}<div class="main">${mainView()}</div></div>${dock()}`;
    if (ui.sheet?.type === "shift") {
      const live = ui.data.shifts.find((s) => s.id === ui.sheet.shift?.id) || ui.sheet.shift;
      html += shiftSheet(live);
    }
    if (ui.sheet?.type === "add-shift") html += addShiftSheet();
    if (ui.sheet?.type === "copy-day") html += copyDaySheet(ui.sheet.date);
    if (ui.sheet?.type === "person") html += personSheet(ui.sheet.person);
  }
  if (ui.toast) html += `<div class="toast">${esc(ui.toast)}</div>`;
  html += confirmDialog();
  html += cookieBanner();
  document.documentElement.dataset.cookies = ui.preview || cookiesDecided() ? "done" : "open";
  app.innerHTML = html;
  ensureLive();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function handle(action, target) {
  try {
    ui.error = "";
    if (action === "dialog-cancel") {
      closeDialog(false);
      return;
    }
    if (action === "dialog-ok") {
      closeDialog(true);
      return;
    }
    if (action === "cookies") {
      const mode = target.dataset.mode;
      if (mode !== "all" && mode !== "necessary" && mode !== "declined") return;
      setConsent(mode);
      if (mode === "declined" && ui.user) {
        await api("/api/logout", { method: "POST" }).catch(() => {});
        ui.data = null;
        ui.sheet = null;
        ui.user = null;
        ui.shops = [];
        ui.pendingJoins = [];
        ui.shopId = "";
        stopLive();
        ui.screen = "login";
      }
      render();
      return;
    }
    if (action === "lang") {
      setLang(target.dataset.lang);
      if (canManage()) await api("/api/lang", { method: "PATCH", body: { lang: ui.lang } });
      render();
      return;
    }
    if (action === "theme") {
      applyTheme(target.dataset.theme);
      if (canManage()) await api("/api/shop", { method: "PATCH", body: { theme: ui.theme } });
      render();
      return;
    }
    if (action === "setup-kind") {
      ui.setupKind = target.dataset.kind;
      ui.setupRole = selectedSetupRole();
      render();
      return;
    }
    if (action === "setup-role") {
      readSetupDraft();
      ui.setupRole = target.dataset.role;
      render();
      return;
    }
    if (action === "setup-next") {
      ui.setupRole = selectedSetupRole();
      ui.setupStep = "details";
      render();
      return;
    }
    if (action === "setup-back") {
      readSetupDraft();
      ui.setupStep = "kind";
      render();
      return;
    }
    if (action === "auth-mode") {
      ui.authMode = target.dataset.mode;
      if (target.dataset.mode !== "claim") ui.claimEmail = "";
      ui.error = "";
      render();
      return;
    }
    if (action === "picker") {
      const boot = await api("/api/bootstrap");
      rememberAuth(boot);
      ui.screen = "picker";
      ui.sheet = null;
      render();
      await flushNotices(boot);
      return;
    }
    if (action === "create-shop") {
      ui.setupStep = "kind";
      ui.screen = "setup";
      render();
      return;
    }
    if (action === "open-shop") {
      ui.shopId = target.dataset.id;
      if (canStorePrefs()) localStorage.setItem("swapshift-shop", ui.shopId);
      ui.data = await api("/api/select-shop", { method: "POST", body: { shopId: ui.shopId } });
      rememberAuth(ui.data);
      ui.week = ui.data.weekStart;
      ui.screen = "app";
      ui.tab = "week";
      render();
      return;
    }
    if (action === "copy-code") {
      const code = ui.data?.shop?.joinCode;
      if (code && navigator.clipboard) await navigator.clipboard.writeText(code);
      showToast(t("joinCode"));
      return;
    }
    if (action === "new-code") {
      ui.data = await api("/api/shop/join-code", { method: "POST" });
      render();
      return;
    }
    if (action === "approve-join") {
      const jr = (ui.data.joinRequests || []).find((row) => row.id === target.dataset.id);
      if (!jr) return;
      ui.sheet = {
        type: "person",
        joinRequestId: jr.id,
        person: { name: jr.name, email: jr.email, maxHours: 40, roles: [], elevated: false },
      };
      render();
      return;
    }
    if (action === "reject-join") {
      ui.data = await api(`/api/join-requests/${target.dataset.id}/reject`, { method: "POST" });
      render();
      return;
    }
    if (action === "hours-cap") {
      if (ui.hoursCapBusy) return;
      const next = !hoursCapOn();
      ui.hoursCapBusy = true;
      holdLive();
      if (ui.data?.shop) ui.data.shop.hoursCap = next;
      paintToggle(target, next);
      try {
        const data = await api("/api/shop", { method: "PATCH", body: { hoursCap: next ? 1 : 0 } });
        ui.data = data;
        if (ui.data?.shop) ui.data.shop.hoursCap = next;
      } catch (error) {
        if (ui.data?.shop) ui.data.shop.hoursCap = !next;
        paintToggle(target, !next);
        throw error;
      } finally {
        ui.hoursCapBusy = false;
      }
      return;
    }
    if (action === "role-access") {
      const role = (ui.data.roles || []).find((r) => r.id === target.dataset.id);
      if (!role) return;
      const next = !role.elevated;
      role.elevated = next;
      paintToggle(target, next);
      const hidden = target.closest("form")?.querySelector('input[name="elevated"]');
      if (hidden) hidden.value = next ? "1" : "";
      holdLive();
      try {
        ui.data = await api(`/api/roles/${role.id}`, {
          method: "PATCH",
          body: { name: role.name, elevated: next },
        });
        if (ui.data) {
          const live = (ui.data.roles || []).find((r) => r.id === role.id);
          if (live) live.elevated = next;
        }
      } catch (error) {
        role.elevated = !next;
        paintToggle(target, !next);
        if (hidden) hidden.value = !next ? "1" : "";
        throw error;
      }
      return;
    }
    if (action === "draft-role-access") {
      ui.addRoleElevated = !ui.addRoleElevated;
      paintToggle(target, ui.addRoleElevated);
      const hidden = target.closest("form")?.querySelector('input[name="elevated"]');
      if (hidden) hidden.value = ui.addRoleElevated ? "1" : "";
      return;
    }
    if (action === "sheet-access") {
      if (!ui.sheet?.person) ui.sheet.person = {};
      const next = !ui.sheet.person.elevated;
      ui.sheet.person.elevated = next;
      paintToggle(target, next);
      const hidden = target.closest("form")?.querySelector('input[name="elevated"]');
      if (hidden) hidden.value = next ? "1" : "";
      return;
    }
    if (action === "shop-kind") {
      ui.data = await api("/api/shop", { method: "PATCH", body: { kind: target.dataset.kind } });
      render();
      return;
    }
    if (action === "tab") {
      ui.tab = target.dataset.tab === "hours" ? "stats" : target.dataset.tab;
      ui.sheet = null;
      render();
      return;
    }
    if (action === "people-toggle") {
      if (!canManage()) ui.tab = "stats";
      else if (ui.tab !== "people" && !isStatsTab()) ui.tab = "people";
      ui.sheet = null;
      render();
      return;
    }
    if (action === "manage-toggle") {
      if (!canManage()) return;
      if (ui.tab !== "manage") ui.tab = "manage";
      ui.sheet = null;
      render();
      return;
    }
    if (action === "manage-tab") {
      if (!canManage()) return;
      const next = target.dataset.tab;
      ui.tab = "manage";
      ui.manageTab = next === "roles" || next === "hours" ? next : "shop";
      ui.sheet = null;
      render();
      return;
    }
    if (action === "stats-prev" || action === "stats-next") {
      const s = statsPayload();
      if (!s?.from) return;
      const next = action === "stats-prev"
        ? periodBefore(s.resetDay || 1, s.from)
        : periodAfter(s.resetDay || 1, s.to);
      if (!next) return;
      if (action === "stats-next" && next.from > todayYmd()) return;
      ui.statsSel = next;
      ui.statsView = await api(`/api/stats?from=${next.from}&to=${next.to}`);
      render();
      return;
    }
    if (action === "stats-current") {
      const s = statsPayload();
      if (!s?.from || viewingCurrentPeriod()) return;
      const absorb = await askConfirm({
        title: t("useCurrentPeriod"),
        body: t("absorbConfirm"),
        ok: t("useCurrentPeriod"),
      });
      ui.data = await api("/api/stats/current", {
        method: "POST",
        body: { from: s.from, to: s.to, absorb },
      });
      ui.statsSel = null;
      ui.statsView = ui.data.stats;
      render();
      return;
    }
    if (action === "kick-person") {
      if (!canManage()) return;
      const name = target.dataset.name || "";
      const ok = await askConfirm({
        title: t("kickFromShop"),
        body: t("kickConfirm").replace("NAME", name),
        ok: t("kickFromShop"),
        danger: true,
      });
      if (!ok) return;
      ui.data = await api(`/api/people/${target.dataset.id}/kick`, { method: "POST" });
      ui.sheet = null;
      ui.statsView = ui.data.stats;
      render();
      return;
    }
    if (action === "week") {
      ui.week = addDays(ui.week, Number(target.dataset.dir) * 7);
      ui.month = monthStart(ui.week);
      await loadWeek();
      return;
    }
    if (action === "month") {
      ui.month = addMonths(ui.month, Number(target.dataset.dir));
      ui.day = selectedDay();
      await loadWeek();
      return;
    }
    if (action === "today") {
      const today = todayYmd();
      ui.day = today;
      ui.month = monthStart(today);
      ui.week = mondayOf(today);
      await loadWeek();
      return;
    }
    if (action === "pick-day") {
      ui.day = target.dataset.date;
      render();
      return;
    }
    if (action === "filter-mine") {
      ui.filterMine = !ui.filterMine;
      render();
      return;
    }
    if (action === "open-shift") {
      const shift = ui.data.shifts.find((s) => s.id === target.dataset.id);
      if (!shift) return;
      ui.day = shift.date;
      ui.sheet = { type: "shift", shift, mode: "view" };
      render();
      return;
    }
    if (action === "edit-shift-mode") {
      if (!canManage() || ui.sheet?.type !== "shift") return;
      ui.sheet = { ...ui.sheet, mode: "edit" };
      render();
      return;
    }
    if (action === "view-shift") {
      if (ui.sheet?.type !== "shift") return;
      ui.sheet = { ...ui.sheet, mode: "view" };
      render();
      return;
    }
    if (action === "add-shift") {
      ui.pickDate = ui.day || (isDesktop()
        ? (ui.month <= todayYmd() && todayYmd() <= monthEnd(ui.month) ? todayYmd() : ui.month)
        : (ui.week <= todayYmd() && todayYmd() <= addDays(ui.week, 6) ? todayYmd() : ui.week));
      ui.sheet = { type: "add-shift" };
      render();
      return;
    }
    if (action === "add-on-date") {
      if (!canManage()) return;
      ui.pickDate = target.dataset.date;
      ui.day = target.dataset.date;
      ui.sheet = { type: "add-shift" };
      render();
      return;
    }
    if (action === "copy-day") {
      if (!canManage()) return;
      ui.sheet = { type: "copy-day", date: target.dataset.date || ui.day };
      render();
      return;
    }
    if (action === "add-person") {
      ui.tab = "people";
      ui.sheet = { type: "person", person: null };
      render();
      return;
    }
    if (action === "edit-person") {
      ui.sheet = { type: "person", person: personById(target.dataset.id) };
      render();
      return;
    }
    if (action === "close") {
      ui.sheet = null;
      render();
      return;
    }
    if (action === "preset-time") {
      const form = target.closest("form");
      form.start.value = target.dataset.start;
      form.end.value = target.dataset.end;
      return;
    }
    if (action === "preset-role") {
      const form = target.closest("form");
      form.role.value = target.dataset.role;
      form.querySelectorAll("[data-act='preset-role']").forEach((btn) => btn.classList.toggle("on", btn.dataset.role === target.dataset.role));
      return;
    }
    if (action === "create-person-role") {
      const form = target.closest("form");
      const input = form?.querySelector('[name="extraRole"]');
      const name = String(input?.value || "").trim();
      if (!form || !name) return;
      addPersonRoleChip(form, name);
      input.value = "";
      return;
    }
    if (action === "toggle-person-role") {
      const form = target.closest("form");
      const hidden = form.querySelector('input[name="roles"]');
      const current = String(hidden?.value || "").split("|").filter(Boolean);
      const role = target.dataset.role;
      const next = current.some((r) => r.toLowerCase() === role.toLowerCase())
        ? current.filter((r) => r.toLowerCase() !== role.toLowerCase())
        : [...current, role];
      if (!next.length) return;
      hidden.value = next.join("|");
      target.classList.toggle("on");
      return;
    }
    if (action === "cancel-offer") {
      ui.data = await api(`/api/shifts/${target.dataset.id}/cancel-offer`, { method: "POST" });
      ui.sheet = null;
      render();
      return;
    }
    if (action === "approve") {
      ui.data = await api(`/api/swaps/${target.dataset.id}/approve`, { method: "POST" });
      render();
      return;
    }
    if (action === "reject") {
      ui.data = await api(`/api/swaps/${target.dataset.id}/reject`, { method: "POST" });
      render();
      return;
    }
    if (action === "delete-shift") {
      ui.data = await api(`/api/shifts/${target.dataset.id}`, { method: "DELETE" });
      ui.sheet = null;
      render();
      return;
    }
    if (action === "demo") {
      const week = isDesktop() ? mondayOf(ui.month) : ui.week;
      ui.data = await api("/api/demo", { method: "POST", body: { week } });
      render();
      return;
    }
    if (action === "use-cat") {
      ui.data = await api("/api/shop", { method: "PATCH", body: { categoryId: target.dataset.id } });
      render();
      return;
    }
    if (action === "del-cat") {
      ui.data = await api(`/api/categories/${target.dataset.id}`, { method: "DELETE" });
      render();
      return;
    }
    if (action === "del-role") {
      ui.data = await api(`/api/roles/${target.dataset.id}`, { method: "DELETE" });
      render();
      return;
    }
    if (action === "logout") {
      await api("/api/logout", { method: "POST" });
      ui.data = null;
      ui.sheet = null;
      ui.user = null;
      ui.shops = [];
      ui.pendingJoins = [];
      ui.shopId = "";
      localStorage.removeItem("swapshift-shop");
      stopLive();
      ui.screen = "login";
      ui.authMode = "login";
      ui.claimEmail = "";
      ui.statsSel = null;
      ui.statsView = null;
      render();
    }
  } catch (error) {
    if (ui.screen === "app" && isGoneFromShop(error)) {
      await bounceFromShop(error);
      return;
    }
    ui.error = error.code || "server";
    render();
  }
}

app.addEventListener("change", (event) => {
  const select = event.target.closest("select[name='day']");
  if (!select?.closest("[data-form='stats-reset']")) return;
  ui.resetDayDraft = Number(select.value);
  render();
});

app.addEventListener("click", (event) => {
  if (event.target.closest("input, select, textarea")) return;
  if (event.target.classList.contains("sheet")) {
    ui.sheet = null;
    render();
    return;
  }
  const target = event.target.closest("[data-act]");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  handle(target.dataset.act, target);
});

app.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  ui.error = "";
  const body = formData(form);
  try {
    if (form.dataset.form === "login") {
      if (!allowsSessionCookie()) {
        ui.error = "cookies_needed";
        render();
        return;
      }
      ui.remember = Boolean(body.remember) && canRememberLogin();
      const data = await api("/api/login", {
        method: "POST",
        body: { email: body.email, password: body.password, remember: ui.remember },
      });
      if (data.claim) {
        ui.authMode = "claim";
        ui.claimEmail = String(body.email || "").trim().toLowerCase();
        ui.error = "";
        render();
        return;
      }
      rememberAuth(data);
      ui.screen = "picker";
      render();
      await flushNotices(data);
      return;
    }
    if (form.dataset.form === "invite-check") {
      if (!allowsSessionCookie()) {
        ui.error = "cookies_needed";
        render();
        return;
      }
      const email = String(body.email || "").trim().toLowerCase();
      const data = await api("/api/invite-check", { method: "POST", body: { email } });
      ui.claimEmail = email;
      if (data.claim) {
        ui.authMode = "claim";
        ui.error = "";
        render();
        return;
      }
      if (data.existing) {
        ui.authMode = "login";
        ui.error = "alreadyAccount";
        render();
        return;
      }
      ui.authMode = "signup";
      ui.error = "noInvite";
      render();
      return;
    }
    if (form.dataset.form === "claim") {
      if (!allowsSessionCookie()) {
        ui.error = "cookies_needed";
        render();
        return;
      }
      if (body.password !== body.password2) {
        ui.error = "password_mismatch";
        render();
        return;
      }
      ui.remember = Boolean(body.remember) && canRememberLogin();
      const data = await api("/api/login", {
        method: "POST",
        body: { email: ui.claimEmail || body.email, password: body.password, remember: ui.remember, claim: true },
      });
      rememberAuth(data);
      ui.authMode = "login";
      ui.claimEmail = "";
      ui.screen = "picker";
      render();
      await flushNotices(data);
      return;
    }
    if (form.dataset.form === "signup") {
      if (!allowsSessionCookie()) {
        ui.error = "cookies_needed";
        render();
        return;
      }
      if (body.password !== body.password2) {
        ui.error = "password_mismatch";
        render();
        return;
      }
      if (String(body.name || "").trim().split(/\s+/).filter(Boolean).length < 2) {
        ui.error = "full_name";
        render();
        return;
      }
      ui.remember = Boolean(body.remember) && canRememberLogin();
      const data = await api("/api/signup", {
        method: "POST",
        body: { name: body.name, email: body.email, password: body.password, remember: ui.remember },
      });
      rememberAuth(data);
      ui.screen = "picker";
      render();
      return;
    }
    if (form.dataset.form === "join") {
      const data = await api("/api/join", { method: "POST", body: { code: body.code } });
      rememberAuth(data);
      showToast(t("joinWaiting"));
      ui.screen = "picker";
      render();
      return;
    }
    if (form.dataset.form === "setup") {
      ui.setupShopName = body.shopName || "";
      ui.setupOwnerName = body.ownerName || "";
      if (body.role) ui.setupRole = body.role;
      const data = await api("/api/setup", { method: "POST", body: { ...body, lang: ui.lang, kind: ui.setupKind } });
      rememberAuth(data);
      ui.data = data;
      ui.week = data.weekStart;
      ui.screen = "app";
      ui.tab = "manage";
      render();
      return;
    }
    if (form.dataset.form === "offer-shift") {
      ui.data = await api(`/api/shifts/${form.dataset.id}/offer`, { method: "POST", body: { reason: body.reason } });
      ui.sheet = null;
      showToast(t("offered"));
      return;
    }
    if (form.dataset.form === "claim-shift") {
      const data = await api(`/api/shifts/${form.dataset.id}/claim`, { method: "POST", body: { reason: body.reason } });
      ui.data = data;
      ui.sheet = null;
      showToast(data.claim?.auto ? t("auto") : t("pending"));
      return;
    }
    if (form.dataset.form === "add-shift") {
      const copyDates = [...form.querySelectorAll('input[name="copyDates"]:checked')].map((el) => el.value);
      if (body.date) {
        ui.month = monthStart(body.date);
        ui.week = mondayOf(body.date);
        ui.day = body.date;
        ui.pickDate = body.date;
      }
      if (body.personId) {
        const clashData = await api("/api/clashes", {
          method: "POST",
          body: { personId: body.personId, date: body.date, start: body.start, end: body.end, copyDates },
        });
        if (!(await confirmClashes(clashData.clashes))) return;
      }
      ui.data = await api(`/api/shifts?week=${ui.week}`, { method: "POST", body: { ...body, copyDates } });
      ui.sheet = { type: "add-shift" };
      showToast(t("addShift"));
      return;
    }
    if (form.dataset.form === "copy-day") {
      const dates = [...form.querySelectorAll('input[name="copyDates"]:checked')].map((el) => el.value);
      if (dates.length) {
        const clashData = await api("/api/clashes", {
          method: "POST",
          body: { from: form.dataset.from, dates },
        });
        if (!(await confirmClashes(clashData.clashes))) return;
      }
      ui.data = await api("/api/copy-day", { method: "POST", body: { from: form.dataset.from, dates } });
      ui.sheet = null;
      showToast(t("copyDay"));
      return;
    }
    if (form.dataset.form === "edit-shift") {
      if (body.personId) {
        const clashData = await api("/api/clashes", {
          method: "POST",
          body: {
            personId: body.personId,
            date: body.date,
            start: body.start,
            end: body.end,
            excludeId: form.dataset.id,
          },
        });
        if (!(await confirmClashes(clashData.clashes))) return;
      }
      ui.data = await api(`/api/shifts/${form.dataset.id}`, { method: "PATCH", body });
      const shift = ui.data.shifts.find((s) => s.id === form.dataset.id);
      ui.sheet = shift ? { type: "shift", shift, mode: "view" } : null;
      if (body.date) {
        ui.month = monthStart(body.date);
        ui.week = mondayOf(body.date);
      }
      showToast(t("save"));
      return;
    }
    if (form.dataset.form === "approve-join") {
      ui.data = await api(`/api/join-requests/${form.dataset.join}/approve`, {
        method: "POST",
        body: { ...body, elevated: Boolean(body.elevated) },
      });
      ui.sheet = null;
      showToast(t("approve"));
      return;
    }
    if (form.dataset.form === "stats-reset") {
      const day = clampResetDay(body.day);
      ui.resetDayDraft = day;
      ui.data = await api("/api/shop", { method: "PATCH", body: { statsResetDay: day } });
      ui.statsSel = null;
      ui.statsView = ui.data.stats;
      render();
      return;
    }
    if (form.dataset.form === "add-person") {
      ui.data = await api("/api/people", { method: "POST", body: { ...body, elevated: Boolean(body.elevated) } });
      ui.sheet = null;
      ui.tab = "people";
      if (String(body.email || "").trim()) showToast(t("inviteToast"));
      render();
      return;
    }
    if (form.dataset.form === "edit-person") {
      ui.data = await api(`/api/people/${form.dataset.id}`, { method: "PATCH", body: { ...body, elevated: Boolean(body.elevated) } });
      ui.sheet = null;
      render();
      return;
    }
    if (form.dataset.form === "shop-name") {
      ui.data = await api("/api/shop", { method: "PATCH", body: { name: body.name } });
      render();
      return;
    }
    if (form.dataset.form === "edit-cat") {
      ui.data = await api(`/api/categories/${form.dataset.id}`, { method: "PATCH", body: { name: body.name } });
      render();
      return;
    }
    if (form.dataset.form === "add-role") {
      ui.data = await api("/api/roles", { method: "POST", body: { name: body.name, elevated: Boolean(body.elevated) } });
      ui.addRoleElevated = false;
      render();
      return;
    }
    if (form.dataset.form === "edit-role") {
      ui.data = await api(`/api/roles/${form.dataset.id}`, {
        method: "PATCH",
        body: { name: body.name, elevated: Boolean(body.elevated) },
      });
      render();
    }
  } catch (error) {
    if (ui.screen === "app" && isGoneFromShop(error)) {
      await bounceFromShop(error);
      return;
    }
    ui.error = error.code || "server";
    render();
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const input = event.target.closest?.('[name="extraRole"]');
  if (!input) return;
  event.preventDefault();
  handle("create-person-role", input);
});

window.matchMedia("(min-width: 900px)").addEventListener("change", () => {
  if (ui.screen === "app") loadWeek();
});

boot();
