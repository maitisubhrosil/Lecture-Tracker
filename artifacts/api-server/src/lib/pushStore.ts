import fs from "node:fs";
import path from "node:path";

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Reminder {
  id: string;
  subjects: string[];
  times: string[]; // ["HH:mm", ...] 24-hour
  preClassNudge: boolean;
  createdAt: string;
}

export interface SubscriberRecord {
  subscription: PushSubscriptionJSON;
  reminders: Reminder[];
  // sent dedupe keys: "reminderId|YYYY-MM-DD|HH:mm" or "preclass|reminderId|YYYY-MM-DD|HH:mm|subject"
  sent: Record<string, true>;
  updatedAt: string;
}

interface Store {
  // keyed by subscription.endpoint
  subscribers: Record<string, SubscriberRecord>;
}

const STORE_PATH = process.env["PUSH_STORE_PATH"] || "./data/push-store.json";

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load(): Store {
  ensureDir();
  try {
    if (!fs.existsSync(STORE_PATH)) return { subscribers: {} };
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Store;
  } catch {
    return { subscribers: {} };
  }
}

let cache: Store = load();

function save() {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2));
}

export function getSubscriber(endpoint: string): SubscriberRecord | undefined {
  return cache.subscribers[endpoint];
}

export function listSubscribers(): SubscriberRecord[] {
  return Object.values(cache.subscribers);
}

export function upsertSubscription(sub: PushSubscriptionJSON): SubscriberRecord {
  const existing = cache.subscribers[sub.endpoint];
  const rec: SubscriberRecord = existing ?? {
    subscription: sub,
    reminders: [],
    sent: {},
    updatedAt: new Date().toISOString(),
  };
  rec.subscription = sub;
  rec.updatedAt = new Date().toISOString();
  cache.subscribers[sub.endpoint] = rec;
  save();
  return rec;
}

export function replaceReminders(endpoint: string, reminders: Reminder[]) {
  const rec = cache.subscribers[endpoint];
  if (!rec) return;
  rec.reminders = reminders;
  rec.updatedAt = new Date().toISOString();
  save();
}

export function addReminder(endpoint: string, reminder: Reminder) {
  const rec = cache.subscribers[endpoint];
  if (!rec) return;
  rec.reminders.push(reminder);
  rec.updatedAt = new Date().toISOString();
  save();
}

export function removeReminder(endpoint: string, reminderId: string) {
  const rec = cache.subscribers[endpoint];
  if (!rec) return;
  rec.reminders = rec.reminders.filter(r => r.id !== reminderId);
  rec.updatedAt = new Date().toISOString();
  save();
}

export function clearReminders(endpoint: string) {
  const rec = cache.subscribers[endpoint];
  if (!rec) return;
  rec.reminders = [];
  rec.sent = {};
  rec.updatedAt = new Date().toISOString();
  save();
}

export function markSent(endpoint: string, key: string) {
  const rec = cache.subscribers[endpoint];
  if (!rec) return;
  rec.sent[key] = true;
  save();
}

export function removeSubscriber(endpoint: string) {
  delete cache.subscribers[endpoint];
  save();
}

export function reload() {
  cache = load();
}
