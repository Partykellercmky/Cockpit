"use strict";
/* Cockpit – Zusatzmodule: Lernplan, Noten, Serien, Spotify.
   Nutzt die Hilfsfunktionen aus app.js ($, store, DATA, sessions, ...). */

/* ---------- Lernplan ---------- */
function renderPlan() {
  const ul = $("plan"); ul.textContent = "";
  const goals = store.get("planGoals", {});
  const list = DATA.countdowns.filter(c => c.fach && c.lernziel && daysUntil(new Date(c.datum)) >= 0)
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));
  if (!list.length) { ul.innerHTML = '<li class="empty">Keine Prüfung mit Lernziel geplant.</li>'; return; }
  const fmt = x => { const m = Math.round(x); return m >= 60 ? Math.floor(m / 60) + " h " + pad(m % 60) : m + " min"; };
  for (const c of list) {
    const exam = new Date(c.datum);
    const start = c.lernstart ? new Date(c.lernstart + "T00:00") : new Date(sod(exam).getTime() - 28 * DAY);
    const goalH = goals[c.titel] ?? c.lernziel;
    const done = sessions.filter(s => s.s === c.fach && s.d >= ymd(start) && s.d <= ymd(exam)).reduce((a, s) => a + s.min, 0);
    const total = Math.max(1, (sod(exam) - start) / DAY), passed = Math.min(total, Math.max(0, (sod(new Date()) - start) / DAY + 1));
    const should = goalH * 60 * passed / total, pct = Math.min(100, done / (goalH * 60) * 100);
    const started = new Date() >= start;
    let state;
    if (done >= goalH * 60) state = "Ziel erreicht";
    else if (!started) state = "Start am " + fmtD(start);
    else if (done >= should - 15) state = "im Plan";
    else state = fmt(should - done) + " Rückstand";
    const li = document.createElement("li");
    li.className = done < should - 15 && started && done < goalH * 60 ? "behind" : "";
    li.innerHTML = '<div class="gring"></div><div class="gbody"><div class="pt"><span class="pn"></span><span class="pv"></span></div>' +
      '<div class="pm"><span class="ps"></span><label class="pg">Ziel <input type="number" min="1" max="200" step="1"> h</label></div></div>';
    li.querySelector(".pn").textContent = c.titel;
    li.querySelector(".pv").textContent = fmt(done) + " von " + goalH + " h";
    li.querySelector(".gring").innerHTML = ring(pct, 52, Math.round(pct) + "%", li.className.includes("behind") ? "warn" : pct >= 100 ? "done" : "");
    li.querySelector(".ps").textContent = state + " · noch " + daysUntil(exam) + " Tage · Fach " + c.fach;
    const inp = li.querySelector("input"); inp.value = goalH; inp.setAttribute("aria-label", "Lernziel " + c.titel);
    inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) { goals[c.titel] = v; store.set("planGoals", goals); renderPlan(); } };
    ul.append(li);
  }
}

/* ---------- Noten ---------- */
let grades = store.get("grades", []);
const deNum = v => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function renderGrades() {
  const goal = DATA.notenziel || 2.5;
  $("gradeGoal").textContent = "Ziel " + goal.toLocaleString("de-DE");
  const dl = $("subjectList"); dl.textContent = "";
  [...new Set([...DATA.faecher.filter(f => f !== "Sonstiges" && f !== "Zwischenprüfung"), ...grades.map(g => g.fach)])]
    .forEach(f => { const o = document.createElement("option"); o.value = f; dl.append(o); });
  const by = $("gradeBySub"), list = $("gradeList"); by.textContent = ""; list.textContent = "";
  if (!grades.length) { $("gradeAvg").textContent = "--"; $("gradeMeta").textContent = "Noch keine Noten"; $("gradeAvg").className = ""; return; }
  // Schnitt: erst je Fach mitteln, dann ueber die Faecher
  const perSub = {};
  grades.forEach(g => (perSub[g.fach] = perSub[g.fach] || []).push(g.note));
  const subAvg = Object.entries(perSub).map(([f, n]) => [f, n.reduce((a, b) => a + b, 0) / n.length]);
  const avg = subAvg.reduce((a, [, v]) => a + v, 0) / subAvg.length;
  $("gradeAvg").textContent = deNum(avg);
  $("gradeAvg").className = avg <= goal ? "good" : "bad";
  const diff = Math.abs(goal - avg);
  $("gradeMeta").textContent = avg <= goal ? (diff < 0.005 ? "genau im Ziel" : deNum(diff) + " besser als dein Ziel") : deNum(diff) + " über deinem Ziel";
  subAvg.sort((a, b) => a[0].localeCompare(b[0])).forEach(([f, v]) => {
    const li = document.createElement("li"); li.innerHTML = "<span></span><b></b>";
    li.querySelector("span").textContent = f + " (" + perSub[f].length + ")"; li.querySelector("b").textContent = deNum(v); by.append(li);
  });
  grades.slice(-5).reverse().forEach(g => {
    const li = document.createElement("li"); li.innerHTML = '<span></span><b></b><button class="x" type="button" aria-label="Note löschen">×</button>';
    li.querySelector("span").textContent = g.fach + " · " + fmtD(new Date(g.datum));
    li.querySelector("b").textContent = g.note.toLocaleString("de-DE", { minimumFractionDigits: 1 });
    li.querySelector(".x").onclick = () => { grades = grades.filter(x => x !== g); store.set("grades", grades); renderGrades(); };
    list.append(li);
  });
}
$("gradeForm").onsubmit = ev => {
  ev.preventDefault();
  const f = $("gradeSubject").value.trim(), n = parseFloat(String($("gradeValue").value).replace(",", "."));
  if (!f || !(n >= 1 && n <= 6)) return;
  grades.push({ id: Date.now(), fach: f, note: Math.round(n * 10) / 10, datum: ymd(new Date()) });
  store.set("grades", grades); $("gradeValue").value = ""; renderGrades();
};

