/**
 * ePGP Reminders — Cloudflare Worker
 *
 * Handles:
 *   GET  /api/healthz
 *   GET  /api/schedule                       proxied + cached from Google Sheets
 *   GET  /api/push/vapid-public-key
 *   POST /api/push/subscribe                 { subscription }
 *   POST /api/push/unsubscribe               { endpoint }
 *   GET  /api/push/reminders?endpoint=...
 *   POST /api/push/reminders                 { endpoint, reminder }
 *   DELETE /api/push/reminders/:id?endpoint=...
 *   DELETE /api/push/reminders?endpoint=...  (clear all)
 *
 * Cron (`* * * * *`):
 *   For every subscription, evaluates each reminder against today's schedule,
 *   fires Web Push when slot times match or 15 min before each matched session
 *   (if pre-class nudge enabled). Auto-expires reminders after their last
 *   matching lecture date.
 */

import { ApplicationServerKeys, generatePushHTTPRequest } from "webpush-webcrypto";

export interface Env {
  EPGP_KV: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  SHEET_CSV_URL: string;
}

// ---------- Types ----------
interface Session { slot: number; time: string; subject: string }
interface DaySchedule { date: string; day: string; week: string; sessions: Session[] }
interface ScheduleData {
  subjects: string[];
  schedule: DaySchedule[];
  lastFetched: string;
}
interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
interface Reminder {
  id: string;
  subjects: string[];
  times: string[];
  preClassNudge: boolean;
  createdAt: string;
}
interface SubscriberRecord {
  subscription: PushSubscriptionJSON;
  reminders: Reminder[];
  sent: Record<string, true>;
  updatedAt: string;
}

// ---------- KV keys ----------
const SUB_INDEX_KEY = "subs:index";  // string[] of endpoints
const subKey = (endpoint: string) => `sub:${endpoint}`;
const SCHEDULE_CACHE_KEY = "schedule:cache";
const SCHEDULE_DATE_KEY = "schedule:date";

// ---------- Utilities ----------
const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errResp(message: string, status = 400) {
  return json({ error: message }, status);
}

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseScheduleDateStr(dateStr: string): Date | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [day, month, yearShort] = parts;
  const d = new Date(`${day} ${month} 20${yearShort}`);
  return isNaN(d.getTime()) ? null : d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseStartMinutes(timeRange: string): number | null {
  const m = timeRange.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]!);
  const min = parseInt(m[2]!);
  const period = m[3]!.toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

// ---------- Schedule (Google Sheets CSV → ScheduleData) ----------
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) { cells.push(current.trim()); current = ""; }
      else current += char;
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

function parseSchedule(csvText: string): ScheduleData {
  const rows = parseCSV(csvText);
  let campusTimes: string[] = [];
  let weekdayTimes: string[] = [];
  let weekendTimes: string[] = [];

  if (rows[5]) {
    campusTimes = [
      rows[5][4] || "09:00 AM-10:30 AM",
      rows[5][5] || "11:15 AM-12:45 PM",
      rows[5][6] || "02:00 PM-03:30 PM",
      rows[5][7] || "03:45 PM-05:15 PM",
      rows[5][8] || "05:30 PM-07:00 PM",
    ];
  } else {
    campusTimes = ["09:00 AM-10:30 AM","11:15 AM-12:45 PM","02:00 PM-03:30 PM","03:45 PM-05:15 PM","05:30 PM-07:00 PM"];
  }

  for (const row of rows) {
    const label = (row[2] || "").toLowerCase();
    if (label.includes("mon-friday") || label.includes("weekday")) {
      weekdayTimes = ["","","", row[7] || "07:30 PM-09:00 PM", row[8] || "09:15 PM-10:45 PM"];
    }
    if (label.includes("sat-sun") || label.includes("weekend")) {
      weekendTimes = [
        row[4] || "10:00 AM-11:30 AM",
        row[5] || "11:45 AM-01:15 PM",
        row[6] || "03:00 PM-04:30 PM",
        row[7] || "04:45 PM-06:15 PM",
        row[8] || "06:30 PM-08:00 PM",
      ];
    }
  }
  if (weekdayTimes.length === 0) weekdayTimes = ["","","", "07:30 PM-09:00 PM", "09:15 PM-10:45 PM"];
  if (weekendTimes.length === 0) weekendTimes = ["10:00 AM-11:30 AM","11:45 AM-01:15 PM","03:00 PM-04:30 PM","04:45 PM-06:15 PM","06:30 PM-08:00 PM"];

  const EXCLUDED = new Set(["Buffer slot", "Conclusion of In-Campus II", "Id ul Zuha", "Muharram", "Work Shop (CR203)"]);

  const schedule: DaySchedule[] = [];
  const subjectsSet = new Set<string>();
  let currentWeek = "";
  for (const row of rows) {
    const dateStr = row[1];
    if (!dateStr || !/\d{2}-[A-Za-z]+-\d{2}/.test(dateStr)) continue;
    const weekCol = row[0]; const dayCol = row[2];
    if (weekCol && weekCol.startsWith("Week")) currentWeek = weekCol;
    if (!dayCol || dayCol === "Day") continue;
    const isWeekend = dayCol === "Saturday" || dayCol === "Sunday";
    const hasCampusSessions = !!(row[4] || row[5] || row[6]);
    const times = isWeekend ? weekendTimes : (hasCampusSessions ? campusTimes : weekdayTimes);
    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      const subject = (row[4 + i] || "").trim();
      const time = times[i] || "";
      if (subject && time && !EXCLUDED.has(subject)) {
        subjectsSet.add(subject);
        sessions.push({ slot: i + 1, time, subject });
      }
    }
    if (sessions.length > 0) schedule.push({ date: dateStr, day: dayCol, week: currentWeek, sessions });
  }
  return { subjects: [...subjectsSet].sort(), schedule, lastFetched: new Date().toISOString() };
}

