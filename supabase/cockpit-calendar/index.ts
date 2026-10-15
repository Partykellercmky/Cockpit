// Supabase Edge Function "cockpit-calendar"
// Holt den privaten Google-Kalender (iCal-Adresse) und liefert die Termine
// der naechsten 14 Tage als JSON an die Cockpit-App.
// Benoetigte Secrets: GCAL_ICS_URL (geheime iCal-Adresse), COCKPIT_TOKEN (Schluessel der App)
// Optional: GCAL_ICS_URL_GEBURTSTAGE (zweiter Kalender, Termine bekommen cal="geburtstage")

const TZ = "Europe/Berlin";
const DAYS_AHEAD = 14;
const DAY = 86400000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

type Ev = { title: string; start: string; end: string; allDay: boolean; cal?: string };

/* ---------- Zeit-Hilfen ---------- */
// Wandelt eine Berliner Ortszeit in einen echten Zeitpunkt um
function zoned(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, tz = TZ): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t)).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t);
}
// Liefert Datumsteile in Berliner Zeit
function parts(dt: Date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
    .formatToParts(dt).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

type T = { allDay: boolean; y: number; mo: number; d: number; h: number; mi: number; s: number; tz?: string; utc?: boolean };
function parseT(value: string, params: Record<string, string>): T {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) throw new Error("Datum " + value);
  if (!m[4] || params.VALUE === "DATE") return { allDay: true, y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0 };
  return { allDay: false, y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6], tz: params.TZID, utc: !!m[7] };
}
function toDate(t: T): Date {
  if (t.utc) return new Date(Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s));
  let tz = t.tz || TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = TZ; }
  return zoned(t.y, t.mo, t.d, t.h, t.mi, t.s, tz);
}
const dayNum = (y: number, mo: number, d: number) => Math.floor(Date.UTC(y, mo - 1, d) / DAY);
const fromDayNum = (n: number) => { const x = new Date(n * DAY); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() }; };
const pad = (n: number) => String(n).padStart(2, "0");
const localIso = (y: number, mo: number, d: number) => `${y}-${pad(mo)}-${pad(d)}T00:00:00`;

