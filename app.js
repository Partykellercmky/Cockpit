"use strict";
/* Cockpit – persoenliches Dashboard. Feste Daten kommen aus data.json,
   alles Persoenliche (Aufgaben, Lernzeiten, Sparstand, Kalender-Adresse) bleibt im Browser. */

const $ = id => document.getElementById(id);
const DAY = 86400000;
const pad = n => String(n).padStart(2, "0");
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const euro = v => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: v % 1 ? 2 : 0 });
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fmtD = d => pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
const daysUntil = d => Math.round((sod(d) - sod(new Date())) / DAY);

/* Speicher (mit Absicherung, falls der Browser ihn blockiert) */
const store = {
  get(k, f) { try { const v = localStorage.getItem("cockpit." + k); return v == null ? f : JSON.parse(v); } catch { return f; } },
  set(k, v) { try { localStorage.setItem("cockpit." + k, JSON.stringify(v)); } catch {} }
};

let DATA = null;

/* ---------- Feiertage Niedersachsen ---------- */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function holidays(y) {
  const e = easter(y), add = n => ymd(new Date(e.getTime() + n * DAY));
  return {
    [y + "-01-01"]: "Neujahr", [add(-2)]: "Karfreitag", [add(1)]: "Ostermontag", [y + "-05-01"]: "Tag der Arbeit",
    [add(39)]: "Christi Himmelfahrt", [add(50)]: "Pfingstmontag", [y + "-10-03"]: "Tag der Deutschen Einheit",
    [y + "-10-31"]: "Reformationstag", [y + "-12-25"]: "1. Weihnachtstag", [y + "-12-26"]: "2. Weihnachtstag"
  };
}

/* ---------- Uhr und Tagesstatus ---------- */
function dur(ms) { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + " h " + pad(m % 60) + " min" : m + " min"; }
function dayStatus(now) {
  const hol = holidays(now.getFullYear())[ymd(now)];
  if (hol) return { text: "Feiertag · " + hol, free: true };
  const wd = now.getDay();
  if (wd === 0 || wd === 6) return { text: "Wochenende", free: true };
  const school = wd === 5;
  const [s, e] = school ? [8, 16] : [7, 15];
  const start = new Date(now); start.setHours(s, 0, 0, 0);
  const end = new Date(now); end.setHours(e, 0, 0, 0);
  const what = school ? "Berufsschule" : "Dienst";
  if (now < start) return { text: what + " ab " + pad(s) + ":00 · in " + dur(start - now) };
  if (now < end) return { text: what + " · noch " + dur(end - now) };
  return { text: what + " vorbei · Feierabend", free: true };
}
function greeting(h) { return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 17 ? "Guten Tag" : h < 22 ? "Guten Abend" : "Gute Nacht"; }

let lastDay = "";
function tick() {
  const now = new Date();
  $("clock").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
  $("date").textContent = WD_LONG[now.getDay()] + ", " + now.getDate() + ". " + MON[now.getMonth()] + " " + now.getFullYear();
  $("greet").textContent = greeting(now.getHours()) + (DATA ? ", " + DATA.name : "");
  const st = dayStatus(now);
  $("status").textContent = st.text;
  $("status").classList.toggle("free", !!st.free);
  if (DATA && ymd(now) !== lastDay) { lastDay = ymd(now); renderDaily(); }
}