/* ---------- Serien (TVmaze, kostenlos) ---------- */
let seriesList = store.get("series", null);
async function tvSearch(name) {
  const r = await fetch("https://api.tvmaze.com/singlesearch/shows?q=" + encodeURIComponent(name));
  if (!r.ok) return null;
  const s = await r.json(); return { id: s.id, name: s.name };
}
async function loadSeries() {
  const ul = $("series");
  try {
    if (!seriesList) {
      seriesList = (await Promise.all((DATA.serien || []).map(tvSearch))).filter(Boolean);
      store.set("series", seriesList);
    }
    if (!seriesList.length) { ul.innerHTML = '<li class="empty">Noch keine Serien.</li>'; return; }
    const cache = store.get("seriesCache", {});
    const fresh = cache.t && Date.now() - cache.t < 6 * 3600000 && cache.ids === seriesList.map(s => s.id).join(",");
    let info = fresh ? cache.data : null;
    if (!info) {
      info = await Promise.all(seriesList.map(async s => {
        const r = await fetch("https://api.tvmaze.com/shows/" + s.id + "?embed[]=nextepisode&embed[]=previousepisode");
        if (!r.ok) return { id: s.id, name: s.name };
        const j = await r.json(), e = j._embedded || {};
        const ep = x => x ? { s: x.season, n: x.number, name: x.name, at: x.airstamp || x.airdate } : null;
        return { id: s.id, name: j.name, status: j.status, next: ep(e.nextepisode), prev: ep(e.previousepisode) };
      }));
      store.set("seriesCache", { t: Date.now(), ids: seriesList.map(s => s.id).join(","), data: info });
    }
    info.sort((a, b) => (a.next ? new Date(a.next.at) : Infinity) - (b.next ? new Date(b.next.at) : Infinity));
    ul.textContent = "";
    const code = e => "S" + pad(e.s) + "E" + pad(e.n);
    for (const x of info) {
      const li = document.createElement("li");
      li.innerHTML = '<div><span class="sn"></span><span class="sm"></span></div><span class="sd"></span><button class="x" type="button" aria-label="Serie entfernen">×</button>';
      li.querySelector(".sn").textContent = x.name;
      if (x.next) {
        const d = new Date(x.next.at), n = daysUntil(d);
        li.querySelector(".sd").textContent = n === 0 ? "heute" : n === 1 ? "morgen" : n < 7 ? WD[d.getDay()] + " " + pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." : "in " + n + " Tagen";
        li.querySelector(".sm").textContent = code(x.next) + (x.next.name && !/^Episode \d+$/.test(x.next.name) ? " · " + x.next.name : "");
        if (n <= 1) li.classList.add("soon");
      } else {
        li.querySelector(".sd").textContent = x.status === "Ended" ? "beendet" : "kein Termin";
        li.querySelector(".sm").textContent = x.prev ? "zuletzt " + code(x.prev) + " am " + fmtD(new Date(x.prev.at)) : "";
        li.classList.add("quiet");
      }
      li.querySelector(".x").onclick = () => { seriesList = seriesList.filter(s => s.id !== x.id); store.set("series", seriesList); loadSeries(); };
      ul.append(li);
    }
  } catch { ul.innerHTML = '<li class="empty">Serien gerade nicht erreichbar.</li>'; }
}
$("seriesForm").onsubmit = async ev => {
  ev.preventDefault(); const v = $("seriesInput").value.trim(); if (!v) return;
  const s = await tvSearch(v).catch(() => null);
  if (!s) { $("seriesInput").value = ""; $("seriesInput").placeholder = "Nicht gefunden"; return; }
  if (!seriesList.some(x => x.id === s.id)) { seriesList.push(s); store.set("series", seriesList); }
  $("seriesInput").value = ""; $("seriesInput").placeholder = "Serie hinzufügen"; loadSeries();
};

