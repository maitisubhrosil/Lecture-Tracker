import { useState, useRef } from "react";
import { Bell, BellRing, BellOff, ChevronDown, ChevronUp, Trash2, Check, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushReminders, TIME_SLOT_OPTIONS, formatSlotLabel } from "@/lib/usePushReminders";
import type { ScheduleData } from "@/lib/useScheduleData";

interface Props {
  scheduleData: ScheduleData | undefined;
  getSubjectColor: (subject: string, all: string[]) => { chip: string; card: string; text: string; border: string };
}

export default function RemindersSection({ scheduleData, getSubjectColor }: Props) {
  const allSubjects = scheduleData?.subjects ?? [];
  const {
    reminders,
    addReminder,
    removeReminder,
    clearAll,
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
  const [confirmClear, setConfirmClear] = useState(false);

  const slotScrollRef = useRef<HTMLDivElement>(null);

  const toggleSubject = (s: string) => {
    setSubjects(prev => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  };
  const toggleSlot = (slot: string) => {
    setSlots(prev => {
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
    } catch (e) {
      setError("Couldn't save reminder. Try again.");
    }
  };

  const scrollSlots = (dir: "left" | "right") => {
    if (!slotScrollRef.current) return;
    slotScrollRef.current.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

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
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-indigo-50">
          {/* Support / permission banner */}
          {!supported && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800" data-testid="unsupported-banner">
              Your browser doesn't support push notifications. Try Chrome, Edge, or Firefox.
            </div>
          )}
          {supported && permission !== "granted" && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3" data-testid="permission-banner">
              <Bell className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 text-xs text-amber-900">
                Enable push notifications to receive reminders even when this tab is closed.
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

          {/* Subjects */}
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

          {/* Time slots — horizontal scroll */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Reminder time{slots.size !== 1 ? "s" : ""}
                <span className="text-gray-400 normal-case font-normal"> · pick 1 or more</span>
              </label>
              <span className="text-[11px] text-gray-400" data-testid="slot-count">
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
                {TIME_SLOT_OPTIONS.map(slot => {
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
              onChange={e => setPreClass(e.target.checked)}
              data-testid="preclass-checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                Pre-class nudge
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Also notify me 15 min before each selected subject's session starts.
              </div>
            </div>
          </label>

          {error && (
            <div className="text-xs text-rose-600 font-medium" data-testid="reminder-error">
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
              {subjects.size} subject{subjects.size !== 1 ? "s" : ""} · {slots.size} time{slots.size !== 1 ? "s" : ""}/day
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
                  <div className="flex items-center gap-2" data-testid="confirm-clear">
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
                {reminders.map(r => (
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
                      <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>🕐 {r.times.map(formatSlotLabel).join(" · ")}</span>
                        {r.preClassNudge && (
                          <span className="inline-flex items-center gap-0.5 text-indigo-600 font-semibold">
                            <Sparkles className="h-3 w-3" /> +15 min nudge
                          </span>
                        )}
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
              <p className="text-[10px] text-gray-400 mt-3 leading-relaxed flex items-start gap-1">
                {permission === "granted" ? (
                  <>
                    <BellRing className="h-3 w-3 text-indigo-400 mt-0.5 shrink-0" />
                    Notifications will fire even when this tab is closed. Reminders auto-delete after the last lecture date of the selected subjects.
                  </>
                ) : (
                  <>
                    <BellOff className="h-3 w-3 text-gray-400 mt-0.5 shrink-0" />
                    Notifications are disabled — enable them above to receive reminders.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
