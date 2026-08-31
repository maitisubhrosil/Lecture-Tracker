import { useState, useEffect, useCallback } from "react";

export interface Session {
  slot: number;
  time: string;
  subject: string;
  subjectName?: string;
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

export type ScheduleDataSource = "live" | "browser-cache" | "bundled";

const STATIC_JSON_URL = "./schedule-data.json";
function normalizeApiBase(value: string | undefined): string {
  return (value ?? "").replace(/\/$/, "").replace(/\/api$/, "");
}
const API_BASE: string = normalizeApiBase(
  import.meta.env.VITE_API_BASE_URL as string | undefined,
);
const API_URL = `${API_BASE}/api/schedule`;
// Bump once when the schedule shape/source changes so old-term browser data
// cannot mask the newly fetched schedule during the normal cache window.
const CACHE_KEY = "epgp_schedule_data_v2";
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

async function fetchLiveSchedule(): Promise<ScheduleData | null> {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function useScheduleData() {
  const [data, setData] = useState<ScheduleData | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [dataSource, setDataSource] = useState<
    ScheduleDataSource | undefined
  >(undefined);
  const [liveUnavailable, setLiveUnavailable] = useState(false);

  const fetchData = useCallback(async (force = false) => {
    setIsLoading(true);
    setIsError(false);
    setLiveUnavailable(false);

    if (!force && isCacheFresh()) {
      const cached = loadCache();
      if (cached) {
        setData(cached);
        setDataSource("browser-cache");
        setIsLoading(false);

        // Keep the fast cache-first render, but still check the live endpoint
        // so the user is warned when the stored data is all that is available.
        const live = await fetchLiveSchedule();
        if (live) {
          saveCache(live);
          setData(live);
          setDataSource("live");
        } else {
          setLiveUnavailable(true);
        }
        return;
      }
    }

    const liveResult = await fetchLiveSchedule();
    let result = liveResult;

    if (!result) {
      try {
        const res = await fetch(STATIC_JSON_URL + "?t=" + Date.now());
        if (res.ok) result = await res.json();
      } catch {}
    }

    if (result) {
      saveCache(result);
      setData(result);
      setDataSource(liveResult ? "live" : "bundled");
      setLiveUnavailable(!liveResult);
      setIsLoading(false);
      return;
    }

    const stale = loadCache();
    if (stale) {
      setData(stale);
      setDataSource("browser-cache");
      setLiveUnavailable(true);
      setIsLoading(false);
      return;
    }

    setLiveUnavailable(true);
    setIsError(true);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading,
    isError,
    dataSource,
    liveUnavailable,
    refetch: () => fetchData(true),
  };
}
