import { useState, useEffect, useCallback, useRef } from "react";

export interface Reminder {
  id: string;
  subjects: string[];
  times: string[]; // ["HH:mm"]
  preClassNudge: boolean;
  createdAt: string;
}

const ENDPOINT_KEY = "epgp_push_endpoint";

const APP_BASE_PATH = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const SERVICE_WORKER_URL = `${APP_BASE_PATH}sw.js`;
const SERVICE_WORKER_SCOPE = APP_BASE_PATH;

// API base URL — empty string means "same origin" (uses Vite dev proxy or Pages rewrite).
// On GitHub Pages we build with VITE_API_BASE_URL=https://<worker>.workers.dev/api
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// useScheduleData uses a separate URL constant — re-export so it picks up the same base
export const API_SCHEDULE_URL = apiUrl("/api/schedule");

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchJSON<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function usePushReminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [endpoint, setEndpoint] = useState<string | null>(() => localStorage.getItem(ENDPOINT_KEY));
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );
  const [supported, setSupported] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const initRef = useRef(false);

  // Check support
  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
    setSupported(ok);
  }, []);

  // Register SW once. Respect Vite's base path so this also works when the app
  // is deployed under a subdirectory (for example GitHub Pages at /Lecture-Tracker/).
  const registerSW = useCallback(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("SW unsupported");
    let reg = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
    if (!reg) {
      reg = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: SERVICE_WORKER_SCOPE,
      });
    }
    await navigator.serviceWorker.ready;
    return reg;
  }, []);

  // Subscribe to push (requests permission if needed)
  const subscribe = useCallback(async (): Promise<string | null> => {
    if (!supported) return null;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return null;

      const reg = await registerSW();
      const { publicKey } = await fetchJSON<{ publicKey: string }>(apiUrl("/api/push/vapid-public-key"));
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
          });
        } catch (err) {
          // Push service unreachable (incognito / headless / unsupported)
          console.warn("Push subscribe failed:", err);
          return null;
        }
      }
      const subJSON = sub.toJSON();
      await fetchJSON(apiUrl("/api/push/subscribe"), {
        method: "POST",
        body: JSON.stringify({ subscription: subJSON }),
      });
      localStorage.setItem(ENDPOINT_KEY, sub.endpoint);
      setEndpoint(sub.endpoint);
      return sub.endpoint;
    } catch (err) {
      console.warn("Subscribe failed:", err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [supported, registerSW]);

  // Initial load of reminders from backend
  const refreshReminders = useCallback(async (ep: string | null) => {
    if (!ep) return;
    try {
      const data = await fetchJSON<{ reminders: Reminder[] }>(
        apiUrl(`/api/push/reminders?endpoint=${encodeURIComponent(ep)}`),
      );
      setReminders(data.reminders);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      if (supported && Notification.permission === "granted") {
        try {
          const reg = await registerSW();
          const existing = await reg.pushManager.getSubscription();
          if (existing) {
            const ep = existing.endpoint;
            // Re-sync on backend (subscription may not exist server-side)
            await fetchJSON(apiUrl("/api/push/subscribe"), {
              method: "POST",
              body: JSON.stringify({ subscription: existing.toJSON() }),
            }).catch(() => {});
            localStorage.setItem(ENDPOINT_KEY, ep);
            setEndpoint(ep);
            await refreshReminders(ep);
            return;
          }
        } catch {}
      }
      const saved = localStorage.getItem(ENDPOINT_KEY);
      if (saved) await refreshReminders(saved);
    })();
  }, [supported, registerSW, refreshReminders]);

  // Poll reminders every 30s to reflect server-side auto-expiry
  useEffect(() => {
    if (!endpoint) return;
    const i = setInterval(() => { void refreshReminders(endpoint); }, 30_000);
    return () => clearInterval(i);
  }, [endpoint, refreshReminders]);

  const addReminder = useCallback(
    async (r: Omit<Reminder, "id" | "createdAt">) => {
      let ep = endpoint;
      if (!ep) ep = await subscribe();
      if (!ep) throw new Error("Notifications not enabled");
      const res = await fetchJSON<{ reminder: Reminder; reminders: Reminder[] }>(
        apiUrl("/api/push/reminders"),
        { method: "POST", body: JSON.stringify({ endpoint: ep, reminder: r }) },
      );
      setReminders(res.reminders);
      return res.reminder;
    },
    [endpoint, subscribe],
  );

  const removeReminder = useCallback(
    async (id: string) => {
      if (!endpoint) return;
      const res = await fetchJSON<{ reminders: Reminder[] }>(
        apiUrl(`/api/push/reminders/${encodeURIComponent(id)}?endpoint=${encodeURIComponent(endpoint)}`),
        { method: "DELETE" },
      );
      setReminders(res.reminders);
    },
    [endpoint],
  );

  const clearAll = useCallback(async () => {
    if (!endpoint) return;
    await fetchJSON(apiUrl(`/api/push/reminders?endpoint=${encodeURIComponent(endpoint)}`), {
      method: "DELETE",
    });
    setReminders([]);
  }, [endpoint]);

  return {
    reminders,
    addReminder,
    removeReminder,
    clearAll,
    permission,
    supported,
    busy,
    isSubscribed: !!endpoint && permission === "granted",
    subscribe,
  };
}

// n=33 time-slot options (every 30 min between 06:00 and 22:00)
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