async function getSchedule(env: Env, force = false): Promise<ScheduleData> {
  const today = todayLocalISO();
  if (!force) {
    const date = await env.EPGP_KV.get(SCHEDULE_DATE_KEY);
    if (date === today) {
      const cached = await env.EPGP_KV.get<ScheduleData>(SCHEDULE_CACHE_KEY, "json");
      if (cached) return cached;
    }
  }
  const res = await fetch(env.SHEET_CSV_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`sheet fetch ${res.status}`);
  const data = parseSchedule(await res.text());
  await env.EPGP_KV.put(SCHEDULE_CACHE_KEY, JSON.stringify(data));
  await env.EPGP_KV.put(SCHEDULE_DATE_KEY, today);
  return data;
}

// ---------- Subscription store ----------
async function getIndex(env: Env): Promise<string[]> {
  return (await env.EPGP_KV.get<string[]>(SUB_INDEX_KEY, "json")) ?? [];
}
async function saveIndex(env: Env, idx: string[]) {
  await env.EPGP_KV.put(SUB_INDEX_KEY, JSON.stringify(idx));
}
async function getSubscriber(env: Env, endpoint: string): Promise<SubscriberRecord | null> {
  return env.EPGP_KV.get<SubscriberRecord>(subKey(endpoint), "json");
}
async function putSubscriber(env: Env, rec: SubscriberRecord) {
  await env.EPGP_KV.put(subKey(rec.subscription.endpoint), JSON.stringify(rec));
}
async function deleteSubscriber(env: Env, endpoint: string) {
  await env.EPGP_KV.delete(subKey(endpoint));
  const idx = await getIndex(env);
  const next = idx.filter(e => e !== endpoint);
  if (next.length !== idx.length) await saveIndex(env, next);
}
async function upsertSubscription(env: Env, sub: PushSubscriptionJSON): Promise<SubscriberRecord> {
  let rec = await getSubscriber(env, sub.endpoint);
  if (!rec) {
    rec = { subscription: sub, reminders: [], sent: {}, updatedAt: new Date().toISOString() };
    const idx = await getIndex(env);
    if (!idx.includes(sub.endpoint)) { idx.push(sub.endpoint); await saveIndex(env, idx); }
  } else {
    rec.subscription = sub;
    rec.updatedAt = new Date().toISOString();
  }
  await putSubscriber(env, rec);
  return rec;
}

