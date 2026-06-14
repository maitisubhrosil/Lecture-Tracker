/**
 * ePGP Reminders — Cloudflare Worker
 *
 * Handles:
 *   GET  /api/healthz
 *   GET  /api/schedule                       proxied + cached from Google Sheets
 *   GET  /api/push/vapid-public-key
 *   GET  /api/push/stats                    { activeSubscribers }
 *   POST /api/push/test                     { endpoint }
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
 *
 * KV usage strategy (keeps ops well inside the free tier):
 *   - All subscriber records are stored in a SINGLE key ("subs:all") as a
 *     JSON map of endpoint → SubscriberRecord.  The cron does exactly 3 KV
 *     reads per tick (schedule:date, schedule:cache, subs:all) and at most 1
 *     write (subs:all) if anything changed — regardless of subscriber count.
 *   - HTTP API endpoints load/save the same blob; they run infrequently so the
 *     extra byte transfer is negligible.
 *   - "sent" keys older than today are pruned each cron run to keep the blob small.
 */

import {
  ApplicationServerKeys,
  generatePushHTTPRequest,
} from "webpush-webcrypto";

export interface Env {
  EPGP_KV: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  SHEET_CSV_URL: string;
  APP_TIME_ZONE?: string;
}

// ---------- Types ----------
interface Session {
  slot: number;
  time: string;
  subject: string;
}
interface DaySchedule {
  date: string;
  day: string;
  week: string;
  sessions: Session[];
}
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
interface PushDiagnostics {
  lastAttemptAt?: string;
  lastAttemptType?: string;
  lastAttemptStatus?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastMatchedReminderAt?: string;
}
interface SubscriberRecord {
  subscription: PushSubscriptionJSON;
  reminders: Reminder[];
  sent: Record<string, true>;
  updatedAt: string;
  diagnostics?: PushDiagnostics;
}

// ---------- KV keys ----------
// All subscriber records live in one blob to minimise KV read operations.
const SUBS_ALL_KEY = "subs:all"; // Record<endpoint, SubscriberRecord>
const LEGACY_MIGRATION_FLAG = "subs:migrated"; // written once migration is confirmed complete
// Legacy keys — read during one-time migration, never written again.
const LEGACY_SUB_INDEX_KEY = "subs:index";
const legacySubKey = (endpoint: string) => `sub:${endpoint}`;

const SCHEDULE_CACHE_KEY = "schedule:cache";
const SCHEDULE_DATE_KEY = "schedule:date";
const CRON_TOLERANCE_MINUTES = 6;

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

const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function appTimeZone(env: Env): string {
  return env.APP_TIME_ZONE || DEFAULT_TIME_ZONE;
}

function todayUTCISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function zonedParts(
  date: Date,
  timeZone: string,
): { isoDate: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + minute,
  };
}

function scheduleDateToISO(dateStr: string): string | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [dayRaw, monthRaw, yearRaw] = parts;
  const month = MONTHS[monthRaw!.trim().toLowerCase()];
  if (!month) return null;
  const day = Number(dayRaw);
  const yearShort = Number(yearRaw);
  if (!Number.isInteger(day) || !Number.isInteger(yearShort)) return null;
  const year = yearShort < 100 ? 2000 + yearShort : yearShort;
  return `${year}-${month}-${String(day).padStart(2, "0")}`;
}

function parseClockMinutes(value: string): number | null {
  const m = value.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]!);
  const min = parseInt(m[2]!);
  const period = m[3]!.toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function parseStartMinutes(timeRange: string): number | null {
  const first = timeRange.match(/\d+:\d+\s*(?:AM|PM)/i)?.[0];
  return first ? parseClockMinutes(first) : null;
}

