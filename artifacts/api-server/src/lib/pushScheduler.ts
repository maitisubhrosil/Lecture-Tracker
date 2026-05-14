import webpush from "web-push";
import {
  listSubscribers,
  markSent,
  removeReminder,
  removeSubscriber,
  type Reminder,
  type SubscriberRecord,
} from "./pushStore.js";
import { logger } from "./logger.js";

const VAPID_PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"] || "";
const VAPID_PRIVATE_KEY = process.env["VAPID_PRIVATE_KEY"] || "";
const VAPID_SUBJECT = process.env["VAPID_SUBJECT"] || "mailto:admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ---- Schedule lookup (uses cached schedule fetched by routes/schedule.ts) ----
interface Session { slot: number; time: string; subject: string }
interface DaySchedule { date: string; day: string; week: string; sessions: Session[] }

// Re-use the cached schedule by importing the fetch function lazily
import type { ScheduleData } from "../routes/schedule.js";
import { getCachedSchedule } from "../routes/schedule.js";

function parseScheduleDateStr(dateStr: string): Date | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [day, month, yearShort] = parts;
  const d = new Date(`${day} ${month} 20${yearShort}`);
  return isNaN(d.getTime()) ? null : d;
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayLocalISO(): string {
  return localISO(new Date());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseStartMinutes(timeRange: string): number | null {
  const m = timeRange.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function findTodaySchedule(data: ScheduleData | null): DaySchedule | null {
  if (!data) return null;
  const today = new Date();
  for (const day of data.schedule) {
    const d = parseScheduleDateStr(day.date);
    if (d && isSameDay(d, today)) return day;
  }
  return null;
}

function lastOccurrenceDate(data: ScheduleData | null, subjects: string[]): Date | null {
  if (!data) return null;
  let last: Date | null = null;
  for (const day of data.schedule) {
    const hasMatch = day.sessions.some(s => subjects.includes(s.subject));
    if (!hasMatch) continue;
    const d = parseScheduleDateStr(day.date);
    if (!d) continue;
    if (!last || d > last) last = d;
  }
  return last;
}

async function sendPush(rec: SubscriberRecord, payload: object): Promise<boolean> {
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
    return true;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    logger.warn({ endpoint: rec.subscription.endpoint, status }, "push failed");
    if (status === 404 || status === 410) {
      // subscription expired/invalid; remove
      removeSubscriber(rec.subscription.endpoint);
    }
    return false;
  }
}

async function evaluateReminder(rec: SubscriberRecord, reminder: Reminder, scheduleData: ScheduleData | null) {
  const todaySched = findTodaySchedule(scheduleData);
  if (!todaySched) return;

  const matchedSessions = todaySched.sessions.filter(s => reminder.subjects.includes(s.subject));
  if (matchedSessions.length === 0) return;

  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const todayISO = todayLocalISO();

  // 1) Fixed time-of-day reminders
  for (const slot of reminder.times) {
    const [hStr, mStr] = slot.split(":");
    const slotMins = parseInt(hStr) * 60 + parseInt(mStr);
    const diff = currentMins - slotMins;
    if (diff < 0 || diff > 5) continue; // 5-minute fire window
    const key = `${reminder.id}|${todayISO}|${slot}`;
    if (rec.sent[key]) continue;

    const title = `📚 Reminder: ${reminder.subjects.join(", ")}`;
    const body = matchedSessions.map(s => `S${s.slot} · ${s.time} · ${s.subject}`).join("\n");
    const ok = await sendPush(rec, { title, body, tag: key });
    if (ok) markSent(rec.subscription.endpoint, key);
  }

  // 2) Pre-class nudge (15 min before each matched session start)
  if (reminder.preClassNudge) {
    for (const sess of matchedSessions) {
      const startMins = parseStartMinutes(sess.time);
      if (startMins === null) continue;
      const targetMins = startMins - 15;
      const diff = currentMins - targetMins;
      if (diff < 0 || diff > 5) continue;
      const key = `preclass|${reminder.id}|${todayISO}|${sess.slot}|${sess.subject}`;
      if (rec.sent[key]) continue;

      const title = `⏰ ${sess.subject} starts in 15 min`;
      const body = `Slot S${sess.slot} · ${sess.time}`;
      const ok = await sendPush(rec, { title, body, tag: key });
      if (ok) markSent(rec.subscription.endpoint, key);
    }
  }
}

function autoExpireReminders(rec: SubscriberRecord, scheduleData: ScheduleData | null) {
  if (!scheduleData) return;
  // Compare in local-date terms (ignore time-of-day)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const r of [...rec.reminders]) {
    const last = lastOccurrenceDate(scheduleData, r.subjects);
    if (!last) {
      // No occurrences at all in the schedule for any selected subject → drop
      removeReminder(rec.subscription.endpoint, r.id);
      logger.info({ id: r.id, subjects: r.subjects }, "reminder auto-expired (no occurrences)");
      continue;
    }
    const lastDay = new Date(last);
    lastDay.setHours(0, 0, 0, 0);
    if (today > lastDay) {
      removeReminder(rec.subscription.endpoint, r.id);
      logger.info({ id: r.id, subjects: r.subjects, last: last.toISOString() }, "reminder auto-expired");
    }
  }
}

async function tick() {
  try {
    const scheduleData = getCachedSchedule();
    const subs = listSubscribers();
    for (const rec of subs) {
      autoExpireReminders(rec, scheduleData);
      const fresh = listSubscribers().find(s => s.subscription.endpoint === rec.subscription.endpoint);
      if (!fresh) continue;
      for (const reminder of fresh.reminders) {
        await evaluateReminder(fresh, reminder, scheduleData);
      }
    }
  } catch (err) {
    logger.error({ err }, "push scheduler tick failed");
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startPushScheduler() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logger.warn("VAPID keys not set; push scheduler disabled");
    return;
  }
  if (intervalHandle) return;
  logger.info("Starting push scheduler (60s tick)");
  // Run once shortly after startup, then every minute
  setTimeout(() => { void tick(); }, 5_000);
  intervalHandle = setInterval(() => { void tick(); }, 60_000);
}

export function stopPushScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
