import { Router } from "express";
import {
  upsertSubscription,
  replaceReminders,
  addReminder,
  removeReminder,
  clearReminders,
  removeSubscriber,
  getSubscriber,
  type Reminder,
  type PushSubscriptionJSON,
} from "../lib/pushStore.js";

const pushRouter = Router();

const VAPID_PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"] || "";

pushRouter.get("/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

pushRouter.post("/push/subscribe", (req, res) => {
  const sub = req.body?.subscription as PushSubscriptionJSON | undefined;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  const rec = upsertSubscription(sub);
  res.json({ ok: true, endpoint: sub.endpoint, reminderCount: rec.reminders.length });
});

pushRouter.post("/push/unsubscribe", (req, res) => {
  const endpoint = req.body?.endpoint as string | undefined;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  removeSubscriber(endpoint);
  res.json({ ok: true });
});

pushRouter.get("/push/reminders", (req, res) => {
  const endpoint = (req.query["endpoint"] as string) || "";
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  const rec = getSubscriber(endpoint);
  res.json({ reminders: rec?.reminders ?? [] });
});

pushRouter.post("/push/reminders", (req, res) => {
  const endpoint = req.body?.endpoint as string | undefined;
  const reminder = req.body?.reminder as Omit<Reminder, "id" | "createdAt"> | undefined;
  if (!endpoint || !reminder) {
    return res.status(400).json({ error: "endpoint and reminder required" });
  }
  if (!reminder.subjects?.length || !reminder.times?.length) {
    return res.status(400).json({ error: "subjects and times are required" });
  }
  const full: Reminder = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    subjects: reminder.subjects,
    times: reminder.times,
    preClassNudge: !!reminder.preClassNudge,
    createdAt: new Date().toISOString(),
  };
  addReminder(endpoint, full);
  const rec = getSubscriber(endpoint);
  res.json({ ok: true, reminder: full, reminders: rec?.reminders ?? [] });
});

pushRouter.delete("/push/reminders/:id", (req, res) => {
  const endpoint = (req.query["endpoint"] as string) || "";
  const id = req.params["id"] || "";
  if (!endpoint || !id) return res.status(400).json({ error: "endpoint and id required" });
  removeReminder(endpoint, id);
  const rec = getSubscriber(endpoint);
  res.json({ ok: true, reminders: rec?.reminders ?? [] });
});

pushRouter.delete("/push/reminders", (req, res) => {
  const endpoint = (req.query["endpoint"] as string) || (req.body?.endpoint as string) || "";
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  clearReminders(endpoint);
  res.json({ ok: true, reminders: [] });
});

pushRouter.put("/push/reminders", (req, res) => {
  const endpoint = req.body?.endpoint as string | undefined;
  const reminders = req.body?.reminders as Reminder[] | undefined;
  if (!endpoint || !Array.isArray(reminders)) {
    return res.status(400).json({ error: "endpoint and reminders required" });
  }
  replaceReminders(endpoint, reminders);
  res.json({ ok: true, reminders });
});

export default pushRouter;