/* ---------- Countdowns und Ausbildung ---------- */
const EXAM = ["klausur", "prüfung", "präsentation"];
function renderCountdowns() {
  const ul = $("countdowns"); ul.textContent = "";
  const list = DATA.countdowns.filter(c => daysUntil(new Date(c.datum)) >= 0)
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));
  if (!list.length) { ul.innerHTML = '<li class="empty">Keine anstehenden Termine</li>'; return; }
  for (const c of list) {
    const d = new Date(c.datum), n = daysUntil(d), exam = EXAM.includes((c.tag || "").toLowerCase());
    const li = document.createElement("li");
    if (exam && n <= 7) li.className = "crit"; else if (exam && n <= 21) li.className = "hot";
    li.innerHTML = '<div class="n"></div><div class="t"></div><div class="m"></div>';
    li.querySelector(".n").innerHTML = n === 0 ? "heute" : n + "<small>" + (n === 1 ? "TAG" : "TAGE") + "</small>";
    const t = li.querySelector(".t"); t.textContent = c.titel;
    const em = document.createElement("em"); em.textContent = c.tag || ""; t.append(em);
    const time = d.getHours() || d.getMinutes() ? " · " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + " Uhr" : "";
    li.querySelector(".m").textContent = WD[d.getDay()] + " " + fmtD(d) + time + (c.info ? " · " + c.info : "");
    ul.append(li);
  }
}
function renderDept() {
  const e = DATA.einsatz, s = new Date(e.start + "T00:00"), en = new Date(e.ende + "T23:59");
  const p = Math.min(1, Math.max(0, (Date.now() - s) / (en - s)));
  $("deptName").textContent = e.abteilung;
  $("deptBar").style.width = (p * 100).toFixed(1) + "%";
  const left = daysUntil(en);
  $("deptMeta").textContent = fmtD(s) + " bis " + fmtD(en) + " · " + (left > 0 ? "noch " + left + " Tage" : "beendet");
  $("deptNext").textContent = e.danach || "--";
  $("school").textContent = e.schule || "--";
  const next = DATA.countdowns.filter(c => EXAM.includes((c.tag || "").toLowerCase()) && daysUntil(new Date(c.datum)) >= 0)
    .sort((a, b) => new Date(a.datum) - new Date(b.datum))[0];
  $("nextExam").textContent = next ? next.titel + " · " + fmtD(new Date(next.datum)) : "keine";
}

/* ---------- Wetter (Open-Meteo, ohne Schluessel) ---------- */
const WMO = { 0: "klar", 1: "überw. klar", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel", 51: "leichter Niesel", 53: "Niesel", 55: "starker Niesel",
  56: "gefr. Niesel", 57: "gefr. Niesel", 61: "leichter Regen", 63: "Regen", 65: "starker Regen", 66: "gefr. Regen", 67: "gefr. Regen", 71: "leichter Schnee",
  73: "Schnee", 75: "starker Schnee", 77: "Schneegriesel", 80: "Schauer", 81: "Schauer", 82: "heftige Schauer", 85: "Schneeschauer", 86: "Schneeschauer",
  95: "Gewitter", 96: "Gewitter, Hagel", 99: "Gewitter, Hagel" };
async function loadWeather() {
  const o = DATA.ort;
  $("wxPlace").textContent = o.name;
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + o.lat + "&longitude=" + o.lon +
    "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FBerlin&forecast_days=5";
  try {
    const r = await fetch(url); if (!r.ok) throw 0;
    const w = await r.json(), c = w.current, d = w.daily;
    $("wxnow").textContent = Math.round(c.temperature_2m) + " °C, " + (WMO[c.weather_code] || "--") +
      " · gefühlt " + Math.round(c.apparent_temperature) + " °C · Wind " + Math.round(c.wind_speed_10m) + " km/h";
    const box = $("wxdays"); box.textContent = "";
    d.time.forEach((t, i) => {
      const dt = new Date(t + "T12:00"), rain = d.precipitation_probability_max[i] ?? 0;
      const el = document.createElement("div"); el.className = "wxd" + (rain >= 60 ? " wet" : "");
      el.innerHTML = "<b></b><span class=c></span><span class=hi></span><span class=lo></span><span class=r></span>";
      el.querySelector("b").textContent = i === 0 ? "Heute" : WD[dt.getDay()];
      el.querySelector(".c").textContent = WMO[d.weather_code[i]] || "";
      el.querySelector(".hi").textContent = Math.round(d.temperature_2m_max[i]) + "°";
      el.querySelector(".lo").textContent = Math.round(d.temperature_2m_min[i]) + "°";
      el.querySelector(".r").textContent = rain + " %";
      box.append(el);
    });
  } catch { $("wxnow").textContent = "Wetter gerade nicht verfügbar"; }
}

