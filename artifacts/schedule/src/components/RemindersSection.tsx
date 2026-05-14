import { useState, useMemo } from "react";
import { Bell, BellRing, X, ChevronDown, ChevronUp, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReminders, formatSlotLabel } from "@/lib/useReminders";
import type { ScheduleData } from "@/lib/useScheduleData";

interface Props {
  scheduleData: ScheduleData | undefined;
  getSubjectColor: (subject: string, all: string[]) => { chip: string; card: string; text: string; border: string };
}

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function RemindersSection({ scheduleData, getSubjectColor }: Props) {
  const allSubjects = scheduleData?.subjects ?? [];
  const {
    reminders,
    addReminder,
    removeReminder,
    permission,
    requestPermission,
    timeSlotOptions,
  } = useReminders(scheduleData);

  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [date, setDate] = useState<string>(todayLocalISO());
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const toggleSubject = (s: string) => {
    setSubjects(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };
  const toggleSlot = (slot: string) => {
    setSlots(prev => {
      const next = new Set(prev);
      next.has(slot) ? next.delete(slot) : next.add(slot);
      return next;
    });
  };

  const canSave = subjects.size > 0 && slots.size >= 2 && !!date;

  const handleSave = async () => {
    setError(null);
    if (subjects.size === 0) return setError("Pick at least one subject");
    if (slots.size < 2) return setError("Pick at least 2 time slots (twice a day)");
    if (!date) return setError("Pick a date");

    if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await requestPermission();
      if (p !== "granted") {
        setError("Enable browser notifications to receive reminders");
        return;
      }
    }

    addReminder({
      subjects: Array.from(subjects),
      date,
      timeSlots: Array.from(slots).sort(),
    });
    setSubjects(new Set());
    setSlots(new Set());
    setDate(todayLocalISO());
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const activeReminders = useMemo(() => {
    return [...reminders].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [reminders]);

  const todayISO = todayLocalISO();

  return (
    <section
      className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden"
      data-testid="reminders-section"
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-indigo-50/40 transition-colors"
        data-testid="reminders-toggle"
      >
        <div className="flex items-center gap-2">
          {activeReminders.length > 0 ? (
            <BellRing className="h-4 w-4 text-indigo-600" />
          ) : (
            <Bell className="h-4 w-4 text-gray-500" />
          )}
          <span className="font-semibold text-sm text-gray-800">Reminders</span>
          {activeReminders.length > 0 && (
            <span
              className="text-[11px] font-semibold bg-indigo-500 text-white rounded-full px-2 py-0.5"
              data-testid="reminders-count"
            >
              {activeReminders.length} active
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-indigo-50">
          {/* Permission banner */}
          {permission !== "granted" && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3" data-testid="permission-banner">
              <Bell className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 text-xs text-amber-900">
                Enable browser notifications to receive reminders at your selected times.
              </div>
              <Button
                size="sm"
                onClick={requestPermission}
                className="h-7 text-[11px] px-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="enable-notifications-btn"
              >
                Enable
              </Button>
            </div>
          )}

          {/* New reminder form */}
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Subjects</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {allSubjects.map(s => {
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

            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide" htmlFor="reminder-date">
                Date
              </label>
              <input
                id="reminder-date"
                data-testid="reminder-date-input"
                type="date"
                min={todayISO}
                value={date}
                onChange={e => setDate(e.target.value)}
                className="mt-2 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 text-gray-900 bg-white"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Time slots <span className="text-gray-400 normal-case font-normal">· pick at least 2</span>
                </label>
                <span className="text-[11px] text-gray-400" data-testid="slot-count">
                  {slots.size} selected
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-2 max-h-44 overflow-y-auto pr-1">
                {timeSlotOptions.map(slot => {
                  const sel = slots.has(slot);
                  return (
                    <button
                      key={slot}
                      onClick={() => toggleSlot(slot)}
                      data-testid={`slot-option-${slot}`}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        sel
                          ? "bg-indigo-500 text-white border-indigo-500 shadow-sm"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      }`}
                    >
                      {formatSlotLabel(slot)}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="text-xs text-rose-600 font-medium" data-testid="reminder-error">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!canSave}
                data-testid="save-reminder-btn"
                className={`h-9 px-5 rounded-full text-xs font-semibold transition-all ${
                  canSave
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
                {subjects.size} subject{subjects.size !== 1 ? "s" : ""} · {slots.size} time{slots.size !== 1 ? "s" : ""}/day
              </span>
            </div>
          </div>

          {/* Active reminders list */}
          {activeReminders.length > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Active reminders
              </div>
              <ul className="space-y-2" data-testid="active-reminders-list">
                {activeReminders.map(r => (
                  <li
                    key={r.id}
                    data-testid={`reminder-item-${r.id}`}
                    className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        {r.subjects.map(s => {
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
                      <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>📅 {r.date}</span>
                        <span>🕐 {r.timeSlots.map(formatSlotLabel).join(" · ")}</span>
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
              <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                ⓘ Keep this tab open to receive notifications at the scheduled times.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
