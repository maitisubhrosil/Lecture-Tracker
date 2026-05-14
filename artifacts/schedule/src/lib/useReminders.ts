import { useState, useEffect, useCallback, useRef } from "react";
import type { ScheduleData } from "./useScheduleData";

export interface Reminder {
  id: string;
  subjects: string[];
  date: string; // YYYY-MM-DD
  timeSlots: string[]; // HH:mm (24h)
  createdAt: string;
  lastFiredKey?: string; // last reminderId+date+slot it fired for
}

const STORAGE_KEY = "epgp_reminders";
const FIRED_KEY = "epgp_reminders_fired"; // keys: `${id}|${date}|${slot}` => true

// n time-slot options: every 30 minutes from 06:00 to 22:00 (33 slots)
export const TIME_SLOT_OPTIONS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 6; h <= 22; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
})();

export function formatSlotLabel(slot: string): string {
  const [hStr, m] = slot.split(":");
  const h = parseInt(hStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

function loadReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveReminders(list: Reminder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function loadFired(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFired(fired: Record<string, boolean>) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {}
}

function todayLocalISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseScheduleDate(dateStr: string): Date | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [day, month, yearShort] = parts;
  const d = new Date(`${day} ${month} 20${yearShort}`);
  return isNaN(d.getTime()) ? null : d;
}

function isoToScheduleDate(iso: string, schedule: ScheduleData["schedule"]): typeof schedule[number] | null {
  const target = new Date(iso + "T00:00:00");
  for (const day of schedule) {
    const d = parseScheduleDate(day.date);
    if (!d) continue;
    if (
      d.getFullYear() === target.getFullYear() &&
      d.getMonth() === target.getMonth() &&
      d.getDate() === target.getDate()
    ) {
      return day;
    }
  }
  return null;
}

export function useReminders(scheduleData: ScheduleData | undefined) {
  const [reminders, setReminders] = useState<Reminder[]>(() => loadReminders());
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );
  const scheduleRef = useRef(scheduleData);
  scheduleRef.current = scheduleData;

  useEffect(() => {
    saveReminders(reminders);
  }, [reminders]);

  const addReminder = useCallback((r: Omit<Reminder, "id" | "createdAt">) => {
    const newReminder: Reminder = {
      ...r,
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    setReminders(prev => [...prev, newReminder]);
    return newReminder;
  }, []);

  const removeReminder = useCallback((id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id));
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied" as NotificationPermission;
    const p = await Notification.requestPermission();
    setPermission(p);
    return p;
  }, []);

  // Scheduler tick: every 30 seconds, check if any reminder slot is due
  // A slot is "due" when the current time is at-or-past the slot time
  // within a 60-minute tolerance window (handles brief tab inactivity)
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const todayISO = todayLocalISO();

      const fired = loadFired();
      let firedDirty = false;

      reminders.forEach(r => {
        if (r.date !== todayISO) return;

        const dueSlots = r.timeSlots.filter(slot => {
          const [h, m] = slot.split(":").map(Number);
          const slotMins = h * 60 + m;
          const diff = currentMins - slotMins;
          return diff >= 0 && diff <= 60;
        });
        if (dueSlots.length === 0) return;

        // Pick the latest due slot that hasn't been fired
        const slot = [...dueSlots].reverse().find(s => !fired[`${r.id}|${r.date}|${s}`]);
        if (!slot) return;
        const key = `${r.id}|${r.date}|${slot}`;

        // Build message
        const daySched = scheduleRef.current
          ? isoToScheduleDate(r.date, scheduleRef.current.schedule)
          : null;
        const matchedSessions = daySched
          ? daySched.sessions.filter(s => r.subjects.includes(s.subject))
          : [];

        const title = matchedSessions.length
          ? `📚 Reminder: ${r.subjects.join(", ")}`
          : `📚 Reminder: ${r.subjects.join(", ")}`;

        const body = matchedSessions.length
          ? matchedSessions
              .map(s => `S${s.slot} · ${s.time} · ${s.subject}`)
              .join("\n")
          : `No scheduled sessions found for ${r.subjects.join(", ")} on this date.`;

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(title, { body, tag: key });
          } catch {}
        }

        fired[key] = true;
        firedDirty = true;
      });

      if (firedDirty) saveFired(fired);
    };

    // Run immediately, then every 30s
    tick();
    const interval = setInterval(tick, 30 * 1000);
    return () => clearInterval(interval);
  }, [reminders]);

  return {
    reminders,
    addReminder,
    removeReminder,
    permission,
    requestPermission,
    timeSlotOptions: TIME_SLOT_OPTIONS,
  };
}