/* ---------- Kalender ---------- */
async function loadCalendar() {
  const key = store.get("calKey", ""), box = $("calendar"), k = DATA.kalender;
  const url = key && k ? k.url + "?token=" + encodeURIComponent(key) : "";
  if (!url) { box.innerHTML = '<p class="empty">Noch nicht verbunden. Den Kalender-Schlüssel trägst du unter Einstellungen ein.</p>'; $("calHint").textContent = ""; return; }
  try {
    const r = await fetch(url, { cache: "no-store", headers: { apikey: k.apikey } });
    if (r.status === 401) { box.innerHTML = '<p class="empty">Kalender-Schlüssel stimmt nicht. Bitte unter Einstellungen prüfen.</p>'; return; }
    if (!r.ok) throw 0;
    const raw = await r.json(); const evs = (Array.isArray(raw) ? raw : raw.events || [])
      .map(e => ({ title: e.title || e.summary || "(ohne Titel)", start: new Date(e.start), end: new Date(e.end || e.start), allDay: !!e.allDay }))
      .filter(e => e.end >= sod(new Date())).sort((a, b) => a.start - b.start);
    box.textContent = "";
    if (!evs.length) { box.innerHTML = '<p class="empty">Keine Termine in den nächsten Tagen.</p>'; return; }
    let cur = "";
    const today = sod(new Date());
    for (const e of evs.slice(0, 14)) {
      const day = e.start < today ? today : sod(e.start), key = ymd(day);
      if (key !== cur) {
        cur = key; const n = daysUntil(day);
        const h = document.createElement("p"); h.className = "calday";
        h.textContent = (n === 0 ? "Heute" : n === 1 ? "Morgen" : WD_LONG[day.getDay()]) + " · " + pad(day.getDate()) + "." + pad(day.getMonth() + 1) + ".";
        box.append(h);
      }
      const row = document.createElement("div"); row.className = "ev" + (!e.allDay && e.end < new Date() ? " past" : "");
      row.innerHTML = "<time></time><span></span>";
      row.querySelector("time").textContent = e.allDay ? "ganzt." : pad(e.start.getHours()) + ":" + pad(e.start.getMinutes());
      row.querySelector("span").textContent = e.title;
      box.append(row);
    }
    $("calHint").textContent = "aktualisiert " + pad(new Date().getHours()) + ":" + pad(new Date().getMinutes());
  } catch { box.innerHTML = '<p class="empty">Kalender gerade nicht erreichbar.</p>'; }
}

/* ---------- Aufgaben ---------- */
let tasks = store.get("tasks", []);
function saveTasks() { store.set("tasks", tasks); renderTasks(); }
function renderTasks() {
  const ul = $("tasks"); ul.textContent = "";
  if (!tasks.length) { ul.innerHTML = '<li class="empty">Nichts offen.</li>'; return; }
  tasks.forEach(t => {
    const li = document.createElement("li"); li.className = "task" + (t.done ? " done" : "");
    const id = "t" + t.id;
    li.innerHTML = '<input type="checkbox"><label></label><button class="x" type="button" aria-label="Löschen">×</button>';
    const cb = li.querySelector("input"); cb.id = id; cb.checked = t.done;
    const lb = li.querySelector("label"); lb.htmlFor = id; lb.textContent = t.text;
    cb.onchange = () => { t.done = cb.checked; saveTasks(); };
    li.querySelector(".x").onclick = () => { tasks = tasks.filter(x => x !== t); saveTasks(); };
    ul.append(li);
  });
}
$("taskForm").onsubmit = ev => {
  ev.preventDefault(); const v = $("taskInput").value.trim(); if (!v) return;
  tasks.push({ id: Date.now(), text: v, done: false }); $("taskInput").value = ""; saveTasks();
};
$("clearDone").onclick = () => { tasks = tasks.filter(t => !t.done); saveTasks(); };

