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
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const API_URL = `${API_BASE}/api/schedule`;
const CACHE_KEY = "epgp_schedule_data";
const CACHE_DATE_KEY = "epgp_schedule_date";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function isCacheFresh(): boolean {
  const cachedDate = localStorage.getItem(CACHE_DATE_KEY);
  if (!cachedDate) return false;
  const now = new Date();
  if (cachedDate !== todayStr()) {
    const totalMins = now.getHours() * 60 + now.getMinutes();
    if (totalMins >= 5 * 60 + 30) return false;
  }
  return true;
}

function saveCache(data: ScheduleData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_DATE_KEY, todayStr());
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
