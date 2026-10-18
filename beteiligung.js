"use strict";
/* Cockpit – Beteiligung im Unterricht.
   Ziel: in jeder Unterrichtsstunde mindestens 2 Meldungen. Alles bleibt lokal auf dem Mac.
   Bewusst ohne Benachrichtigungen. */

const BT_GOAL = 2; // Meldungen pro Unterrichtsstunde
let beteiligung = store.get("beteiligung", []); // {id, d:"YYYY-MM-DD", fach, h:1|2, n}

const btGoal = e => BT_GOAL * (e.h || 1);
const btHours = arr => arr.reduce((a, e) => a + (e.h || 1), 0);
const btReached = arr => arr.reduce((a, e) => a + (e.n >= btGoal(e) ? (e.h || 1) : 0), 0);
function btSave() { store.set("beteiligung", beteiligung); renderBeteiligung(); if (typeof renderToday === "function") renderToday(); }

function btSubjects() {
  const dl = $("btSubjects"); dl.textContent = "";
  const base = (DATA.faecher || []).filter(f => f !== "Zwischenprüfung" && f !== "Sonstiges");
  [...new Set([...base, ...beteiligung.map(e => e.fach)])].forEach(f => { const o = document.createElement("option"); o.value = f; dl.append(o); });
}

function renderBeteiligung() {
  if (!DATA) return;
  btSubjects();
  const today = ymd(new Date());
  // gezeigt wird heute, sonst der letzte Schultag mit Eintraegen
  const days = [...new Set(beteiligung.map(e => e.d))].sort();
  const showDay = beteiligung.some(e => e.d === today) ? today : (days[days.length - 1] || today);
  const list = beteiligung.filter(e => e.d === showDay);
  $("btDay").textContent = showDay === today ? "Heute" : "Zuletzt · " + WD[new Date(showDay + "T12:00").getDay()] + " " + fmtD(new Date(showDay + "T12:00"));

  // Zusammenfassung des gezeigten Tages
  const hrs = btHours(list), ok = btReached(list), sum = list.reduce((a, e) => a + e.n, 0);
  const pct = hrs ? ok / hrs * 100 : 0;
  $("btRing").innerHTML = ring(pct, 58, hrs ? Math.round(pct) + "%" : "–", hrs && ok === hrs ? "done" : "");
  $("btSum").textContent = hrs ? sum + " Meldungen" : "Noch keine Stunde";
  $("btMeta").textContent = hrs ? ok + " von " + hrs + " Stunden mit Ziel erreicht" : "Stunde anlegen und bei jeder Meldung auf + tippen";

  // Stunden des Tages
  const ul = $("btList"); ul.textContent = "";
  list.forEach((e, i) => {
    const goal = btGoal(e), done = e.n >= goal;
    const li = document.createElement("li"); li.className = "btrow" + (done ? " done" : "");
    li.innerHTML = '<div class="btname"><b></b><span></span></div><div class="btdots" aria-hidden="true"></div>' +
      '<div class="btctl"><button class="btn small" type="button" data-a="-">−</button><output></output>' +
      '<button class="btn small primary" type="button" data-a="+">+ Meldung</button>' +
      '<button class="x" type="button" aria-label="Stunde löschen">×</button></div>';
    li.querySelector("b").textContent = (i + 1) + ". " + e.fach;
    li.querySelector(".btname span").textContent = (e.h === 2 ? "Doppelstunde · " : "") + (done ? "Ziel erreicht" : "noch " + (goal - e.n));
    li.querySelector(".btdots").innerHTML = [...Array(Math.max(goal, e.n))].map((_, k) => '<i class="' + (k < e.n ? (k < goal ? "on" : "on extra") : "") + '"></i>').join("");
    li.querySelector("output").textContent = e.n + " / " + goal;
    li.querySelector('[data-a="+"]').onclick = () => { e.n++; btSave(); };
    li.querySelector('[data-a="-"]').onclick = () => { if (e.n > 0) { e.n--; btSave(); } };
    const x = li.querySelector(".x");
    x.onclick = () => {
      if (!x.dataset.sure) { x.dataset.sure = "1"; x.textContent = "löschen?"; setTimeout(() => { delete x.dataset.sure; x.textContent = "×"; }, 3000); return; }
      beteiligung = beteiligung.filter(y => y !== e); btSave();
    };
    ul.append(li);
  });

  // Verlauf: letzte 8 Schultage mit Eintraegen
  const last = days.slice(-8);
  $("btBars").style.gridTemplateColumns = "repeat(8,1fr)";
  $("btBars").innerHTML = last.length ? last.map(d => {
    const arr = beteiligung.filter(e => e.d === d), h = btHours(arr), r = btReached(arr), p = h ? r / h * 100 : 0, dt = new Date(d + "T12:00");
    return '<div title="' + fmtD(dt) + ": " + r + " von " + h + ' Stunden"><i class="' + (p >= 100 ? "on full" : p ? "on" : "") + '" style="height:' + Math.max(3, p) + '%"></i><span>' + pad(dt.getDate()) + "." + pad(dt.getMonth() + 1) + "</span></div>";
  }).join("") : '<p class="empty">Verlauf erscheint nach dem ersten Schultag.</p>';

  // Gesamt und je Fach
  const allH = btHours(beteiligung), allOk = btReached(beteiligung), allN = beteiligung.reduce((a, e) => a + e.n, 0);
  $("btTotal").textContent = allH ? Math.round(allOk / allH * 100) + " % · Ø " + (allN / allH).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " pro Stunde" : "--";
  const by = {}; beteiligung.forEach(e => { const b = by[e.fach] = by[e.fach] || { h: 0, n: 0 }; b.h += e.h || 1; b.n += e.n; });
  const bs = $("btBySub"); bs.textContent = "";
  Object.entries(by).sort((a, b) => a[0].localeCompare(b[0])).forEach(([f, v]) => {
    const avg = v.n / v.h, li = document.createElement("li"); li.innerHTML = "<span></span><b></b>";
    li.querySelector("span").textContent = f + " (" + v.h + " Std.)";
    li.querySelector("b").textContent = "Ø " + avg.toLocaleString("de-DE", { maximumFractionDigits: 1 });
    li.querySelector("b").className = avg >= BT_GOAL ? "good" : "bad";
    bs.append(li);
  });
}

$("btForm").onsubmit = ev => {
  ev.preventDefault();
  const fach = $("btFach").value.trim(); if (!fach) { $("btFach").focus(); return; }
  const h = $("btLen").value === "2" ? 2 : 1;
  store.set("btLastLen", $("btLen").value);
  beteiligung.push({ id: Date.now(), d: ymd(new Date()), fach, h, n: 0 });
  $("btFach").value = ""; btSave();
};

function initBeteiligung() {
  $("btLen").value = store.get("btLastLen", "1");
  renderBeteiligung();
  // um Mitternacht auf den neuen Tag umschalten
  let day = ymd(new Date());
  setInterval(() => { const d = ymd(new Date()); if (d !== day) { day = d; renderBeteiligung(); } }, 60000);
}
(function waitData() { if (DATA) initBeteiligung(); else setTimeout(waitData, 150); })();