/* ---------- Spotify ---------- */
const SP = {
  get clientId() { return (DATA.spotify || {}).clientId || ""; },
  token: null, exp: 0, busy: false, extrasAt: 0, extras: null, pauseUntil: 0, startedAt: 0, retryT: null,
  async refresh() {
    const rt = store.get("spRefresh", "");
    if (!rt || !this.clientId) return false;
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: this.clientId })
    });
    if (!r.ok) { if (r.status === 400) store.set("spRefresh", ""); return false; }
    const j = await r.json();
    this.token = j.access_token; this.exp = Date.now() + (j.expires_in - 60) * 1000;
    if (j.refresh_token) store.set("spRefresh", j.refresh_token);
    return true;
  },
  async api(path, opt = {}) {
    if (!this.token || Date.now() > this.exp) { if (!(await this.refresh())) throw new Error("auth"); }
    const r = await fetch("https://api.spotify.com/v1" + path, { ...opt, headers: { Authorization: "Bearer " + this.token, ...(opt.headers || {}) } });
    if (r.status === 401) { this.token = null; throw new Error("auth"); }
    return r;
  }
};
function spMsg(html) { $("spotify").innerHTML = '<p class="empty">' + html + "</p>"; }
async function loadSpotify(force) {
  if (!SP.clientId) { spMsg("Noch nicht eingerichtet."); return; }
  if (!store.get("spRefresh", "")) { spMsg('Nicht verbunden. Unter Einstellungen auf „Mit Spotify verbinden“ klicken.'); return; }
  if (document.hidden && !force) return;
  // Nach "zu viele Anfragen" (429) wartet Cockpit so lange, wie Spotify es verlangt
  if (Date.now() < SP.pauseUntil) return;
  try {
    const r = await SP.api("/me/player?additional_types=episode");
    if (r.status === 429) {
      SP.pauseUntil = Date.now() + Math.min(60, Number(r.headers.get("Retry-After")) || 5) * 1000;
      return; // letzten Stand stehen lassen statt "läuft nichts"
    }
    if (r.status !== 200 && r.status !== 204) return; // kurzer Spotify-Fehler: letzten Stand behalten
    const cur = r.status === 200 ? await r.json() : null;
    // Direkt nach dem Starten meldet Spotify oft noch kurz "nichts aktiv". Dann gleich nochmal fragen.
    if ((!cur || !cur.item) && Date.now() - SP.startedAt < 10000) {
      clearTimeout(SP.retryT); SP.retryT = setTimeout(() => loadSpotify(true), 1000);
      return;
    }
    if (!SP.extras || Date.now() - SP.extrasAt > 10 * 60000) {
      const [rec, top] = await Promise.all([
        SP.api("/me/player/recently-played?limit=4").then(x => x.ok ? x.json() : null),
        SP.api("/me/top/artists?limit=5&time_range=short_term").then(x => x.ok ? x.json() : null)
      ]);
      SP.extras = { rec: rec ? rec.items : [], top: top ? top.items : [] }; SP.extrasAt = Date.now();
    }
    renderSpotify(cur);
    if ($("spDialog").open) renderBig(cur);
  } catch (e) {
    if (String(e.message) === "auth") spMsg("Verbindung abgelaufen. Bitte unter Einstellungen neu verbinden.");
    else spMsg("Spotify gerade nicht erreichbar.");
  }
}
function renderSpotify(cur) {
  window.spCur = cur; if (typeof renderToday === "function") renderToday();
  const box = $("spotify"); box.textContent = "";
  const item = cur && cur.item;
  const now = document.createElement("div"); now.className = "spnow";
  if (item) {
    const img = (item.album ? item.album.images : item.images || []).slice(-2)[0];
    now.innerHTML = '<img alt=""><div class="spt"><b></b><span></span><div class="bar"><i></i></div><span class="sptime"></span></div>';
    if (img) now.querySelector("img").src = img.url; else now.querySelector("img").remove();
    now.querySelector("b").textContent = item.name;
    now.querySelector("span").textContent = item.artists ? item.artists.map(a => a.name).join(", ") : (item.show ? item.show.name : "");
    now.querySelector(".bar i").style.width = (cur.progress_ms / item.duration_ms * 100).toFixed(1) + "%";
    const t = ms => Math.floor(ms / 60000) + ":" + pad(Math.floor(ms / 1000) % 60);
    now.querySelector(".sptime").textContent = t(cur.progress_ms) + " / " + t(item.duration_ms) + (cur.device ? " · " + cur.device.name : "");
    $("spHint").textContent = cur.is_playing ? "läuft" : "pausiert";
  } else {
    now.innerHTML = '<p class="empty">Gerade läuft nichts.</p>';
    $("spHint").textContent = "";
  }
  now.title = "Groß öffnen"; now.onclick = () => $("spBig").click();
  box.append(now);
  const ctl = document.createElement("div"); ctl.className = "trow spctl";
  const playing = cur && cur.is_playing;
  [["Zurück", "POST", "/me/player/previous"], [playing ? "Pause" : "Abspielen", "PUT", playing ? "/me/player/pause" : "/me/player/play"], ["Weiter", "POST", "/me/player/next"]]
    .forEach(([label, method, path], i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn" + (i === 1 ? " primary" : ""); b.textContent = label;
      b.onclick = async () => {
        try {
          const r = await SP.api(path, { method });
          if (r.status === 404) { $("spHint").textContent = "kein aktives Gerät"; return; }
        } catch {}
        setTimeout(() => loadSpotify(true), 400);
      };
      ctl.append(b);
    });
  box.append(ctl);
  const ex = SP.extras || { rec: [], top: [] };
  if (ex.rec.length || ex.top.length) {
    const more = document.createElement("div"); more.className = "spmore";
    more.innerHTML = '<div><p class="calday">Zuletzt gehört</p><ul class="splist rec"></ul></div><div><p class="calday">Top-Künstler 4 Wochen</p><ol class="splist top"></ol></div>';
    ex.rec.forEach(x => { const li = document.createElement("li"); li.textContent = x.track.name + " · " + x.track.artists[0].name; more.querySelector(".rec").append(li); });
    ex.top.forEach(a => { const li = document.createElement("li"); li.textContent = a.name; more.querySelector(".top").append(li); });
    box.append(more);
  }
}
$("spCode").addEventListener("change", () => {
  const v = $("spCode").value.trim();
  if (v) { store.set("spRefresh", v); SP.token = null; SP.extras = null; $("spCode").value = ""; $("spCode").placeholder = "Code gespeichert"; loadSpotify(true); }
});