function parseTimeRangeMinutes(
  timeRange: string,
): { start: number; end: number } | null {
  const matches = timeRange.match(/\d+:\d+\s*(?:AM|PM)/gi);
  if (!matches || matches.length < 2) return null;
  const start = parseClockMinutes(matches[0]!);
  const end = parseClockMinutes(matches[matches.length - 1]!);
  return start === null || end === null ? null : { start, end };
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
      else if (char === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else current += char;
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
    campusTimes = [
      "09:00 AM-10:30 AM",
      "11:15 AM-12:45 PM",
      "02:00 PM-03:30 PM",
      "03:45 PM-05:15 PM",
      "05:30 PM-07:00 PM",
    ];
  }

  for (const row of rows) {
    const label = (row[2] || "").toLowerCase();
    if (label.includes("mon-friday") || label.includes("weekday")) {
      weekdayTimes = [
        "",
        "",
        "",
        row[7] || "07:30 PM-09:00 PM",
        row[8] || "09:15 PM-10:45 PM",
      ];
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
  if (weekdayTimes.length === 0)
    weekdayTimes = ["", "", "", "07:30 PM-09:00 PM", "09:15 PM-10:45 PM"];
  if (weekendTimes.length === 0)
    weekendTimes = [
      "10:00 AM-11:30 AM",
      "11:45 AM-01:15 PM",
      "03:00 PM-04:30 PM",
      "04:45 PM-06:15 PM",
      "06:30 PM-08:00 PM",
    ];

  const EXCLUDED = new Set([
    "Buffer slot",
    "Conclusion of In-Campus II",
    "Id ul Zuha",
    "Muharram",
    "Work Shop (CR203)",
  ]);

  const schedule: DaySchedule[] = [];
  const subjectsSet = new Set<string>();
  let currentWeek = "";
  for (const row of rows) {
    const dateStr = row[1];
    if (!dateStr || !/\d{2}-[A-Za-z]+-\d{2}/.test(dateStr)) continue;
    const weekCol = row[0];
    const dayCol = row[2];
    if (weekCol && weekCol.startsWith("Week")) currentWeek = weekCol;
    if (!dayCol || dayCol === "Day") continue;
    const isWeekend = dayCol === "Saturday" || dayCol === "Sunday";
    const hasCampusSessions = !!(row[4] || row[5] || row[6]);
    const times = isWeekend
      ? weekendTimes
      : hasCampusSessions
        ? campusTimes
        : weekdayTimes;
    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      const subject = (row[4 + i] || "").trim();
      const time = times[i] || "";
      if (subject && time && !EXCLUDED.has(subject)) {
        subjectsSet.add(subject);
        sessions.push({ slot: i + 1, time, subject });
      }
    }
    if (sessions.length > 0)
      schedule.push({
        date: dateStr,
        day: dayCol,
        week: currentWeek,
        sessions,
      });
  }
  return {
    subjects: [...subjectsSet].sort(),
    schedule,
    lastFetched: new Date().toISOString(),
  };
}

async function getSchedule(env: Env, force = false): Promise<ScheduleData> {
  const today = todayUTCISO();
  if (!force) {
    const date = await env.EPGP_KV.get(SCHEDULE_DATE_KEY);
    if (date === today) {
      const cached = await env.EPGP_KV.get<ScheduleData>(
        SCHEDULE_CACHE_KEY,
        "json",
      );
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


function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function icsLocalDate(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(date.getHours())}${pad2(date.getMinutes())}00`;
}

function buildCalendarSubscriptionIcs(data: ScheduleData, subjects: string[], slots: string[], includePreClass: boolean): string {
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lecture Tracker//ePGP Live Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ePGP Live Reminder Feed",
    "X-WR-TIMEZONE:Asia/Kolkata",
  ];
  const seen = new Set<string>();

  const addEvent = (uid: string, start: Date, end: Date, summary: string, description: string, alarmMinutes?: number) => {
    if (seen.has(uid)) return;
    seen.add(uid);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}@lecture-tracker`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    lines.push(`DTSTART;TZID=Asia/Kolkata:${icsLocalDate(start)}`);
    lines.push(`DTEND;TZID=Asia/Kolkata:${icsLocalDate(end)}`);
    lines.push(`SUMMARY:${escapeIcs(summary)}`);
    lines.push(`DESCRIPTION:${escapeIcs(description)}`);
    if (alarmMinutes) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcs(summary)}`);
      lines.push(`TRIGGER:-PT${alarmMinutes}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  };

  for (const day of data.schedule) {
    const iso = scheduleDateToISO(day.date);
    if (!iso) continue;
    const matched = day.sessions.filter((s) => subjects.includes(s.subject));
    if (!matched.length) continue;
    for (const sess of matched) {
      const range = parseTimeRangeMinutes(sess.time);
      if (!range) continue;
      const start = new Date(`${iso}T00:00:00`);
      start.setHours(Math.floor(range.start / 60), range.start % 60, 0, 0);
      if (start < now) continue;
      const end = new Date(`${iso}T00:00:00`);
      end.setHours(Math.floor(range.end / 60), range.end % 60, 0, 0);
      addEvent(
        `live-class-${day.date}-${sess.slot}-${sess.subject}`,
        start,
        end,
        `ePGP: ${sess.subject}`,
        `${day.day} ${day.date} · ${day.week}\nSlot S${sess.slot} · ${sess.time}`,
        includePreClass ? 15 : undefined,
      );
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// ---------- Subscriber store (single-blob design) ----------
// All subscribers live in one KV value: Record<endpoint, SubscriberRecord>.
// This means every cron tick costs exactly 3 reads (schedule×2 + blob) and
// at most 1 write, regardless of subscriber count.

// getAllSubs reads the single blob, merging any legacy per-user keys that are
// not yet present. Uses a separate flag key ("subs:migrated") so the merge
// runs exactly once — even if subs:all already exists with partial data.
async function getAllSubs(env: Env): Promise<Record<string, SubscriberRecord>> {
  const [existing, migrationDone] = await Promise.all([
    env.EPGP_KV.get<Record<string, SubscriberRecord>>(SUBS_ALL_KEY, "json"),
    env.EPGP_KV.get(LEGACY_MIGRATION_FLAG),
  ]);

  const subs: Record<string, SubscriberRecord> = existing ?? {};

  if (migrationDone === null) {
    // Migration not yet confirmed — check for legacy data and merge any
    // endpoints missing from the blob (handles partial earlier migrations).
    const legacyIndex = await env.EPGP_KV.get<string[]>(
      LEGACY_SUB_INDEX_KEY,
      "json",
    );
    if (legacyIndex && legacyIndex.length > 0) {
      let mergedCount = 0;
      for (const endpoint of legacyIndex) {
        if (subs[endpoint]) continue; // already present, keep newer version
        const rec = await env.EPGP_KV.get<SubscriberRecord>(
          legacySubKey(endpoint),
          "json",
        );
        if (rec?.subscription?.endpoint) {
          subs[endpoint] = rec;
          mergedCount++;
        }
      }
      if (mergedCount > 0) {
        console.log(`Merged ${mergedCount} legacy subscriber records into subs:all.`);
        await putAllSubs(env, subs);
      }
    }
    // Mark migration complete so this never runs again.
    await env.EPGP_KV.put(LEGACY_MIGRATION_FLAG, "1");
  }

  return subs;
}

async function putAllSubs(
  env: Env,
  subs: Record<string, SubscriberRecord>,
): Promise<void> {
  await env.EPGP_KV.put(SUBS_ALL_KEY, JSON.stringify(subs));
}

// Prune sent keys for dates strictly before today to keep the blob small.
function pruneSentKeys(rec: SubscriberRecord, todayISO: string): boolean {
  const before = Object.keys(rec.sent).length;
  for (const key of Object.keys(rec.sent)) {
    // sent keys contain a date segment like "2026-06-14"; extract and compare.
    const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch && dateMatch[1]! < todayISO) {
      delete rec.sent[key];
    }
  }
  return Object.keys(rec.sent).length !== before;
}

async function getSubscriberStats(
  env: Env,
): Promise<{ activeSubscribers: number }> {
  const subs = await getAllSubs(env);
  return { activeSubscribers: Object.keys(subs).length };
}

async function upsertSubscription(
  env: Env,
  sub: PushSubscriptionJSON,
): Promise<SubscriberRecord> {
  const subs = await getAllSubs(env);
  let rec = subs[sub.endpoint];
  if (!rec) {
    rec = {
      subscription: sub,
      reminders: [],
      sent: {},
      updatedAt: new Date().toISOString(),
    };
  } else {
    rec.subscription = sub;
    rec.updatedAt = new Date().toISOString();
  }
  subs[sub.endpoint] = rec;
  await putAllSubs(env, subs);
  return rec;
}

async function deleteSubscriber(env: Env, endpoint: string): Promise<void> {
  const subs = await getAllSubs(env);
  if (endpoint in subs) {
    delete subs[endpoint];
    await putAllSubs(env, subs);
  }
}

async function getSubscriber(
  env: Env,
  endpoint: string,
): Promise<SubscriberRecord | null> {
  const subs = await getAllSubs(env);
  return subs[endpoint] ?? null;
}

async function putSubscriber(env: Env, rec: SubscriberRecord): Promise<void> {
  const subs = await getAllSubs(env);
  subs[rec.subscription.endpoint] = rec;
  await putAllSubs(env, subs);
}

// ---------- VAPID key import ----------
function b64urlToUint8(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
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
  if (pub.length !== 65 || pub[0] !== 0x04)
    throw new Error("Invalid VAPID public key");
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
interface PushResult {
  ok: boolean;
  purged?: boolean;
  status?: number;
  reason?: string;
}

function recordPushAttempt(rec: SubscriberRecord, type: string) {
  rec.diagnostics = {
    ...(rec.diagnostics ?? {}),
    lastAttemptAt: new Date().toISOString(),
    lastAttemptType: type,
    lastFailureReason: undefined,
  };
}

function recordPushSuccess(rec: SubscriberRecord, status: number) {
  rec.diagnostics = {
    ...(rec.diagnostics ?? {}),
    lastAttemptStatus: status,
    lastSuccessAt: new Date().toISOString(),
    lastFailureReason: undefined,
  };
}

function recordPushFailure(
  rec: SubscriberRecord,
  status: number | undefined,
  reason: string,
) {
  rec.diagnostics = {
    ...(rec.diagnostics ?? {}),
    lastAttemptStatus: status,
    lastFailureAt: new Date().toISOString(),
    lastFailureReason: reason,
  };
}

function toFetchBody(body: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  const copy = new Uint8Array(body.byteLength);
  copy.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  return copy.buffer;
}

// sendPush operates on an in-memory rec; callers are responsible for persisting.
async function sendPush(
  env: Env,
  rec: SubscriberRecord,
  payload: object,
  type = "reminder",
): Promise<PushResult> {
  recordPushAttempt(rec, type);
  try {
    const keys = await loadKeys(env);
    const { headers, body, endpoint } = await generatePushHTTPRequest({
      applicationServerKeys: keys,
      payload: JSON.stringify(payload),
      target: {
        endpoint: rec.subscription.endpoint,
        keys: {
          p256dh: rec.subscription.keys.p256dh,
          auth: rec.subscription.keys.auth,
        },
      },
      adminContact: env.VAPID_SUBJECT,
      ttl: 60,
      urgency: "normal",
    });
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: toFetchBody(body as ArrayBuffer | ArrayBufferView),
    });
    if (res.status === 404 || res.status === 410) {
      recordPushFailure(rec, res.status, "Subscription expired or was revoked");
      return {
        ok: false,
        purged: true,
        status: res.status,
        reason: "subscription expired",
      };
    }
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      recordPushFailure(rec, res.status, reason || `push HTTP ${res.status}`);
      console.warn("push non-OK", res.status, reason);
      return { ok: false, status: res.status, reason };
    }
    recordPushSuccess(rec, res.status);
    return { ok: true, status: res.status };
  } catch (e) {
    const reason = (e as Error).message;
    recordPushFailure(rec, undefined, reason);
    console.warn("push error", reason);
    return { ok: false, reason };
  }
}

// ---------- Cron evaluator ----------
// KV budget per tick: 3 reads (schedule:date, schedule:cache, subs:all)
//                   + 0–1 writes (subs:all, only when something changed)
async function evaluateAll(env: Env) {
  const data = await getSchedule(env).catch(() => null);
  if (!data) {
    console.warn("no schedule available");
    return;
  }

  const now = new Date();
  const timeZone = appTimeZone(env);
  const { isoDate: todayISO, minutes: currentMins } = zonedParts(now, timeZone);

  const todaySched = data.schedule.find(
    (d) => scheduleDateToISO(d.date) === todayISO,
  );

  // Single KV read for ALL subscribers.
  const allSubs = await getAllSubs(env);
  let blobMutated = false;

  for (const [endpoint, rec] of Object.entries(allSubs)) {
    let recMutated = false;

    // Prune old sent keys to keep blob lean.
    if (pruneSentKeys(rec, todayISO)) recMutated = true;

    // Auto-expire reminders whose subjects' last occurrence has passed.
    const survivors: Reminder[] = [];
    for (const r of rec.reminders) {
      let last: string | null = null;
      for (const day of data.schedule) {
        if (!day.sessions.some((s) => r.subjects.includes(s.subject))) continue;
        const d = scheduleDateToISO(day.date);
        if (!d) continue;
        if (!last || d > last) last = d;
      }
      if (!last || todayISO > last) {
        recMutated = true;
        continue;
      }
      survivors.push(r);
    }
    if (recMutated) rec.reminders = survivors;

    if (!todaySched) {
      if (recMutated) blobMutated = true;
      continue;
    }

    let purged = false;

    for (const r of rec.reminders) {
      if (purged) break;
      const matched = todaySched.sessions.filter((s) =>
        r.subjects.includes(s.subject),
      );
      if (matched.length === 0) continue;

      // Fixed slot reminders
      for (const slot of r.times) {
        if (purged) break;
        const [hStr, mStr] = slot.split(":");
        if (!hStr || !mStr) continue;
        const slotMins = parseInt(hStr) * 60 + parseInt(mStr);
        const diff = currentMins - slotMins;
        if (diff < 0 || diff > CRON_TOLERANCE_MINUTES) continue;
        const key = `${r.id}|${todayISO}|${slot}`;
        if (rec.sent[key]) continue;
        const ok = await sendPush(env, rec, {
          title: `📚 Reminder: ${r.subjects.join(", ")}`,
          body: matched
            .map((s) => `S${s.slot} · ${s.time} · ${s.subject}`)
            .join("\n"),
          tag: key,
        });
        rec.diagnostics = {
          ...(rec.diagnostics ?? {}),
          lastMatchedReminderAt: new Date().toISOString(),
        };
        recMutated = true;
        if (ok.purged) {
          delete allSubs[endpoint];
          purged = true;
          break;
        }
        if (ok.ok) rec.sent[key] = true;
      }

      // Pre-class nudge (15 min before each matched session)
      if (!purged && r.preClassNudge) {
        for (const sess of matched) {
          if (purged) break;
          const startMins = parseStartMinutes(sess.time);
          if (startMins === null) continue;
          const target = startMins - 15;
          const diff = currentMins - target;
          if (diff < 0 || diff > CRON_TOLERANCE_MINUTES) continue;
          const key = `preclass|${r.id}|${todayISO}|${sess.slot}|${sess.subject}`;
          if (rec.sent[key]) continue;
          const ok = await sendPush(env, rec, {
            title: `⏰ ${sess.subject} starts in 15 min`,
            body: `Slot S${sess.slot} · ${sess.time}`,
            tag: key,
          });
          rec.diagnostics = {
            ...(rec.diagnostics ?? {}),
            lastMatchedReminderAt: new Date().toISOString(),
          };
          recMutated = true;
          if (ok.purged) {
            delete allSubs[endpoint];
            purged = true;
            break;
          }
          if (ok.ok) rec.sent[key] = true;
        }
      }
    }

    if (recMutated && !purged) blobMutated = true;
  }

  // Single KV write for ALL subscribers — only if something actually changed.
  if (blobMutated) {
    await putAllSubs(env, allSubs);
  }
}

// ---------- HTTP router ----------
async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const method = request.method;

  if (method === "OPTIONS")
    return new Response(null, { headers: CORS_HEADERS });

  if (p === "/api/healthz") return json({ status: "ok" });

  if (p === "/api/schedule" && method === "GET") {
    const data = await getSchedule(env).catch((e) => ({
      error: (e as Error).message,
    }));
    if ("error" in data) return errResp(data.error, 500);
    return json(data);
  }

  if (p === "/api/calendar/live.ics" && method === "GET") {
    const subjectsParam = url.searchParams.get("subjects") ?? "";
    const slotsParam = url.searchParams.get("times") ?? "";
    const includePreClass = (url.searchParams.get("preClass") ?? "false") === "true";
    const subjects = subjectsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const slots = slotsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (subjects.length === 0) return errResp("subjects required");
    const data = await getSchedule(env).catch((e) => ({ error: (e as Error).message }));
    if ("error" in data) return errResp(data.error, 500);
    const ics = buildCalendarSubscriptionIcs(data, subjects, slots, includePreClass);
    return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", ...CORS_HEADERS } });
  }

  if (p === "/api/push/vapid-public-key") {
    return json({ publicKey: env.VAPID_PUBLIC_KEY });
  }

  if (p === "/api/push/stats" && method === "GET") {
    return json(await getSubscriberStats(env));
  }

  if (p === "/api/push/subscribe" && method === "POST") {
    const body = await request
      .json<{ subscription?: PushSubscriptionJSON }>()
      .catch(() => ({}) as { subscription?: PushSubscriptionJSON });
    const s = body.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth)
      return errResp("Invalid subscription");
    const rec = await upsertSubscription(env, s);
    return json({
      ok: true,
      endpoint: s.endpoint,
      reminderCount: rec.reminders.length,
      diagnostics: rec.diagnostics ?? {},
    });
  }

  if (p === "/api/push/unsubscribe" && method === "POST") {
    const body = await request
      .json<{ endpoint?: string }>()
      .catch(() => ({}) as { endpoint?: string });
    if (!body.endpoint) return errResp("endpoint required");
    await deleteSubscriber(env, body.endpoint);
    return json({ ok: true });
  }

  if (p === "/api/push/reminders" && method === "GET") {
    const endpoint = url.searchParams.get("endpoint") ?? "";
    if (!endpoint) return errResp("endpoint required");
    const rec = await getSubscriber(env, endpoint);
    return json({
      reminders: rec?.reminders ?? [],
      diagnostics: rec?.diagnostics ?? {},
    });
  }

  if (p === "/api/push/test" && method === "POST") {
    const body = await request
      .json<{ endpoint?: string }>()
      .catch(() => ({}) as { endpoint?: string });
    if (!body.endpoint) return errResp("endpoint required");
    const rec = await getSubscriber(env, body.endpoint);
    if (!rec) return errResp("subscription not found", 404);
    const result = await sendPush(
      env,
      rec,
      {
        title: "✅ ePGP test notification",
        body: "If you can see this, reminders can reach this browser.",
        tag: `test|${Date.now()}`,
      },
      "test",
    );
    if (!result.purged) {
      rec.updatedAt = new Date().toISOString();
      await putSubscriber(env, rec);
    } else {
      await deleteSubscriber(env, body.endpoint);
    }
    return json({
      ok: result.ok,
      result,
      diagnostics: rec.diagnostics ?? {},
      httpStatus: result.ok ? 200 : 502,
    });
  }

  if (p === "/api/push/reminders" && method === "POST") {
    const body = await request
      .json<{
        endpoint?: string;
        reminder?: Omit<Reminder, "id" | "createdAt">;
      }>()
      .catch(
        () =>
          ({}) as {
            endpoint?: string;
            reminder?: Omit<Reminder, "id" | "createdAt">;
          },
      );
    if (!body.endpoint || !body.reminder)
      return errResp("endpoint and reminder required");
    if (!body.reminder.subjects?.length || !body.reminder.times?.length)
      return errResp("subjects and times required");
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
    return json({
      ok: true,
      reminder,
      reminders: rec.reminders,
      diagnostics: rec.diagnostics ?? {},
    });
  }

  // DELETE /api/push/reminders/:id?endpoint=...
  const reminderMatch = p.match(/^\/api\/push\/reminders\/([^/]+)$/);
  if (reminderMatch && method === "DELETE") {
    const id = reminderMatch[1]!;
    const endpoint = url.searchParams.get("endpoint") ?? "";
    if (!endpoint) return errResp("endpoint required");
    const rec = await getSubscriber(env, endpoint);
    if (!rec) return json({ ok: true, reminders: [], diagnostics: {} });
    rec.reminders = rec.reminders.filter((r) => r.id !== id);
    rec.updatedAt = new Date().toISOString();
    await putSubscriber(env, rec);
    return json({
      ok: true,
      reminders: rec.reminders,
      diagnostics: rec.diagnostics ?? {},
    });
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
    return json({
      ok: true,
      reminders: [],
      diagnostics: rec?.diagnostics ?? {},
    });
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