/* ---------- Lern-Timer ---------- */
let timer = store.get("timer", null); // {endAt, len, subject, startedAt, brk, pausedLeft}
let sessions = store.get("sessions", []); // {d:"YYYY-MM-DD", min, s}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 660; g.gain.value = .08;
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .18); });
  } catch {}
}
function logSession(min, subject) {
  if (min < 1) return;
  sessions.push({ d: ymd(new Date()), min: Math.round(min), s: subject });
  store.set("sessions", sessions); renderStats();
}
function timerLeft() { if (!timer) return 0; return timer.pausedLeft != null ? timer.pausedLeft : Math.max(0, timer.endAt - Date.now()); }
function renderTimer() {
  const len = +$("tLen").value;
  const left = timer ? timerLeft() : len * 60000;
  const s = Math.ceil(left / 1000);
  $("tTime").textContent = pad(Math.floor(s / 60)) + ":" + pad(s % 60);
  const brk = timer ? timer.brk : len === 5;
  $("tTime").classList.toggle("brk", brk);
  if (!timer) { $("tPhase").textContent = "Bereit"; $("tStart").textContent = "Start"; }
  else if (timer.pausedLeft != null) { $("tPhase").textContent = "Pausiert · " + (brk ? "Pause" : timer.subject); $("tStart").textContent = "Weiter"; }
  else { $("tPhase").textContent = brk ? "Pause" : "Fokus · " + timer.subject; $("tStart").textContent = "Pausieren"; }
  document.title = timer && timer.pausedLeft == null ? $("tTime").textContent + " · Cockpit" : "Cockpit";
  if (timer && timer.pausedLeft == null && left <= 0) finishTimer(true);
}
function finishTimer(completed) {
  if (!timer) return;
  const worked = timer.len - timerLeft() / 60000;
  if (!timer.brk) logSession(completed ? timer.len : worked, timer.subject);
  if (completed) beep();
  timer = null; store.set("timer", null); renderTimer();
}
$("tStart").onclick = () => {
  if (!timer) {
    const len = +$("tLen").value;
    timer = { len, endAt: Date.now() + len * 60000, subject: $("tSubject").value, brk: len === 5, pausedLeft: null };
  } else if (timer.pausedLeft != null) { timer.endAt = Date.now() + timer.pausedLeft; timer.pausedLeft = null; }
  else { timer.pausedLeft = timerLeft(); }
  store.set("timer", timer); renderTimer();
};
$("tStop").onclick = () => finishTimer(false);
$("tLen").onchange = () => { if (!timer) renderTimer(); };
$("tSubject").onchange = () => store.set("lastSubject", $("tSubject").value);

function weekStart(d) { const x = sod(d), wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * DAY); }
function renderStats() {
  const today = ymd(new Date()), ws = ymd(weekStart(new Date()));
  const sum = arr => arr.reduce((a, b) => a + b.min, 0);
  const fmt = m => m >= 60 ? Math.floor(m / 60) + " h " + pad(m % 60) + " min" : m + " min";
  $("sToday").textContent = fmt(sum(sessions.filter(s => s.d === today)));
  const week = sessions.filter(s => s.d >= ws);
  $("sWeek").textContent = fmt(sum(week));
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * DAY); return { d, m: sum(sessions.filter(s => s.d === ymd(d))) }; });
  const max = Math.max(30, ...days.map(x => x.m));
  $("sBars").innerHTML = days.map(x => '<div title="' + x.m + ' min"><i class="' + (x.m ? "on" : "") + '" style="height:' + Math.max(3, x.m / max * 100) + '%"></i><span>' + WD[x.d.getDay()] + "</span></div>").join("");
  const by = {}; week.forEach(s => by[s.s] = (by[s.s] || 0) + s.min);
  const ul = $("sBySub"); ul.textContent = "";
  Object.entries(by).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const li = document.createElement("li"); li.innerHTML = "<span></span><b></b>";
    li.querySelector("span").textContent = k; li.querySelector("b").textContent = fmt(v); ul.append(li);
  });
}