/* ---------- Spotify gross: Player und Playlists ---------- */
const tfmt = ms => Math.floor(ms / 60000) + ":" + pad(Math.floor(ms / 1000) % 60);
let bigState = null, bigTick = null, curPlaylist = null;
function renderBig(cur) {
  bigState = cur;
  const item = cur && cur.item;
  if (!item) {
    $("bName").textContent = "Gerade läuft nichts"; $("bArtist").textContent = "Wähle rechts eine Playlist."; $("bCover").removeAttribute("src");
    $("bBar").style.width = "0"; $("bPos").textContent = "0:00"; $("bDur").textContent = "0:00"; $("bDev").textContent = "";
    $("bPlay").textContent = "Abspielen"; return;
  }
  const imgs = item.album ? item.album.images : item.images || [];
  if (imgs[0] && $("bCover").src !== imgs[0].url) $("bCover").src = imgs[0].url;
  $("bName").textContent = item.name;
  $("bArtist").textContent = item.artists ? item.artists.map(a => a.name).join(", ") : (item.show ? item.show.name : "");
  $("bDur").textContent = tfmt(item.duration_ms);
  $("bDev").textContent = cur.device ? cur.device.name : "";
  $("bPlay").textContent = cur.is_playing ? "Pause" : "Abspielen";
  $("bShuffle").setAttribute("aria-pressed", cur.shuffle_state ? "true" : "false");
  cur._at = Date.now();
  bigProgress();
}
function bigProgress() {
  const c = bigState; if (!c || !c.item) return;
  const pos = Math.min(c.item.duration_ms, c.progress_ms + (c.is_playing ? Date.now() - c._at : 0));
  $("bBar").style.width = (pos / c.item.duration_ms * 100).toFixed(2) + "%";
  $("bPos").textContent = tfmt(pos);
}
// Geraet zum Abspielen waehlen: aktives Geraet, sonst bevorzugt der Mac (Computer), sonst das erste
async function spPickDevice() {
  const d = await SP.api("/me/player/devices").then(x => x.ok ? x.json() : { devices: [] }).catch(() => ({ devices: [] }));
  const list = (d.devices || []).filter(x => x.id && !x.is_restricted);
  return list.find(x => x.is_active) || list.find(x => x.type === "Computer") || list[0] || null;
}
const spErr = async r => { try { const j = await r.json(); return (j.error && (j.error.reason || j.error.message)) || ""; } catch { return ""; } };
// Wartet bis zu 5 Sekunden, ob Spotify wirklich spielt
async function spWaitPlaying() {
  for (let i = 0; i < 10; i++) {
    await new Promise(ok => setTimeout(ok, 500));
    try {
      const c = await SP.api("/me/player");
      const j = c.status === 200 ? await c.json() : null;
      if (j && j.is_playing && j.item) return j;
    } catch {}
  }
  return null;
}
// Spielt ab, immer gezielt auf einem Geraet. Startet nichts, wird der naechste Weg (Ausweichplan) probiert.
async function spPlay(body, ...fallbacks) {
  const msg = t => { $("bMsg").textContent = t; };
  msg("Starte ...");
  try {
    const dev = await spPickDevice();
    if (!dev) { msg("Kein Spotify-Gerät gefunden. Öffne die Spotify-App auf dem Mac und versuche es nochmal."); return; }
    const tries = [body || {}, ...fallbacks];
    for (let k = 0; k < tries.length; k++) {
      const r = await SP.api("/me/player/play?device_id=" + encodeURIComponent(dev.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tries[k]) });
      if (!(r.ok || r.status === 204)) {
        const why = await spErr(r);
        if (k < tries.length - 1 && r.status !== 429 && why !== "PREMIUM_REQUIRED") continue;
        msg(r.status === 429 ? "Spotify bremst gerade, bitte kurz warten."
          : why === "PREMIUM_REQUIRED" ? "Steuern geht nur mit Spotify Premium."
          : "Abspielen nicht möglich (" + r.status + (why ? ", " + why : "") + ").");
        return;
      }
      SP.startedAt = Date.now(); SP.pauseUntil = 0;
      msg("Spielt auf " + dev.name + " ...");
      const j = await spWaitPlaying();
      if (j) {
        if (tries[k].note) store.set("spDirect", k > 0); // merken, welcher Weg auf diesem Mac klappt
        msg(k > 0 && tries[k].note ? tries[k].note : "");
        renderSpotify(j); if ($("spDialog").open) renderBig(j);
        return;
      }
    }
    msg("Spotify hat den Befehl angenommen, aber auf „" + dev.name + "“ startet nichts. Starte in der Spotify-App auf dem Mac einmal kurz einen Song und versuche es dann nochmal.");
  } catch (e) {
    msg(String(e.message) === "auth" ? "Verbindung abgelaufen. Bitte unter Einstellungen neu verbinden." : "Spotify nicht erreichbar (" + e.message + ").");
  }
}
async function spCmd(method, path) {
  let r;
  try { r = await SP.api(path, { method }); } catch (e) { $("bMsg").textContent = "Spotify nicht erreichbar (" + e.message + ")."; return; }
  if (r.status === 404) $("bMsg").textContent = "Kein aktives Gerät. Starte zuerst eine Playlist.";
  else if (!(r.ok || r.status === 204)) $("bMsg").textContent = "Befehl nicht möglich (" + r.status + ").";
  else $("bMsg").textContent = "";
  setTimeout(() => loadSpotify(true), 400);
}
$("bPlay").onclick = () => bigState && bigState.is_playing ? spCmd("PUT", "/me/player/pause") : spPlay();
$("bPrev").onclick = () => spCmd("POST", "/me/player/previous");
$("bNext").onclick = () => spCmd("POST", "/me/player/next");
$("bShuffle").onclick = () => spCmd("PUT", "/me/player/shuffle?state=" + !(bigState && bigState.shuffle_state));

