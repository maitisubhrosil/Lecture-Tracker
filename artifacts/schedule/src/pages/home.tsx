import { useState, useMemo } from "react";
import { useGetSchedule } from "@workspace/api-client-react";
import { format, isSameDay, parseISO } from "date-fns";
import { Clock, Calendar as CalendarIcon, Filter, AlertCircle, RefreshCw, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const { data, isLoading, isError, refetch } = useGetSchedule();
  
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [appliedSubjects, setAppliedSubjects] = useState<Set<string>>(new Set());

  const toggleSubject = (subject: string) => {
    setSelectedSubjects(prev => {
      const next = new Set(prev);
      if (next.has(subject)) {
        next.delete(subject);
      } else {
        next.add(subject);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedSubjects(new Set());
    setAppliedSubjects(new Set());
  };
  
  const applyFilters = () => {
    setAppliedSubjects(new Set(selectedSubjects));
  };

  const filteredSchedule = useMemo(() => {
    if (!data?.schedule) return [];
    if (appliedSubjects.size === 0) return data.schedule;

    return data.schedule.map(day => ({
      ...day,
      sessions: day.sessions.filter(session => appliedSubjects.has(session.subject))
    })).filter(day => day.sessions.length > 0);
  }, [data, appliedSubjects]);

  const today = new Date();

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg border-muted">
          <CardContent className="pt-6 flex flex-col items-center text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <AlertCircle size={24} />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Failed to load schedule</h2>
              <p className="text-sm text-muted-foreground mt-1">We couldn't reach the schedule server. Please check your connection and try again.</p>
            </div>
            <Button onClick={() => refetch()} variant="outline" className="mt-2" data-testid="button-retry">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if current selection differs from applied selection
  const hasUnappliedChanges = selectedSubjects.size !== appliedSubjects.size || 
    Array.from(selectedSubjects).some(s => !appliedSubjects.has(s));

  return (
    <div className="min-h-screen bg-background pb-20 selection:bg-primary/20">
      {/* Header & Filter Section */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-primary" />
              IIM Raipur ePGP
            </h1>
          </div>
          
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <div className="flex gap-2 overflow-hidden">
                <Skeleton className="h-8 w-20 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-full" />
              </div>
            </div>
          ) : data?.subjects && data.subjects.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Filter by Subject
                </span>
                <div className="flex items-center gap-3">
                  {(selectedSubjects.size > 0 || appliedSubjects.size > 0) && (
                    <button 
                      onClick={clearFilters}
                      className="text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
                      data-testid="button-clear-filters"
                    >
                      Clear all
                    </button>
                  )}
                  <Button 
                    size="sm" 
                    variant={hasUnappliedChanges ? "default" : "secondary"}
                    className="h-7 text-xs px-3"
                    onClick={applyFilters}
                    disabled={!hasUnappliedChanges}
                    data-testid="button-apply-filters"
                  >
                    {hasUnappliedChanges ? "Apply" : "Applied"}
                    {!hasUnappliedChanges && <Check className="ml-1.5 h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.subjects.map(subject => {
                  const isSelected = selectedSubjects.has(subject);
                  return (
                    <Badge
                      key={subject}
                      variant={isSelected ? "default" : "secondary"}
                      className={`cursor-pointer transition-all duration-200 select-none px-3 py-1 ${
                        isSelected 
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm" 
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => toggleSubject(subject)}
                      data-testid={`badge-subject-${subject}`}
                    >
                      {subject}
                    </Badge>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* Main Content - Schedule */}
      <main className="max-w-3xl mx-auto px-4 pt-8">
        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="border-muted shadow-sm">
                <CardHeader className="pb-3 border-b border-border/50">
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {[1, 2].map(j => (
                    <div key={j} className="flex flex-col gap-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredSchedule.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
              <CalendarIcon size={28} />
            </div>
            <h3 className="text-lg font-medium text-foreground">No sessions found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {appliedSubjects.size > 0 
                ? "No upcoming sessions match your applied filters. Try selecting different subjects."
                : "There are no upcoming sessions in the schedule."}
            </p>
            {appliedSubjects.size > 0 && (
              <Button onClick={clearFilters} variant="outline" className="mt-4" data-testid="button-empty-clear">
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6 relative">
            <div className="absolute left-[19px] top-4 bottom-8 w-px bg-border/60 -z-10 hidden md:block"></div>
            
            {filteredSchedule.map((daySchedule, idx) => {
              let isToday = false;
              try {
                const parsedDate = new Date(daySchedule.date);
                isToday = isSameDay(parsedDate, today);
              } catch (e) {
                // Ignore parse errors, just don't highlight
              }

              return (
                <div key={`${daySchedule.date}-${idx}`} className="relative group md:pl-10" data-testid={`schedule-day-${daySchedule.date}`}>
                  {/* Timeline dot */}
                  <div className={`absolute left-0 top-6 h-10 w-10 -translate-x-1/2 flex items-center justify-center hidden md:flex`}>
                    <div className={`h-3 w-3 rounded-full border-2 bg-background ${isToday ? 'border-primary ring-4 ring-primary/20' : 'border-muted-foreground/30 group-hover:border-primary/50'} transition-colors`} />
                  </div>

                  <Card className={`border shadow-sm overflow-hidden transition-all duration-300 ${
                    isToday ? 'border-primary/30 shadow-md ring-1 ring-primary/10' : 'border-muted hover:border-border/80'
                  }`}>
                    <CardHeader className={`pb-3 ${isToday ? 'bg-primary/5' : 'bg-muted/30'} border-b border-border/50`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-lg flex items-center gap-2">
                            {daySchedule.day}
                            {isToday && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5 bg-primary/90">Today</Badge>}
                          </CardTitle>
                          <CardDescription className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <span>{daySchedule.date}</span>
                            <span className="h-1 w-1 rounded-full bg-muted-foreground/40"></span>
                            <span>{daySchedule.week}</span>
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 p-0">
                      <div className="divide-y divide-border/40">
                        {daySchedule.sessions.map((session, sIdx) => (
                          <div key={`${session.slot}-${sIdx}`} className="p-4 sm:px-6 hover:bg-muted/20 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start sm:items-center gap-3">
                              <div className="bg-secondary text-secondary-foreground text-xs font-semibold px-2 py-1 rounded-md min-w-[3rem] text-center">
                                Slot {session.slot}
                              </div>
                              <div className="flex items-center text-sm font-medium text-muted-foreground whitespace-nowrap">
                                <Clock className="mr-1.5 h-3.5 w-3.5 opacity-70" />
                                {session.time}
                              </div>
                            </div>
                            <div className="flex items-center justify-end w-full sm:w-auto">
                              <span className="text-base font-semibold text-foreground bg-background border border-border/50 shadow-sm px-3 py-1.5 rounded-lg">
                                {session.subject}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      {!isLoading && data?.lastFetched && (
        <footer className="max-w-3xl mx-auto px-4 py-8 text-center">
          <p className="text-xs text-muted-foreground/70" data-testid="text-last-updated">
            Last updated: {new Date(data.lastFetched).toLocaleString(undefined, { 
              dateStyle: 'medium', 
              timeStyle: 'short' 
            })}
          </p>
        </footer>
      )}
    </div>
  );
}