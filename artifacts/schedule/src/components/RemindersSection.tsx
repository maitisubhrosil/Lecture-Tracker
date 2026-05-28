import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  BellOff,
  BellRing,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatSlotLabel,
  getBrowserSupportInfo,
  TIME_SLOT_OPTIONS,
  usePushReminders,
} from "@/lib/usePushReminders";
import type { Reminder } from "@/lib/usePushReminders";
import type { ScheduleData } from "@/lib/useScheduleData";

interface Props {
  scheduleData: ScheduleData | undefined;
  getSubjectColor: (
    subject: string,
    all: string[],
  ) => { chip: string; card: string; text: string; border: string };
}

const CALENDAR_TIME_ZONE = "Asia/Kolkata";

function parseScheduleDate(dateStr: string): Date | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [day, month, yearShort] = parts;
  const d = new Date(`${day} ${month} 20${yearShort}`);
  return isNaN(d.getTime()) ? null : d;
}

function parseClockMinutes(value: string): number | null {
  const m = value.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const period = m[3]?.toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function parseTimeRangeMinutes(
  timeRange: string,
): { start: number; end: number } | null {
  const matches = timeRange.match(/\d+:\d+\s*(?:AM|PM)/gi);
  if (!matches || matches.length < 2) return null;
  const start = parseClockMinutes(matches[0]);
  const end = parseClockMinutes(matches[matches.length - 1]);
  return start === null || end === null ? null : { start, end };
}

function dateWithMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function formatDateTime(value: Date): string {
  return value.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function nextFireLabel(
  reminder: Reminder,
  scheduleData: ScheduleData | undefined,
): string {
  if (!scheduleData) return "Next reminder: waiting for schedule";
  const now = new Date();
  const candidates: Date[] = [];

  for (const day of scheduleData.schedule) {
    const date = parseScheduleDate(day.date);
    if (!date) continue;
    const hasSubject = day.sessions.some((s) =>
      reminder.subjects.includes(s.subject),
    );
    if (!hasSubject) continue;

    for (const slot of reminder.times) {
      const mins = parseClockMinutes(slot);
      if (mins === null) continue;
      const fire = dateWithMinutes(date, mins);
      if (fire >= now) candidates.push(fire);
    }

    if (reminder.preClassNudge) {
      for (const session of day.sessions) {
        if (!reminder.subjects.includes(session.subject)) continue;
        const range = parseTimeRangeMinutes(session.time);
        if (!range) continue;
        const fire = dateWithMinutes(date, range.start - 15);
        if (fire >= now) candidates.push(fire);
      }
    }
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0]
    ? `Next: ${formatDateTime(candidates[0])}`
    : "No upcoming matching schedule";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function icsDate(date: Date, minutes: number): string {
  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildCalendarFile(
  reminders: Reminder[],
  scheduleData: ScheduleData | undefined,
): string | null {
  if (!scheduleData || reminders.length === 0) return null;
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lecture Tracker//ePGP Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const seen = new Set<string>();

  const addEvent = (
    uid: string,
    start: string,
    end: string,
    summary: string,
    description: string,
    alarmMinutes?: number,
  ) => {
    if (seen.has(uid)) return;
    seen.add(uid);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}@lecture-tracker`);
    lines.push(
      `DTSTAMP:${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`,
    );
    lines.push(`DTSTART;TZID=${CALENDAR_TIME_ZONE}:${start}`);
    lines.push(`DTEND;TZID=${CALENDAR_TIME_ZONE}:${end}`);
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

  for (const reminder of reminders) {
    for (const day of scheduleData.schedule) {
      const date = parseScheduleDate(day.date);
      if (!date) continue;
      const matchedSessions = day.sessions.filter((session) =>
        reminder.subjects.includes(session.subject),
      );
      if (matchedSessions.length === 0) continue;

      for (const slot of reminder.times) {
        const mins = parseClockMinutes(slot);
        if (mins === null) continue;
        const startDate = dateWithMinutes(date, mins);
        if (startDate < now) continue;
        addEvent(
          `reminder-${reminder.id}-${day.date}-${slot.replace(":", "")}`,
          icsDate(date, mins),
          icsDate(date, mins + 5),
          `ePGP reminder: ${reminder.subjects.join(", ")}`,
          matchedSessions
            .map((s) => `S${s.slot} · ${s.time} · ${s.subject}`)
            .join("\n"),
        );
      }

      if (reminder.preClassNudge) {
        for (const session of matchedSessions) {
          const range = parseTimeRangeMinutes(session.time);
          if (!range) continue;
          const startDate = dateWithMinutes(date, range.start);
          if (startDate < now) continue;
          addEvent(
            `class-${reminder.id}-${day.date}-${session.slot}-${session.subject}`,
            icsDate(date, range.start),
            icsDate(date, range.end),
            `ePGP: ${session.subject}`,
            `${day.day} ${day.date} · ${day.week}\nSlot S${session.slot} · ${session.time}`,
            15,
          );
        }
      }
    }
  }

  lines.push("END:VCALENDAR");
  return seen.size > 0 ? lines.join("\r\n") : null;
}

function buildCalendarFileForSelection(
  selectedSubjects: string[],
  selectedSlots: string[],
  includePreClass: boolean,
  scheduleData: ScheduleData | undefined,
): string | null {
  if (!scheduleData || selectedSubjects.length === 0) return null;

  const pseudoReminder: Reminder = {
    id: "draft",
    subjects: selectedSubjects,
    times: selectedSlots.length > 0 ? selectedSlots : TIME_SLOT_OPTIONS,
    preClassNudge: includePreClass,
    createdAt: new Date().toISOString(),
  };

  return buildCalendarFile([pseudoReminder], scheduleData);
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function diagnosticsLabel(
  diagnostics: ReturnType<typeof usePushReminders>["diagnostics"],
): string {
  if (diagnostics.lastFailureReason) {
    return `Last push failed${diagnostics.lastAttemptStatus ? ` (${diagnostics.lastAttemptStatus})` : ""}: ${diagnostics.lastFailureReason}`;
  }
  if (diagnostics.lastSuccessAt)
    return `Last push succeeded: ${formatDateTime(new Date(diagnostics.lastSuccessAt))}`;
  if (diagnostics.lastAttemptAt)
    return `Last push attempt: ${formatDateTime(new Date(diagnostics.lastAttemptAt))}`;
  return "No push attempts yet — use Send test after enabling notifications.";
}

export default function RemindersSection({
  scheduleData,
  getSubjectColor,
}: Props) {
  const allSubjects = scheduleData?.subjects ?? [];
  const {
    reminders,
    diagnostics,
    addReminder,
    removeReminder,
    clearAll,
    sendTestNotification,
    permission,
    supported,
    isSubscribed,
    subscribe,
    busy,
  } = usePushReminders();

  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [preClass, setPreClass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "failed"
  >("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);

  const slotScrollRef = useRef<HTMLDivElement>(null);
  const supportInfo = useMemo(() => getBrowserSupportInfo(), []);

  const toggleSubject = (s: string) => {
    setSubjects((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  };
  const toggleSlot = (slot: string) => {
    setSlots((prev) => {
      const n = new Set(prev);
      n.has(slot) ? n.delete(slot) : n.add(slot);
      return n;
    });
  };

  const canSave = subjects.size > 0 && slots.size >= 1;

  const handleSave = async () => {
    setError(null);
    if (subjects.size === 0) return setError("Pick at least one subject");
    if (slots.size === 0) return setError("Pick at least one reminder time");

    if (!isSubscribed) {
      const ep = await subscribe();
      if (!ep) {
        setError("Enable browser notifications to receive reminders");
        return;
      }
    }

    try {
      await addReminder({
        subjects: Array.from(subjects),
        times: Array.from(slots).sort(),
        preClassNudge: preClass,
      });
      setSubjects(new Set());
      setSlots(new Set());
      setPreClass(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      setError("Couldn't save reminder. Try again.");
    }
  };

  const handleSendTest = async () => {
    setError(null);
    setTestStatus("sending");
    try {
      const ok = await sendTestNotification();
      setTestStatus(ok ? "sent" : "failed");
      if (!ok) setError("Test notification failed. Check diagnostics below.");
    } catch (err) {
      setTestStatus("failed");
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't send test notification. Please try again.",
      );
    }
  };

  const handleSubscribeCalendar = () => {
    if (subjects.size === 0) return;
    const qs = new URLSearchParams({
      subjects: Array.from(subjects).join(","),
      times: Array.from(slots).sort().join(","),
      preClass: preClass ? "true" : "false",
    });
    const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "").replace(/\/api$/, "");
    const url = `${base}/api/calendar/live.ics?${qs.toString()}`;
    const webcal = url.replace(/^https?:/i, "webcal:");
    window.open(webcal, "_blank", "noopener,noreferrer");
  };

  const handleDownloadCalendar = () => {
    const ics = buildCalendarFileForSelection(
      Array.from(subjects),
      Array.from(slots).sort(),
      preClass,
      scheduleData,
    );
    if (!ics) {
      setError("No upcoming reminder sessions to add to calendar.");
      return;
    }
    downloadText("epgp-reminders.ics", ics, "text/calendar;charset=utf-8");
  };

  const handleForceRefreshCache = async () => {
    setError(null);
    setRefreshingCache(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      localStorage.removeItem("epgp_push_endpoint");
      sessionStorage.clear();
      window.location.reload();
    } catch {
      setError(
        "Couldn't force refresh cache automatically. Please reload the page once.",
      );
    } finally {
      setRefreshingCache(false);
    }
  };

  const scrollSlots = (dir: "left" | "right") => {
    if (!slotScrollRef.current) return;
    slotScrollRef.current.scrollBy({
      left: dir === "left" ? -200 : 200,
      behavior: "smooth",
    });
  };

  return (
    <section
      className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden"
      data-testid="reminders-section"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-indigo-50/40 transition-colors"
        data-testid="reminders-toggle"
      >
        <div className="flex items-center gap-2">
          {reminders.length > 0 ? (
            <BellRing className="h-4 w-4 text-indigo-600" />
          ) : (
            <Bell className="h-4 w-4 text-gray-500" />
          )}
          <span className="font-semibold text-sm text-gray-800">Reminders</span>
          {reminders.length > 0 && (
            <span
              className="text-[11px] font-semibold bg-indigo-500 text-white rounded-full px-2 py-0.5"
              data-testid="reminders-count"
            >
              {reminders.length} active
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-indigo-50">
          <div
            className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
              supportInfo.recommended
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
            data-testid="browser-guidance"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <div className="font-semibold">{supportInfo.title}</div>
              <div>{supportInfo.detail}</div>
            </div>
          </div>
          {supported && (
            <div
              className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-3"
              data-testid="force-refresh-banner"
            >
              <Download className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="flex-1 text-xs text-blue-900">
                Seeing old data or old UI labels? Use force refresh to clear app
                cache and reload.
              </div>
              <Button
                size="sm"
                onClick={handleForceRefreshCache}
                disabled={refreshingCache}
                variant="outline"
                className="h-7 text-[11px] px-3 rounded-full border-blue-300 text-blue-700 hover:bg-blue-100"
                data-testid="force-refresh-btn"
              >
                {refreshingCache ? "Refreshing..." : "Force refresh app cache"}
              </Button>
            </div>
          )}

          {/* Support / permission banner */}
          {!supported && (
            <div
              className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800"
              data-testid="unsupported-banner"
            >
              Your browser doesn't support push notifications. Try Chrome or
              Edge, or use Add to calendar below.
            </div>
          )}
          {supported && permission !== "granted" && (
            <div
              className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3"
              data-testid="permission-banner"
            >
              <Bell className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 text-xs text-amber-900">
                Enable push notifications, then use Send test to verify this
                browser can receive reminders.
              </div>
              <Button
                size="sm"
                onClick={subscribe}
                disabled={busy}
                className="h-7 text-[11px] px-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="enable-notifications-btn"
              >
                {busy ? "..." : "Enable"}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              size="sm"
              onClick={handleSendTest}
              disabled={busy || testStatus === "sending"}
              variant="outline"
              data-testid="send-test-notification-btn"
              className="h-9 rounded-full text-xs font-semibold"
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              {testStatus === "sending"
                ? "Sending..."
                : testStatus === "sent"
                  ? "Test sent"
                  : "Send test notification"}
            </Button>
            <Button
              size="sm"
              onClick={handleSubscribeCalendar}
              disabled={subjects.size === 0}
              variant="outline"
              data-testid="subscribe-calendar-btn"
              className="h-9 rounded-full text-xs font-semibold"
            >
              <CalendarPlus className="h-3.5 w-3.5 mr-1" />
              Subscribe calendar (live)
            </Button>
            <Button
              size="sm"
              onClick={handleDownloadCalendar}
              disabled={subjects.size === 0}
              variant="outline"
              data-testid="download-calendar-btn"
              className="h-9 rounded-full text-xs font-semibold"
            >
              <CalendarPlus className="h-3.5 w-3.5 mr-1" />
              Download calendar event (.ics)
            </Button>
          </div>
          <p className="text-[11px] text-gray-400">
            Select at least one subject to enable calendar subscribe/download.
          </p>

          {/* Subjects */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Subjects
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {allSubjects.map((s) => {
                const colors = getSubjectColor(s, allSubjects);
                const sel = subjects.has(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSubject(s)}
                    data-testid={`reminder-subject-${s}`}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border-2 transition-all ${
                      sel
                        ? `${colors.chip} ${colors.border} scale-105`
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time slots — horizontal scroll */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Reminder time{slots.size !== 1 ? "s" : ""}
                <span className="text-gray-400 normal-case font-normal">
                  {" "}
                  · pick 1 or more
                </span>
              </label>
              <span
                className="text-[11px] text-gray-400"
                data-testid="slot-count"
              >
                {slots.size} selected
              </span>
            </div>

            <div className="relative mt-2">
              <button
                type="button"
                onClick={() => scrollSlots("left")}
                aria-label="Scroll left"
                data-testid="slot-scroll-left"
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-600 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div
                ref={slotScrollRef}
                data-testid="slot-scroller"
                className="flex gap-2 overflow-x-auto scroll-smooth py-1 px-9"
                style={{ scrollbarWidth: "thin" }}
              >
                {TIME_SLOT_OPTIONS.map((slot) => {
                  const sel = slots.has(slot);
                  return (
                    <button
                      key={slot}
                      onClick={() => toggleSlot(slot)}
                      data-testid={`slot-option-${slot}`}
                      className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium border transition-all whitespace-nowrap ${
                        sel
                          ? "bg-indigo-500 text-white border-indigo-500 shadow-sm scale-105"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      }`}
                    >
                      {formatSlotLabel(slot)}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => scrollSlots("right")}
                aria-label="Scroll right"
                data-testid="slot-scroll-right"
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-600 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Pre-class nudge checkbox */}
          <label
            className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-200 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
            data-testid="preclass-label"
          >
            <input
              type="checkbox"
              checked={preClass}
              onChange={(e) => setPreClass(e.target.checked)}
              data-testid="preclass-checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                Pre-class nudge
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Also notify me 15 min before each selected subject's session
                starts.
              </div>
            </div>
          </label>

          {error && (
            <div
              className="text-xs text-rose-600 font-medium"
              data-testid="reminder-error"
            >
              {error}
            </div>
          )}

          {/* Save row */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={!canSave || busy}
              data-testid="save-reminder-btn"
              className={`h-9 px-5 rounded-full text-xs font-semibold transition-all ${
                canSave && !busy
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {justSaved ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1" /> Saved
                </>
              ) : (
                <>
                  <Bell className="h-3.5 w-3.5 mr-1" /> Set Reminder
                </>
              )}
            </Button>
            <span className="text-[11px] text-gray-400">
              {subjects.size} subject{subjects.size !== 1 ? "s" : ""} ·{" "}
              {slots.size} time{slots.size !== 1 ? "s" : ""}/day
              {preClass ? " · +pre-class" : ""}
            </span>
          </div>

          {/* Active reminders list */}
          {reminders.length > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Active reminders
                </div>
                {!confirmClear ? (
                  <button
                    onClick={() => setConfirmClear(true)}
                    data-testid="delete-all-btn"
                    className="text-[11px] font-semibold text-rose-500 hover:text-rose-700 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" /> Delete all
                  </button>
                ) : (
                  <div
                    className="flex items-center gap-2"
                    data-testid="confirm-clear"
                  >
                    <span className="text-[11px] text-gray-500">Sure?</span>
                    <button
                      onClick={async () => {
                        await clearAll();
                        setConfirmClear(false);
                      }}
                      data-testid="confirm-delete-all"
                      className="text-[11px] font-semibold bg-rose-500 text-white hover:bg-rose-600 rounded-full px-3 py-0.5 transition-colors"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      data-testid="cancel-delete-all"
                      className="text-[11px] font-semibold text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <ul className="space-y-2" data-testid="active-reminders-list">
                {reminders.map((r) => (
                  <li
                    key={r.id}
                    data-testid={`reminder-item-${r.id}`}
                    className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        {r.subjects.map((s) => {
                          const colors = getSubjectColor(s, allSubjects);
                          return (
                            <span
                              key={s}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${colors.card} ${colors.text} ${colors.border}`}
                            >
                              {s}
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>
                          🕐 {r.times.map(formatSlotLabel).join(" · ")}
                        </span>
                        {r.preClassNudge && (
                          <span className="inline-flex items-center gap-0.5 text-indigo-600 font-semibold">
                            <Sparkles className="h-3 w-3" /> +15 min nudge
                          </span>
                        )}
                        <span className="font-medium text-gray-600">
                          {nextFireLabel(r, scheduleData)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeReminder(r.id)}
                      data-testid={`remove-reminder-${r.id}`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0"
                      aria-label="Delete reminder"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="text-[10px] text-gray-400 mt-3 leading-relaxed space-y-1">
                <p className="flex items-start gap-1">
                  {permission === "granted" ? (
                    <>
                      <BellRing className="h-3 w-3 text-indigo-400 mt-0.5 shrink-0" />
                      Notifications use a 5-minute delivery window and
                      auto-delete after the last lecture date of the selected
                      subjects.
                    </>
                  ) : (
                    <>
                      <BellOff className="h-3 w-3 text-gray-400 mt-0.5 shrink-0" />
                      Notifications are disabled — enable them above to receive
                      reminders.
                    </>
                  )}
                </p>
                <p
                  className="flex items-start gap-1"
                  data-testid="push-diagnostics"
                >
                  <Download className="h-3 w-3 text-gray-400 mt-0.5 shrink-0" />
                  {diagnosticsLabel(diagnostics)}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