function listMsg(t) { $("bList").innerHTML = '<li class="empty"></li>'; $("bList").firstChild.textContent = t; }
async function showPlaylists() {
  curPlaylist = null;
  $("bListTitle").textContent = "Deine Playlists"; $("bBack").hidden = true; $("bPlayAll").hidden = true; $("bSortRow").hidden = true; plRows = [];
  listMsg("Lädt ...");
  try {
    const r = await SP.api("/me/playlists?limit=50");
    if (r.status === 403 || r.status === 401) { listMsg("Für Playlists bitte Spotify einmal neu verbinden (Einstellungen > Mit Spotify verbinden)."); return; }
    const j = await r.json(), ul = $("bList"); ul.textContent = "";
    for (const pl of j.items.filter(Boolean)) {
      const li = document.createElement("li"); li.className = "bpl";
      li.innerHTML = '<img alt=""><div><b></b><span></span></div>';
      const img = (pl.images || []).slice(-1)[0]; if (img) li.querySelector("img").src = img.url; else li.querySelector("img").remove();
      li.querySelector("b").textContent = pl.name;
      const n = (pl.items || pl.tracks || {}).total;
      li.querySelector("span").textContent = (pl.owner && pl.owner.display_name ? pl.owner.display_name : "") + (n != null ? " · " + n + " Songs" : "");
      li.tabIndex = 0; li.setAttribute("role", "button");
      li.onclick = () => showPlaylist(pl);
      li.onkeydown = e => { if (e.key === "Enter") showPlaylist(pl); };
      ul.append(li);
    }
    if (!j.items.length) listMsg("Keine Playlists gefunden.");
  } catch { listMsg("Playlists gerade nicht erreichbar."); }
}
let plRows = [];
async function showPlaylist(pl) {
  curPlaylist = pl; plRows = [];
  $("bListTitle").textContent = pl.name; $("bBack").hidden = false; $("bPlayAll").hidden = false; $("bSortRow").hidden = false;
  listMsg("Lädt ...");
  try {
    // alle Seiten laden (je 50 Eintraege), bis Spotify keine weitere Seite mehr meldet
    let url = "/playlists/" + pl.id + "/items?limit=50&market=from_token", rows = [];
    for (let i = 0; url && i < 100; i++) {
      const r = await SP.api(url);
      if (r.status === 429) { // Spotify bremst: kurz warten und dieselbe Seite nochmal
        await new Promise(ok => setTimeout(ok, Math.min(10, Number(r.headers.get("Retry-After")) || 2) * 1000));
        i--; continue;
      }
      if (!r.ok) break;
      const j = await r.json();
      rows = rows.concat(j.items || []);
      url = j.next ? j.next.replace("https://api.spotify.com/v1", "") : null;
      if (i % 4 === 3) listMsg("Lädt ... " + rows.length + " Songs");
    }
    plRows = rows.map((x, pos) => ({ t: x.item || x.track, added: x.added_at || "", pos })).filter(x => x.t && x.t.uri);
    renderPlaylistRows();
  } catch { listMsg("Songs gerade nicht erreichbar."); }
}
const SORTS = {
  orig: (a, b) => a.pos - b.pos,
  added: (a, b) => (b.added > a.added ? 1 : b.added < a.added ? -1 : b.pos - a.pos),
  title: (a, b) => a.t.name.localeCompare(b.t.name, "de"),
  artist: (a, b) => ((a.t.artists || [])[0] || { name: "" }).name.localeCompare(((b.t.artists || [])[0] || { name: "" }).name, "de")
};
function sortedRows() { const k = $("bSort").value; return plRows.slice().sort(SORTS[k] || SORTS.orig); }
// Abspielen: in Playlist-Reihenfolge ueber die Playlist selbst, sonst als Liste in der angezeigten Reihenfolge
async function playFrom(rowsShown, idx) {
  // Bei Zufallswiedergabe ignoriert Spotify den angeklickten Song. Darum Zufall kurz aus,
  // Song starten und danach Zufall wieder an (der gewaehlte Song laeuft dann weiter).
  const wasShuffle = !!(bigState && bigState.shuffle_state);
  if (wasShuffle) { try { await SP.api("/me/player/shuffle?state=false", { method: "PUT" }); } catch {} }
  await playFromNow(rowsShown, idx);
  if (wasShuffle) setTimeout(() => SP.api("/me/player/shuffle?state=true", { method: "PUT" }).catch(() => {}), 1200);
}
async function playFromNow(rowsShown, idx) {
  const sort = $("bSort").value, row = rowsShown[idx];
  if (sort === "orig") { await spPlay({ context_uri: curPlaylist.uri, offset: { position: row ? row.pos : 0 } }); return; }
  const uris = rowsShown.slice(idx).filter(x => !x.t.is_local && x.t.is_playable !== false).slice(0, 50).map(x => x.t.uri);
  // Ausweichplan: gewaehlten Song direkt aus der Playlist starten (danach geht es in Playlist-Reihenfolge weiter)
  const fb = row ? { context_uri: curPlaylist.uri, offset: { uri: row.t.uri } } : { context_uri: curPlaylist.uri };
  Object.defineProperty(fb, "note", { value: "Läuft aus der Playlist. Danach geht es in Playlist-Reihenfolge weiter.", enumerable: false });
  const list = { uris }; Object.defineProperty(list, "note", { value: "", enumerable: false });
  // Hat beim letzten Mal nur der direkte Start aus der Playlist geklappt, gleich diesen nehmen (geht schneller)
  if (store.get("spDirect", false)) await spPlay(fb, list); else await spPlay(list, fb);
}
function renderPlaylistRows() {
  const ul = $("bList"); ul.textContent = "";
  if (!plRows.length) { listMsg("Die Songs dieser Playlist zeigt Spotify nur dem Besitzer. Du kannst sie aber als Ganzes abspielen."); return; }
  $("bListTitle").textContent = curPlaylist.name + " · " + plRows.length + " Songs";
  const rows = sortedRows(), showAdded = $("bSort").value === "added";
  rows.forEach((x, i) => {
    const t = x.t;
    const li = document.createElement("li"); li.className = "btr" + (t.is_local ? " local" : "");
    li.innerHTML = '<span class="bn"></span><div><b></b><span></span></div><span class="bd"></span>';
    li.querySelector(".bn").textContent = i + 1;
    li.querySelector("b").textContent = t.name;
    const by = (t.artists || []).map(a => a.name).join(", ") || (t.show ? t.show.name : "");
    li.querySelector("div span").textContent = by + (showAdded && x.added ? " · hinzugefügt " + fmtD(new Date(x.added)) : "") + (t.is_local ? " · lokale Datei" : "");
    li.querySelector(".bd").textContent = tfmt(t.duration_ms || 0);
    if (bigState && bigState.item && bigState.item.uri === t.uri) li.classList.add("now");
    li.tabIndex = 0; li.setAttribute("role", "button");
    const go = () => { if (!t.is_local) playFrom(rows, i); };
    li.onclick = go; li.onkeydown = e => { if (e.key === "Enter") go(); };
    ul.append(li);
  });
}
$("bSort").value = store.get("plSort", "orig");
$("bSort").onchange = () => { store.set("plSort", $("bSort").value); if (plRows.length) renderPlaylistRows(); };
$("bPlayAll").onclick = () => { if (!curPlaylist) return; if (plRows.length && $("bSort").value !== "orig") playFrom(sortedRows(), 0); else spPlay({ context_uri: curPlaylist.uri }); };
$("bBack").onclick = showPlaylists;
$("bClose").onclick = () => $("spDialog").close();
$("spDialog").addEventListener("close", () => { clearInterval(bigTick); bigTick = null; });
$("spBig").onclick = () => {
  if (!store.get("spRefresh", "")) { $("openSettings").click(); return; }
  $("bMsg").textContent = "";
  $("spDialog").showModal();
  loadSpotify(true); showPlaylists();
  clearInterval(bigTick);
  bigTick = setInterval(() => { bigProgress(); }, 1000);
};