/* ---------- iCal lesen ---------- */
type Prop = { name: string; params: Record<string, string>; value: string };
function parseIcs(text: string) {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = []; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(";");
    const params: Record<string, string> = {};
    ps.forEach(p => { const [k, v] = p.split("="); params[k.toUpperCase()] = (v || "").replace(/"/g, ""); });
    cur.push({ name: name.toUpperCase(), params, value: line.slice(i + 1) });
  }
  return events;
}
const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/* ---------- Wiederholungen ---------- */
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function matches(rule: Record<string, string>, start: T, day: { y: number; mo: number; d: number; wd: number }, n: number, n0: number) {
  const iv = +(rule.INTERVAL || 1);
  const byday = rule.BYDAY ? rule.BYDAY.split(",") : null;
  const bymd = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(",").map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(",").map(Number) : null;
  if (bymonth && !bymonth.includes(day.mo)) return false;
  const dim = new Date(Date.UTC(day.y, day.mo, 0)).getUTCDate();
  const nthOk = (code: string) => {
    const m = code.match(/^([+-]?\d+)?([A-Z]{2})$/); if (!m) return false;
    if (WD[m[2]] !== day.wd) return false;
    if (!m[1]) return true;
    const k = +m[1];
    return k > 0 ? Math.ceil(day.d / 7) === k : Math.ceil((dim - day.d + 1) / 7) === -k;
  };
  switch (rule.FREQ) {
    case "DAILY": return (n - n0) % iv === 0 && (!byday || byday.some(nthOk));
    case "WEEKLY": {
      const wk = (x: number) => Math.floor((x + 3) / 7); // Wochen ab Montag (1.1.1970 war Donnerstag)
      if ((wk(n) - wk(n0)) % iv !== 0) return false;
      return byday ? byday.some(nthOk) : day.wd === fromDayNum(n0).wd;
    }
    case "MONTHLY": {
      if (((day.y - start.y) * 12 + day.mo - start.mo) % iv !== 0) return false;
      if (bymd) return bymd.some(x => (x > 0 ? x : dim + x + 1) === day.d);
      if (byday) return byday.some(nthOk);
      return day.d === start.d;
    }
    case "YEARLY": {
      if ((day.y - start.y) % iv !== 0) return false;
      if (byday && bymonth) return byday.some(nthOk);
      return day.mo === (bymonth ? day.mo : start.mo) && day.d === (bymd ? bymd[0] : start.d);
    }
  }
  return false;
}

function buildEvents(ics: string, from: Date, to: Date): Ev[] {
  const raw = parseIcs(ics);
  const out: Ev[] = [];
  const overrides = new Map<string, Set<number>>(); // UID -> Startzeitpunkte, die einzeln geaendert wurden
  for (const ev of raw) {
    const rid = ev.find(p => p.name === "RECURRENCE-ID"), uid = ev.find(p => p.name === "UID")?.value || "";
    if (rid) { if (!overrides.has(uid)) overrides.set(uid, new Set()); overrides.get(uid)!.add(toDate(parseT(rid.value, rid.params)).getTime()); }
  }
  for (const ev of raw) {
    const g = (n: string) => ev.find(p => p.name === n);
    if ((g("STATUS")?.value || "") === "CANCELLED") continue;
    const ds = g("DTSTART"); if (!ds) continue;
    const st = parseT(ds.value, ds.params);
    const de = g("DTEND");
    const startD = toDate(st);
    let durMs: number;
    if (de) durMs = toDate(parseT(de.value, de.params)).getTime() - startD.getTime();
    else if (g("DURATION")) {
      const m = g("DURATION")!.value.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/) || [];
      durMs = ((+(m[1] || 0) * 7 + +(m[2] || 0)) * 24 + +(m[3] || 0)) * 3600000 + +(m[4] || 0) * 60000;
    } else durMs = st.allDay ? DAY : 0;
    const title = unescape(g("SUMMARY")?.value || "(ohne Titel)");
    const uid = g("UID")?.value || "";
    const durDays = Math.max(1, Math.round(durMs / DAY));

    const push = (y: number, mo: number, d: number, startAt?: Date) => {
      if (st.allDay) {
        const e = fromDayNum(dayNum(y, mo, d) + durDays);
        out.push({ title, allDay: true, start: localIso(y, mo, d), end: localIso(e.y, e.mo, e.d) });
      } else {
        const s = startAt!, e = new Date(s.getTime() + durMs);
        out.push({ title, allDay: false, start: s.toISOString(), end: e.toISOString() });
      }
    };
    const inWindow = (s: Date, e: Date) => e > from && s < to;

    const rr = g("RRULE");
    if (!rr || g("RECURRENCE-ID")) {
      const e = new Date(startD.getTime() + durMs);
      if (st.allDay) { const s0 = new Date(Date.UTC(st.y, st.mo - 1, st.d)); if (inWindow(s0, new Date(s0.getTime() + durDays * DAY))) push(st.y, st.mo, st.d); }
      else if (inWindow(startD, e)) push(0, 0, 0, startD);
      continue;
    }
    const rule: Record<string, string> = {};
    rr.value.split(";").forEach(kv => { const [k, v] = kv.split("="); rule[k] = v; });
    const until = rule.UNTIL ? toDate(parseT(rule.UNTIL, {})) : null;
    const count = rule.COUNT ? +rule.COUNT : Infinity;
    const ex = new Set<number>();
    ev.filter(p => p.name === "EXDATE").forEach(p => p.value.split(",").forEach(v => ex.add(st.allDay ? dayNum(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8)) : toDate(parseT(v, p.params)).getTime())));
    const ov = overrides.get(uid) || new Set<number>();

    const n0 = dayNum(st.y, st.mo, st.d);
    const toP = parts(to), nEnd = dayNum(toP.y, toP.mo, toP.d);
    let seen = 0;
    for (let n = n0; n <= nEnd; n++) {
      const day = fromDayNum(n);
      if (!matches(rule, st, day, n, n0)) continue;
      const occ = st.allDay ? new Date(n * DAY) : zoned(day.y, day.mo, day.d, st.h, st.mi, st.s, st.tz && !st.utc ? st.tz : TZ);
      if (st.utc && !st.allDay) { // UTC-Startzeit: gleiche Uhrzeit in UTC
        occ.setTime(Date.UTC(day.y, day.mo - 1, day.d, st.h, st.mi, st.s));
      }
      if (until && occ > until) break;
      seen++;
      if (seen > count) break;
      if (ex.has(st.allDay ? n : occ.getTime()) || ov.has(occ.getTime())) continue;
      const end = new Date(occ.getTime() + (st.allDay ? durDays * DAY : durMs));
      if (inWindow(occ, end)) push(day.y, day.mo, day.d, occ);
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

/* ---------- Server ---------- */
Deno.serve(async req => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const url = new URL(req.url);
    const token = Deno.env.get("COCKPIT_TOKEN");
    if (!token || url.searchParams.get("token") !== token)
      return new Response(JSON.stringify({ error: "Kein Zugriff" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    try {
      const now = new Date(), p = parts(now);
      const from = zoned(p.y, p.mo, p.d), to = new Date(from.getTime() + DAYS_AHEAD * DAY);
      const sources = [["privat", Deno.env.get("GCAL_ICS_URL")], ["geburtstage", Deno.env.get("GCAL_ICS_URL_GEBURTSTAGE")]]
        .filter(([, u]) => u) as [string, string][];
      const lists = await Promise.all(sources.map(async ([cal, u]) => {
        const r = await fetch(u);
        if (!r.ok) { if (cal === "privat") throw new Error("Kalender " + r.status); return []; }
        return buildEvents(await r.text(), from, to).map(e => ({ ...e, cal }));
      }));
      const events = lists.flat().sort((a, b) => (a.start < b.start ? -1 : 1));
      return new Response(JSON.stringify({ events }), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "max-age=300" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
  });