/* ---------- Sparziel ---------- */
let saved = store.get("saved", 0);
function renderSaving() {
  const z = DATA.sparziel, goal = z.ziel, bis = new Date(z.bis + "T23:59");
  $("saveTitle").textContent = z.titel;
  $("saveNow").textContent = euro(saved);
  $("saveGoal").textContent = "von " + euro(goal);
  $("saveBar").style.width = Math.min(100, saved / goal * 100).toFixed(1) + "%";
  const rest = Math.max(0, goal - saved), now = new Date();
  let months = (bis.getFullYear() - now.getFullYear()) * 12 + (bis.getMonth() - now.getMonth()) + 1;
  months = Math.max(1, months);
  $("saveMeta").textContent = rest <= 0 ? "Ziel erreicht." :
    "Noch " + euro(rest) + " bis " + fmtD(bis) + " · etwa " + euro(Math.ceil(rest / months)) + " pro Monat (" + months + " Monate)";
}
$("saveForm").onsubmit = ev => {
  ev.preventDefault(); const v = parseFloat($("saveInput").value); if (isNaN(v)) return;
  saved = Math.round((saved + v) * 100) / 100; store.set("saved", saved); $("saveInput").value = ""; renderSaving();
};
$("saveSet").onclick = () => {
  const v = parseFloat($("saveInput").value); if (isNaN(v)) return;
  saved = Math.round(v * 100) / 100; store.set("saved", saved); $("saveInput").value = ""; renderSaving();
};

/* ---------- Einstellungen und Sicherung ---------- */
$("openSettings").onclick = () => { $("calKey").value = store.get("calKey", ""); $("settings").showModal(); };
$("saveSettings").onclick = () => { store.set("calKey", $("calKey").value.trim()); loadCalendar(); };
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ tasks, sessions, saved, calKey: store.get("calKey", "") }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cockpit-sicherung-" + ymd(new Date()) + ".json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("importFile").onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (Array.isArray(d.tasks)) { tasks = d.tasks; store.set("tasks", tasks); }
    if (Array.isArray(d.sessions)) { sessions = d.sessions; store.set("sessions", sessions); }
    if (typeof d.saved === "number") { saved = d.saved; store.set("saved", saved); }
    if (typeof d.calKey === "string") store.set("calKey", d.calKey);
    renderTasks(); renderStats(); renderSaving(); loadCalendar();
    $("footInfo").textContent = "Sicherung geladen";
  } catch { $("footInfo").textContent = "Sicherung konnte nicht gelesen werden"; }
};

/* ---------- Start ---------- */
function renderDaily() { renderCountdowns(); renderDept(); renderSaving(); renderStats(); }

async function init() {
  try { const r = await fetch("data.json", { cache: "no-cache" }); DATA = await r.json(); }
  catch { $("footInfo").textContent = "data.json konnte nicht geladen werden"; return; }
  const sel = $("tSubject");
  DATA.faecher.forEach(f => { const o = document.createElement("option"); o.textContent = f; sel.append(o); });
  sel.value = store.get("lastSubject", DATA.faecher[0]);
  if (timer) { sel.value = timer.subject; $("tLen").value = String(timer.len); }
  renderTasks(); tick(); renderTimer();
  loadWeather(); loadCalendar();
  setInterval(tick, 1000);
  setInterval(renderTimer, 1000);
  setInterval(loadWeather, 30 * 60000);
  setInterval(loadCalendar, 10 * 60000);
  $("footInfo").textContent = "Cockpit · Stand " + fmtD(new Date());
}
init();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