/* ---------- Mac-Nutzung (ActivityWatch ueber Supabase) ---------- */
async function loadMacStats() {
  const box = $("macStats"), key = store.get("calKey", ""), k = DATA.kalender;
  if (!key || !k) { box.innerHTML = '<p class="empty">Braucht den Kalender-Schlüssel aus den Einstellungen.</p>'; return; }
  try {
    const r = await fetch(k.url.replace("cockpit-calendar", "cockpit-stats") + "?token=" + encodeURIComponent(key), { cache: "no-store", headers: { apikey: k.apikey } });
    const j = await r.json();
    if (!r.ok || j.empty || !j.results) { box.innerHTML = '<p class="empty">Noch keine Daten vom Mac. Die Einrichtung läuft über ActivityWatch.</p>'; $("macHint").textContent = ""; return; }
    renderMacStats(j);
  } catch { box.innerHTML = '<p class="empty">Statistik gerade nicht erreichbar.</p>'; }
}
function renderMacStats(j) {
  const box = $("macStats"); box.textContent = "";
  const big = !!document.querySelector(".card.expanded #macStats");
  const dur = s => { const m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + " h " + pad(m % 60) + " min" : m + " min"; };
  const days = j.days.map((d, i) => ({ d, apps: j.results[i] || [] }));
  const totals = days.map(x => x.apps.reduce((a, e) => a + e.duration, 0));
  const today = days[days.length - 1], tTotal = totals[totals.length - 1];
  const upd = new Date(j.updated);
  $("macHint").textContent = "Stand " + pad(upd.getHours()) + ":" + pad(upd.getMinutes());
  const head = document.createElement("div"); head.className = "statline macsum";
  head.innerHTML = "<span>Heute aktiv</span><b></b>"; head.querySelector("b").textContent = dur(tTotal);
  const wk = document.createElement("div"); wk.className = "statline";
  wk.innerHTML = "<span>Schnitt 7 Tage</span><b></b>"; wk.querySelector("b").textContent = dur(totals.reduce((a, b) => a + b, 0) / 7);
  box.append(head, wk);
  const ul = document.createElement("ul"); ul.className = "macapps";
  // Systemfenster und Kleinstzeiten (unter 1 Minute) ausblenden
  const hide = /^(universalAccessAuthWarn|loginwindow|UserNotificationCenter|ScreenSaverEngine|Dock)$/;
  const top = today.apps.filter(e => e.duration >= 60 && !hide.test(e.data.app || "")).slice(0, big ? 15 : 6), max = top[0] ? top[0].duration : 1;
  if (!top.length) ul.innerHTML = '<li class="empty">Heute noch nichts erfasst.</li>';
  top.forEach(e => {
    const li = document.createElement("li");
    li.innerHTML = '<span class="an"></span><span class="ad"></span><div class="bar"><i></i></div>';
    li.querySelector(".an").textContent = e.data.app || "Unbekannt";
    li.querySelector(".ad").textContent = dur(e.duration);
    li.querySelector(".bar i").style.width = (e.duration / max * 100).toFixed(1) + "%";
    ul.append(li);
  });
  box.append(ul);
  const mx = Math.max(3600, ...totals);
  const bars = document.createElement("div"); bars.className = "week";
  bars.innerHTML = days.map((x, i) => '<div title="' + dur(totals[i]) + '"><i class="' + (totals[i] ? "on" : "") + '" style="height:' + Math.max(3, totals[i] / mx * 100) + '%"></i><span>' + WD[new Date(x.d + "T12:00").getDay()] + "</span></div>").join("");
  box.append(bars);
}

