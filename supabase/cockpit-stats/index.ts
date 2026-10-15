// Supabase Edge Function "cockpit-stats"
// Nimmt die Mac-Nutzungsstatistik vom Mac entgegen (POST) und gibt sie an Cockpit aus (GET).
// Gespeichert wird nur eine Datei im privaten Storage-Bucket "cockpit" – keine Datenbank-Tabellen.
// Benoetigtes Secret: COCKPIT_TOKEN (derselbe Schluessel wie beim Kalender)
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function serverKey(): string {
  const custom = Deno.env.get("SERVER_KEY");
  if (custom) return custom;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const k = keys.default || Object.values(keys)[0];
    if (typeof k === "string" && k) return k;
  } catch { /* ignorieren */ }
  const direct = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  throw new Error("Kein Server-Schluessel gefunden");
}

const BUCKET = "cockpit", FILE = "mac-stats.json";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = Deno.env.get("COCKPIT_TOKEN");
  if (!token || new URL(req.url).searchParams.get("token") !== token) return json({ error: "Kein Zugriff" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), { auth: { persistSession: false } });
  try {
    if (req.method === "POST") {
      const body = await req.text();
      if (body.length > 200000) return json({ error: "Zu gross" }, 413);
      JSON.parse(body); // nur gueltiges JSON annehmen
      await db.storage.createBucket(BUCKET, { public: false }).catch(() => {});
      let up = await db.storage.from(BUCKET).upload(FILE, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      if (up.error && /bucket/i.test(up.error.message)) {
        await db.storage.createBucket(BUCKET, { public: false });
        up = await db.storage.from(BUCKET).upload(FILE, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      }
      if (up.error) throw up.error;
      return json({ ok: true });
    }
    const { data, error } = await db.storage.from(BUCKET).download(FILE);
    if (error || !data) return json({ empty: true });
    return new Response(await data.text(), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
