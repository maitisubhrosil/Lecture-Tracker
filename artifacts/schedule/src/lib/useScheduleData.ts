import { useState, useEffect, useCallback } from "react";

export interface Session {
  slot: number;
  time: string;
  subject: string;
}

export interface DaySchedule {
  date: string;
  day: string;
  week: string;
  sessions: Session[];
}

export interface ScheduleData {
  subjects: string[];
  schedule: DaySchedule[];
  lastFetched: string;
}

const STATIC_JSON_URL = "./schedule-data.json";
function normalizeApiBase(value: string | undefined): string {
  return (value ?? "").replace(/\/$/, "").replace(/\/api$/, "");
}
const API_BASE: string = normalizeApiBase(
  import.meta.env.VITE_API_BASE_URL as string | undefined,
);
const API_URL = `${API_BASE}/api/schedule`;
const CACHE_KEY = "epgp_schedule_data";
const CACHE_TIMESTAMP_KEY = "epgp_schedule_timestamp";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function isCacheFresh(): boolean {
  const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return false;
  return Date.now() - Number(ts) < CACHE_TTL_MS;
}

function saveCache(data: ScheduleData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
  } catch {}
}

function loadCache(): ScheduleData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useScheduleData() {
  const [data, setData] = useState<ScheduleData | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const fetchData = useCallback(async (force = false) => {
    setIsLoading(true);
    setIsError(false);

    if (!force && isCacheFresh()) {
      const cached = loadCache();
      if (cached) {
        setData(cached);
        setIsLoading(false);
        return;
      }
    }

    let result: ScheduleData | null = null;

    try {
      const res = await fetch(API_URL);
      if (res.ok) result = await res.json();
    } catch {}

    if (!result) {
      try {
        const res = await fetch(STATIC_JSON_URL + "?t=" + Date.now());
        if (res.ok) result = await res.json();
      } catch {}
    }

    if (result) {
      saveCache(result);
      setData(result);
      setIsLoading(false);
      return;
    }

    const stale = loadCache();
    if (stale) {
      setData(stale);
      setIsLoading(false);
      return;
    }

    setIsError(true);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, isError, refetch: () => fetchData(true) };
}
