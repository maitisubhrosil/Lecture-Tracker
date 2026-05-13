import { useState, useMemo } from "react";
import { useGetSchedule } from "@workspace/api-client-react";
import { Clock, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const SUBJECT_COLORS: Record<string, { chip: string; card: string; text: string; border: string }> = {
  CMT:  { chip: "bg-violet-500 text-white",  card: "bg-violet-50 border-violet-200",  text: "text-violet-700",  border: "border-violet-300" },
  CRM:  { chip: "bg-orange-500 text-white",  card: "bg-orange-50 border-orange-200",  text: "text-orange-700",  border: "border-orange-300" },
  CV:   { chip: "bg-teal-500 text-white",    card: "bg-teal-50 border-teal-200",      text: "text-teal-700",    border: "border-teal-300" },
  DAB:  { chip: "bg-amber-500 text-white",   card: "bg-amber-50 border-amber-200",    text: "text-amber-700",   border: "border-amber-300" },
  DF:   { chip: "bg-rose-500 text-white",    card: "bg-rose-50 border-rose-200",      text: "text-rose-700",    border: "border-rose-300" },
  DVDM: { chip: "bg-blue-500 text-white",    card: "bg-blue-50 border-blue-200",      text: "text-blue-700",    border: "border-blue-300" },
  IB:   { chip: "bg-green-500 text-white",   card: "bg-green-50 border-green-200",    text: "text-green-700",   border: "border-green-300" },
  IM:   { chip: "bg-indigo-500 text-white",  card: "bg-indigo-50 border-indigo-200",  text: "text-indigo-700",  border: "border-indigo-300" },
  IMG:  { chip: "bg-yellow-400 text-gray-900", card: "bg-yellow-50 border-yellow-200", text: "text-yellow-700", border: "border-yellow-300" },
  MMA:  { chip: "bg-red-500 text-white",     card: "bg-red-50 border-red-200",        text: "text-red-700",     border: "border-red-300" },
  OE:   { chip: "bg-lime-500 text-white",    card: "bg-lime-50 border-lime-200",      text: "text-lime-700",    border: "border-lime-300" },
  PF:   { chip: "bg-fuchsia-500 text-white", card: "bg-fuchsia-50 border-fuchsia-200", text: "text-fuchsia-700", border: "border-fuchsia-300" },
  PPM:  { chip: "bg-sky-500 text-white",     card: "bg-sky-50 border-sky-200",        text: "text-sky-700",     border: "border-sky-300" },
  SSRM: { chip: "bg-emerald-500 text-white", card: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", border: "border-emerald-300" },
};

const FALLBACK_COLORS = [
  { chip: "bg-pink-500 text-white",   card: "bg-pink-50 border-pink-200",   text: "text-pink-700",   border: "border-pink-300" },
  { chip: "bg-cyan-500 text-white",   card: "bg-cyan-50 border-cyan-200",   text: "text-cyan-700",   border: "border-cyan-300" },
  { chip: "bg-slate-500 text-white",  card: "bg-slate-50 border-slate-200", text: "text-slate-700",  border: "border-slate-300" },
];

const DAY_EMOJIS: Record<string, string> = {
  Monday: "💪", Tuesday: "🔥", Wednesday: "✨", Thursday: "🎯",
  Friday: "🎉", Saturday: "🌟", Sunday: "😴",
};

function getSubjectColor(subject: string, allSubjects: string[]) {
  if (SUBJECT_COLORS[subject]) return SUBJECT_COLORS[subject];
  const idx = allSubjects.indexOf(subject) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[idx];
}

function parseScheduleDate(dateStr: string): Date | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [day, month, yearShort] = parts;
  const d = new Date(`${day} ${month} 20${yearShort}`);
  return isNaN(d.getTime()) ? null : d;
}

function parseEndTimeMinutes(timeRange: string): number | null {
  const matches = timeRange.match(/\d+:\d+\s*(?:AM|PM)/gi);
  if (!matches || matches.length < 2) return null;
  const endStr = matches[matches.length - 1];
  const m = endStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let hours = parseInt(m[1]);
  const minutes = parseInt(m[2]);
  const period = m[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function Home() {
  const { data, isLoading, isError, refetch } = useGetSchedule();

  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [appliedSubjects, setAppliedSubjects] = useState<Set<string>>(new Set());

  const toggleSubject = (subject: string) => {
    setSelectedSubjects(prev => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedSubjects(new Set());
    setAppliedSubjects(new Set());
  };

  const applyFilters = () => setAppliedSubjects(new Set(selectedSubjects));

  const hasUnappliedChanges =
    selectedSubjects.size !== appliedSubjects.size ||
    Array.from(selectedSubjects).some(s => !appliedSubjects.has(s));

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const upcomingSchedule = useMemo(() => {
    if (!data?.schedule) return [];
    const today = new Date();

    return data.schedule
      .map(day => {
        const date = parseScheduleDate(day.date);
        if (!date) return null;

        const isPast = date < today && !isSameCalendarDay(date, today);
        if (isPast) return null;

        if (isSameCalendarDay(date, today)) {
          const sessions = day.sessions.filter(s => {
            const endMins = parseEndTimeMinutes(s.time);
            return endMins === null || endMins > currentMinutes;
          });
          if (sessions.length === 0) return null;
          return { ...day, sessions };
        }

        return day;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [data, currentMinutes]);

  const filteredSchedule = useMemo(() => {
    if (appliedSubjects.size === 0) return upcomingSchedule;
    return upcomingSchedule
      .map(day => ({
        ...day,
        sessions: day.sessions.filter(s => appliedSubjects.has(s.subject)),
      }))
      .filter(day => day.sessions.length > 0);
  }, [upcomingSchedule, appliedSubjects]);

  const allSubjects = data?.subjects ?? [];

  if (isError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-5xl">😵</div>
          <h2 className="text-lg font-semibold text-gray-900">couldn't load the schedule</h2>
          <p className="text-sm text-gray-500">check your connection and try again</p>
          <Button onClick={() => refetch()} variant="outline" className="mt-2" data-testid="button-retry">
            <RefreshCw className="mr-2 h-4 w-4" />
            retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              📚 ePGP Schedule
            </h1>
            {!isLoading && data?.lastFetched && (
              <span className="text-[11px] text-gray-400" data-testid="text-last-updated">
                synced {new Date(data.lastFetched).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex gap-2 overflow-hidden">
              {[80, 64, 96, 72, 56].map(w => (
                <Skeleton key={w} className="h-8 rounded-full" style={{ width: w }} />
              ))}
            </div>
          ) : allSubjects.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {allSubjects.map(subject => {
                  const colors = getSubjectColor(subject, allSubjects);
                  const isSelected = selectedSubjects.has(subject);
                  return (
                    <button
                      key={subject}
                      onClick={() => toggleSubject(subject)}
                      data-testid={`chip-subject-${subject}`}
                      className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all duration-150 select-none border-2 ${
                        isSelected
                          ? `${colors.chip} ${colors.border} scale-105 shadow-sm`
                          : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {subject}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 justify-end">
                {(selectedSubjects.size > 0 || appliedSubjects.size > 0) && (
                  <button
                    onClick={clearFilters}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    data-testid="button-clear-filters"
                  >
                    clear all
                  </button>
                )}
                <Button
                  size="sm"
                  onClick={applyFilters}
                  disabled={!hasUnappliedChanges}
                  data-testid="button-apply-filters"
                  className={`h-8 text-xs px-4 rounded-full font-semibold transition-all ${
                    hasUnappliedChanges
                      ? "bg-gray-900 text-white hover:bg-gray-700"
                      : "bg-gray-100 text-gray-400 cursor-default"
                  }`}
                >
                  {hasUnappliedChanges ? "Apply ✓" : "Applied"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* Schedule */}
      <main className="max-w-2xl mx-auto px-4 pt-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-4 w-24" />
                <div className="space-y-2 pt-1">
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredSchedule.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <div className="text-6xl">📭</div>
            <h3 className="text-lg font-semibold text-gray-700">all caught up!</h3>
            <p className="text-sm text-gray-400 max-w-xs mx-auto">
              {appliedSubjects.size > 0
                ? "no upcoming sessions for the selected subjects"
                : "no upcoming sessions in the schedule"}
            </p>
            {appliedSubjects.size > 0 && (
              <button
                onClick={clearFilters}
                className="mt-4 text-sm font-medium text-gray-500 underline underline-offset-2"
                data-testid="button-empty-clear"
              >
                clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSchedule.map((daySchedule, idx) => {
              const date = parseScheduleDate(daySchedule.date);
              const isToday = date ? isSameCalendarDay(date, now) : false;
              const dayEmoji = DAY_EMOJIS[daySchedule.day] ?? "📅";

              return (
                <div
                  key={`${daySchedule.date}-${idx}`}
                  data-testid={`schedule-day-${daySchedule.date}`}
                  className={`rounded-2xl border overflow-hidden transition-all duration-200 ${
                    isToday
                      ? "bg-white border-indigo-200 shadow-md shadow-indigo-100"
                      : "bg-white border-gray-100 shadow-sm"
                  }`}
                >
                  {/* Day header */}
                  <div className={`px-5 py-4 flex items-center justify-between border-b ${
                    isToday ? "bg-indigo-50 border-indigo-100" : "bg-gray-50/60 border-gray-100"
                  }`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{dayEmoji}</span>
                        <span className="font-bold text-gray-900 text-base">{daySchedule.day}</span>
                        {isToday && (
                          <span className="text-[11px] font-semibold bg-indigo-500 text-white rounded-full px-2 py-0.5">
                            ✨ today
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 ml-8">
                        {daySchedule.date} · {daySchedule.week}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 font-medium">
                      {daySchedule.sessions.length} session{daySchedule.sessions.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Sessions */}
                  <div className="divide-y divide-gray-50">
                    {daySchedule.sessions.map((session, sIdx) => {
                      const colors = getSubjectColor(session.subject, allSubjects);
                      return (
                        <div
                          key={`${session.slot}-${sIdx}`}
                          data-testid={`session-${daySchedule.date}-slot-${session.slot}`}
                          className="px-5 py-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-semibold text-gray-400 shrink-0 w-10">
                              S{session.slot}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${colors.text} shrink-0`}>
                              <Clock className="h-3 w-3 opacity-70" />
                              {session.time}
                            </span>
                          </div>
                          <span className={`text-sm font-bold px-3 py-1.5 rounded-xl border ${colors.card} ${colors.text} ${colors.border} shrink-0`}>
                            {session.subject}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {!isLoading && (
        <footer className="max-w-2xl mx-auto px-4 pt-10 pb-4 text-center">
          <p className="text-[11px] text-gray-300">
            updates daily at 5:30 am · IIM Raipur ePGP Batch 5
          </p>
        </footer>
      )}
    </div>
  );
}