// ---------- VAPID key import ----------
// VAPID keys from the standard `web-push` tooling are base64url:
//   publicKey: 65-byte uncompressed P-256 point (0x04 || X || Y)
//   privateKey: 32-byte raw scalar
// We convert them to CryptoKeys via JWK so we can construct ApplicationServerKeys directly.
function b64urlToUint8(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function uint8ToB64url(u8: Uint8Array): string {
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedKeys: ApplicationServerKeys | null = null;
async function loadKeys(env: Env): Promise<ApplicationServerKeys> {
  if (cachedKeys) return cachedKeys;
  const pub = b64urlToUint8(env.VAPID_PUBLIC_KEY);
  const priv = b64urlToUint8(env.VAPID_PRIVATE_KEY);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("Invalid VAPID public key");
  if (priv.length !== 32) throw new Error("Invalid VAPID private key");
  const x = uint8ToB64url(pub.slice(1, 33));
  const y = uint8ToB64url(pub.slice(33, 65));
  const d = uint8ToB64url(priv);

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  cachedKeys = new ApplicationServerKeys(publicKey, privateKey);
  return cachedKeys;
}

// ---------- Push send ----------
async function sendPush(env: Env, rec: SubscriberRecord, payload: object): Promise<boolean> {
  try {
    const keys = await loadKeys(env);
    const { headers, body, endpoint } = await generatePushHTTPRequest({
      applicationServerKeys: keys,
      payload: JSON.stringify(payload),
      target: {
        endpoint: rec.subscription.endpoint,
        keys: { p256dh: rec.subscription.keys.p256dh, auth: rec.subscription.keys.auth },
      },
      adminContact: env.VAPID_SUBJECT,
      ttl: 60,
      urgency: "normal",
    });
    const res = await fetch(endpoint, { method: "POST", headers, body: body.buffer as ArrayBuffer });
    if (res.status === 404 || res.status === 410) {
      await deleteSubscriber(env, rec.subscription.endpoint);
      return false;
    }
    if (!res.ok) {
      console.warn("push non-OK", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("push error", (e as Error).message);
    return false;
  }
}

// ---------- Cron evaluator ----------
async function evaluateAll(env: Env) {
  const data = await getSchedule(env).catch(() => null);
  if (!data) { console.warn("no schedule available"); return; }

  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const todayISO = todayLocalISO();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Find today's schedule entry once
  const todaySched = data.schedule.find(d => {
    const x = parseScheduleDateStr(d.date);
    return x !== null && isSameDay(x, now);
  });

  for (const endpoint of await getIndex(env)) {
    const rec = await getSubscriber(env, endpoint);
    if (!rec) continue;

    let mutated = false;

    // Auto-expire reminders whose subjects' last occurrence has passed
    const survivors: Reminder[] = [];
    for (const r of rec.reminders) {
      let last: Date | null = null;
      for (const day of data.schedule) {
        if (!day.sessions.some(s => r.subjects.includes(s.subject))) continue;
        const d = parseScheduleDateStr(day.date);
        if (!d) continue;
        if (!last || d > last) last = d;
      }
      if (!last) { mutated = true; continue; }
      const lastDay = new Date(last); lastDay.setHours(0,0,0,0);
      if (today > lastDay) { mutated = true; continue; }
      survivors.push(r);
    }
    if (mutated) rec.reminders = survivors;

    if (!todaySched) {
      if (mutated) await putSubscriber(env, rec);
      continue;
    }

    for (const r of rec.reminders) {
      const matched = todaySched.sessions.filter(s => r.subjects.includes(s.subject));
      if (matched.length === 0) continue;

      // Fixed slot reminders (fire within 1-min window since cron is 1 min)
      for (const slot of r.times) {
        const [hStr, mStr] = slot.split(":");
        if (!hStr || !mStr) continue;
        const slotMins = parseInt(hStr) * 60 + parseInt(mStr);
        const diff = currentMins - slotMins;
        if (diff < 0 || diff > 1) continue;
        const key = `${r.id}|${todayISO}|${slot}`;
        if (rec.sent[key]) continue;
        const ok = await sendPush(env, rec, {
          title: `📚 Reminder: ${r.subjects.join(", ")}`,
          body: matched.map(s => `S${s.slot} · ${s.time} · ${s.subject}`).join("\n"),
          tag: key,
        });
        if (ok) { rec.sent[key] = true; mutated = true; }
        else if (!(await getSubscriber(env, endpoint))) {
          // Subscriber was just purged by 410 handler; bail
          mutated = false;
          break;
        }
      }

      // Pre-class nudge (15 min before each matched session)
      if (r.preClassNudge) {
        for (const sess of matched) {
          const startMins = parseStartMinutes(sess.time);
          if (startMins === null) continue;
          const target = startMins - 15;
          const diff = currentMins - target;
          if (diff < 0 || diff > 1) continue;
          const key = `preclass|${r.id}|${todayISO}|${sess.slot}|${sess.subject}`;
          if (rec.sent[key]) continue;
          const ok = await sendPush(env, rec, {
            title: `⏰ ${sess.subject} starts in 15 min`,
            body: `Slot S${sess.slot} · ${sess.time}`,
            tag: key,
          });
          if (ok) { rec.sent[key] = true; mutated = true; }
        }
      }
    }

    if (mutated) {
      // Re-check existence in case the record was purged mid-iteration
      const stillExists = await getSubscriber(env, endpoint);
      if (stillExists) await putSubscriber(env, rec);
    }
  }
}

// ---------- HTTP router ----------
async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (p === "/api/healthz") return json({ status: "ok" });

  if (p === "/api/schedule" && method === "GET") {
    const data = await getSchedule(env).catch(e => ({ error: (e as Error).message }));
    if ("error" in data) return errResp(data.error, 500);
    return json(data);
  }

  if (p === "/api/push/vapid-public-key") {
    return json({ publicKey: env.VAPID_PUBLIC_KEY });
  }

  if (p === "/api/push/subscribe" && method === "POST") {
    const body = await request.json<{ subscription?: PushSubscriptionJSON }>().catch(() => ({} as { subscription?: PushSubscriptionJSON }));
    const s = body.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return errResp("Invalid subscription");
    const rec = await upsertSubscription(env, s);
    return json({ ok: true, endpoint: s.endpoint, reminderCount: rec.reminders.length });
  }

  if (p === "/api/push/unsubscribe" && method === "POST") {
    const body = await request.json<{ endpoint?: string }>().catch(() => ({} as { endpoint?: string }));
    if (!body.endpoint) return errResp("endpoint required");
    await deleteSubscriber(env, body.endpoint);
    return json({ ok: true });
  }

  if (p === "/api/push/reminders" && method === "GET") {
    const endpoint = url.searchParams.get("endpoint") ?? "";
    if (!endpoint) return errResp("endpoint required");
    const rec = await getSubscriber(env, endpoint);
    return json({ reminders: rec?.reminders ?? [] });
  }

  if (p === "/api/push/reminders" && method === "POST") {
    const body = await request.json<{ endpoint?: string; reminder?: Omit<Reminder, "id" | "createdAt"> }>().catch(() => ({} as { endpoint?: string; reminder?: Omit<Reminder, "id" | "createdAt"> }));
    if (!body.endpoint || !body.reminder) return errResp("endpoint and reminder required");
    if (!body.reminder.subjects?.length || !body.reminder.times?.length) return errResp("subjects and times required");
    const rec = await getSubscriber(env, body.endpoint);
    if (!rec) return errResp("subscription not found", 404);
    const reminder: Reminder = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      subjects: body.reminder.subjects,
      times: body.reminder.times,
      preClassNudge: !!body.reminder.preClassNudge,
      createdAt: new Date().toISOString(),
    };
    rec.reminders.push(reminder);
    rec.updatedAt = new Date().toISOString();
    await putSubscriber(env, rec);
    return json({ ok: true, reminder, reminders: rec.reminders });
  }

  // DELETE /api/push/reminders/:id?endpoint=...
  const reminderMatch = p.match(/^\/api\/push\/reminders\/([^/]+)$/);
  if (reminderMatch && method === "DELETE") {
    const id = reminderMatch[1]!;
    const endpoint = url.searchParams.get("endpoint") ?? "";
    if (!endpoint) return errResp("endpoint required");
    const rec = await getSubscriber(env, endpoint);
    if (!rec) return json({ ok: true, reminders: [] });
    rec.reminders = rec.reminders.filter(r => r.id !== id);
    rec.updatedAt = new Date().toISOString();
    await putSubscriber(env, rec);
    return json({ ok: true, reminders: rec.reminders });
  }

  // DELETE /api/push/reminders?endpoint=...  (clear all)
  if (p === "/api/push/reminders" && method === "DELETE") {
    const endpoint = url.searchParams.get("endpoint") ?? "";
    if (!endpoint) return errResp("endpoint required");
    const rec = await getSubscriber(env, endpoint);
    if (rec) {
      rec.reminders = [];
      rec.sent = {};
      rec.updatedAt = new Date().toISOString();
      await putSubscriber(env, rec);
    }
    return json({ ok: true, reminders: [] });
  }

  // Manual cron trigger (debug, requires header)
  if (p === "/api/__cron" && method === "POST") {
    ctx.waitUntil(evaluateAll(env));
    return json({ ok: true });
  }

  return errResp("Not found", 404);
}

// ---------- Exports ----------
const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(evaluateAll(env));
  },
};

export default worker;
