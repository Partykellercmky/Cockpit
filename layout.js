"use strict";
/* Cockpit – Bereiche (Tabs) und Heute-Leiste */

const TABS = {
  heute:  [["termine", "countdowns"], ["aufgaben", "notiz"], ["spotify", "wetter"]],
  schule: [["countdowns", "ausbildung"], ["lernplan", "noten"], ["timer"]],
  privat: [["sparziele"], ["serien", "mac"], ["spotify", "notiz"]]
};
let ALL = null; // urspruengliche Anordnung fuer "Alle"

function cardEl(id) { return document.querySelector('.card[data-id="' + id + '"]'); }
function setTab(tab) {
  if (!TABS[tab] && tab !== "alle") tab = "heute";
  if (typeof closeExpanded === "function") closeExpanded();
  const cols = [...document.querySelectorAll("#grid > .col")];
  const layout = tab === "alle" ? ALL : TABS[tab];
  const used = new Set(layout.flat());
  // nicht benoetigte Kacheln in den Abstellbereich, benoetigte in ihre Spalte
  document.querySelectorAll("#grid .card").forEach(c => { if (!used.has(c.dataset.id)) $("parking").append(c); });
  layout.forEach((ids, i) => ids.forEach(id => { const c = cardEl(id); if (c) cols[i].append(c); }));
  document.querySelectorAll("#tabs [data-tab]").forEach(b => {
    const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.body.dataset.tab = tab;
  store.set("tab", tab);
  if (DATA && (tab === "alle" || tab === "heute")) loadCalendar();
}

function chip(label, value, cls, onClick) {
  const b = document.createElement("button"); b.type = "button"; b.className = "chip " + (cls || "");
  b.innerHTML = "<span></span><b></b>"; b.querySelector("span").textContent = label; b.querySelector("b").textContent = value;
  if (onClick) b.onclick = onClick; else b.disabled = true;
  return b;
}
function renderToday() {
  const bar = $("todayBar"); if (!bar || !DATA) return;
  bar.textContent = "";
  const now = new Date();
  // naechster Termin (heute oder morgen)
  const evs = (window.calEvents || []).filter(e => e.allDay ? sod(e.end) > sod(now) : e.end > now);
  const nx = evs.find(e => !e.allDay && e.start >= new Date(now.getTime() - 3600000)) || evs[0];
  if (nx) {
    const n = daysUntil(nx.start < now ? now : nx.start);
    const when = nx.allDay ? (n <= 0 ? "heute" : n === 1 ? "morgen" : WD[nx.start.getDay()]) :
      (n <= 0 ? "" : n === 1 ? "morgen " : WD[nx.start.getDay()] + " ") + pad(nx.start.getHours()) + ":" + pad(nx.start.getMinutes());
    bar.append(chip("Nächster Termin", (when ? when + " · " : "") + nx.title, n <= 0 ? "hot" : "", () => setTab("heute")));
  }
  // naechste Pruefung
  const ex = DATA.countdowns.filter(c => EXAM.includes((c.tag || "").toLowerCase()) && daysUntil(new Date(c.datum)) >= 0)
    .sort((a, b) => new Date(a.datum) - new Date(b.datum))[0];
  if (ex) { const n = daysUntil(new Date(ex.datum)); bar.append(chip("Nächste Prüfung", ex.titel + " · " + (n === 0 ? "heute" : n === 1 ? "morgen" : "in " + n + " Tagen"), n <= 7 ? "crit" : n <= 21 ? "hot" : "", () => setTab("schule"))); }
  // offene Aufgaben
  const open = tasks.filter(t => !t.done).length;
  bar.append(chip("Aufgaben", open ? open + " offen" : "alles erledigt", open ? "" : "ok", () => setTab("heute")));
  // Lernzeit heute
  const m = sessions.filter(s => s.d === ymd(now)).reduce((a, s) => a + s.min, 0);
  bar.append(chip("Gelernt heute", m >= 60 ? Math.floor(m / 60) + " h " + pad(m % 60) + " min" : m + " min", m ? "ok" : "", () => setTab("schule")));
  // laufender Song
  const cur = window.spCur;
  if (cur && cur.item && cur.is_playing) {
    bar.append(chip("Läuft", cur.item.name + (cur.item.artists ? " · " + cur.item.artists[0].name : ""), "music", () => $("spBig").click()));
  }
}

(function setupLayout() {
  const park = document.createElement("div"); park.id = "parking"; park.hidden = true; document.body.append(park);
  ALL = [...document.querySelectorAll("#grid > .col")].map(col => [...col.querySelectorAll(":scope > .card")].map(c => c.dataset.id));
  document.querySelectorAll("#tabs [data-tab]").forEach(b => b.onclick = () => setTab(b.dataset.tab));
  setTab(store.get("tab", "heute"));
  // Heute-Leiste regelmaessig und bei Aenderungen aktualisieren
  const wait = setInterval(() => { if (DATA) { clearInterval(wait); renderToday(); } }, 200);
  setInterval(renderToday, 30000);
  ["taskForm", "tasks"].forEach(id => $(id) && $(id).addEventListener("change", () => setTimeout(renderToday, 50)));
  $("taskForm").addEventListener("submit", () => setTimeout(renderToday, 50));
  $("tasks").addEventListener("click", () => setTimeout(renderToday, 50));
})();