/* ---------- Kacheln gross anzeigen ---------- */
let expandedCard = null;
function closeExpanded() {
  if (!expandedCard) return;
  const c = expandedCard; expandedCard = null;
  c.classList.remove("expanded"); document.body.classList.remove("has-expanded");
  const b = c.querySelector(".growbtn"); if (b) { b.textContent = "Groß"; b.focus(); }
  if (c.querySelector("#calendar")) loadCalendar();
  if (c.querySelector("#macStats")) loadMacStats();
}
function setupGrow() {
  document.querySelectorAll(".card[data-id]").forEach(card => {
    const h = card.querySelector("h2"); if (!h || card.querySelector("#spotify")) return;
    // Rechte Seite der Ueberschrift: vorhandene Hinweise plus Gross-Knopf
    const tools = document.createElement("span"); tools.className = "tools";
    [...h.children].forEach(ch => tools.append(ch));
    const b = document.createElement("button"); b.type = "button"; b.className = "btn small growbtn"; b.textContent = "Groß";
    b.onclick = () => {
      if (expandedCard === card) { closeExpanded(); return; }
      closeExpanded();
      expandedCard = card; card.classList.add("expanded"); document.body.classList.add("has-expanded");
      b.textContent = "Schließen";
      if (card.querySelector("#calendar")) loadCalendar();
      if (card.querySelector("#macStats")) loadMacStats();
    };
    tools.append(b); h.append(tools);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && expandedCard) closeExpanded(); });
  $("growShade").onclick = closeExpanded;
}

/* ---------- Start der Zusatzmodule ---------- */
function initFeatures() {
  setupGrow();
  renderPlan(); renderGrades(); loadSeries(); loadSpotify(true); loadMacStats();
  // beim Zurueckkehren in die App einmal alles Wichtige auffrischen
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadMacStats(); } });
  setInterval(loadMacStats, 5 * 60000);
  // Spotify sparsam abfragen: nur wenn Cockpit sichtbar ist, und seltener wenn nichts laeuft
  const spLoop = async () => {
    if (!document.hidden) await loadSpotify(true).catch(() => {});
    const playing = window.spCur && window.spCur.is_playing;
    setTimeout(spLoop, document.hidden ? 60000 : $("spDialog").open ? 3000 : playing ? 10000 : 30000);
  };
  setTimeout(spLoop, 10000);
  setInterval(loadSeries, 3 * 3600000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadSpotify(true); });
}
