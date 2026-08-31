import { Router } from "express";

const scheduleRouter = Router();

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1VZauPSkJxNduZixiecFjoF0c0BmH7NNY6nBNNSnbJac/export?format=csv&gid=502725552";

interface Session {
  slot: number;
  time: string;
  subject: string;
  subjectName?: string;
}

interface DaySchedule {
  date: string;
  day: string;
  week: string;
  sessions: Session[];
}

interface ScheduleData {
  subjects: string[];
  schedule: DaySchedule[];
  lastFetched: string;
}

export type { ScheduleData };

let cachedData: ScheduleData | null = null;
let lastFetchDate: string | null = null;
let lastFetchTimestamp: number = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function getCachedSchedule(): ScheduleData | null {
  return cachedData;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

function parseSchedule(csvText: string): ScheduleData {
  const rows = parseCSV(csvText);
  const headerRow = rows.find((row) => {
    const values = row.map((cell) => cell.trim().toLowerCase());
    return values.includes("date") && values.includes("day") &&
      values.some((value) => /^session\s*1$/.test(value));
  });
  const dateColumn = headerRow
    ? headerRow.findIndex((cell) => cell.trim().toLowerCase() === "date")
    : 1;
  const dayColumn = headerRow
    ? headerRow.findIndex((cell) => cell.trim().toLowerCase() === "day")
    : 2;
  const sessionColumns = Array.from({ length: 5 }, (_, index) => {
    const expected = new RegExp(`^session\\s*${index + 1}$`, "i");
    return headerRow
      ? headerRow.findIndex((cell) => expected.test(cell.trim()))
      : 4 + index;
  });

  const timingRow = (kind: "weekday" | "weekend" | "campus") =>
    rows.find((row) => {
      const text = row.join(" ").toLowerCase();
      if (kind === "weekend")
        return text.includes("weekend") || text.includes("sat & sun") || text.includes("sat-sun");
      if (kind === "weekday")
        return text.includes("weekday") || text.includes("mon - fri") || text.includes("mon-friday");
      return text.includes("campus") && !text.includes("weekend");
    });
  const readTimes = (row: string[] | undefined, fallback: string[]) =>
    sessionColumns.map((column, index) => row?.[column] || fallback[index] || "");
  const campusTimes = readTimes(timingRow("campus"), [
    "09:00 AM-10:30 AM",
    "11:15 AM-12:45 PM",
    "02:00 PM-03:30 PM",
    "03:45 PM-05:15 PM",
    "05:30 PM-07:00 PM",
  ]);
  const weekdayTimes = readTimes(timingRow("weekday"), [
    "",
    "",
    "",
    "07:30 PM-09:00 PM",
    "09:15 PM-10:45 PM",
  ]);
  const weekendTimes = readTimes(timingRow("weekend"), [
    "10:00 AM-11:30 AM",
    "11:45 AM-01:15 PM",
    "03:00 PM-04:30 PM",
    "04:45 PM-06:15 PM",
    "06:30 PM-08:00 PM",
  ]);

  const mappingRow = rows.find((row) => {
    const values = row.map((cell) => cell.trim().toLowerCase());
    return values.includes("course code") && values.includes("subject name");
  });
  const courseCodeColumn = mappingRow
    ? mappingRow.findIndex((cell) => cell.trim().toLowerCase() === "course code")
    : -1;
  const subjectNameColumn = mappingRow
    ? mappingRow.findIndex((cell) => cell.trim().toLowerCase() === "subject name")
    : -1;
  const subjectNames = new Map<string, string>();
  if (courseCodeColumn >= 0 && subjectNameColumn >= 0) {
    for (const row of rows) {
      const code = row[courseCodeColumn]?.trim();
      const name = row[subjectNameColumn]?.trim();
      if (code && name && code.toUpperCase() !== "TOTAL") subjectNames.set(code, name);
    }
  }

  const EXCLUDED_SUBJECTS = new Set([
    "Buffer slot",
    "Conclusion of In-Campus II",
    "Id ul Zuha",
    "Muharram",
    "Work Shop (CR203)",
  ]);

  const schedule: DaySchedule[] = [];
  const subjectsSet = new Set<string>();
  let currentWeek = "";

  for (const row of rows) {
    const dateStr = row[dateColumn];
    if (!dateStr || !/^\d{1,2}-[A-Za-z]+(?:-\d{2,4})?$/.test(dateStr.trim())) continue;

    const weekCol = row[0];
    const dayCol = row[dayColumn];

    if (weekCol && weekCol.startsWith("Week")) {
      currentWeek = weekCol;
    }

    if (!dayCol || dayCol === "Day") continue;

    const isWeekend = dayCol === "Saturday" || dayCol === "Sunday";
    const hasCampusSessions = sessionColumns
      .slice(0, 3)
      .some((column) => row[column]);
    const times = isWeekend
      ? weekendTimes
      : hasCampusSessions && timingRow("campus")
        ? campusTimes
        : weekdayTimes;

    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      const subject = (row[sessionColumns[i]!] || "").trim();
      const time = times[i] || "";
      if (
        subject &&
        time &&
        !EXCLUDED_SUBJECTS.has(subject) &&
        !/holiday/i.test(subject)
      ) {
        subjectsSet.add(subject);
        sessions.push({
          slot: i + 1,
          time,
          subject,
          subjectName: subjectNames.get(subject),
        });
      }
    }

    if (sessions.length > 0) {
      schedule.push({
        date: dateStr,
        day: dayCol,
        week: currentWeek,
        sessions,
      });
    }
  }

  return {
    subjects: Array.from(subjectsSet).sort(),
    schedule,
    lastFetched: new Date().toISOString(),
  };
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function shouldRefetch(): boolean {
  if (!cachedData || !lastFetchDate) return true;
  // Re-fetch if cache is older than TTL
  if (Date.now() - lastFetchTimestamp > CACHE_TTL_MS) return true;
  return false;
}

async function fetchSchedule(): Promise<ScheduleData> {
  if (!shouldRefetch() && cachedData) return cachedData;

  const response = await fetch(SHEET_CSV_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet: ${response.status}`);
  }

  const csvText = await response.text();
  const data = parseSchedule(csvText);

  cachedData = data;
  lastFetchDate = todayStr();
  lastFetchTimestamp = Date.now();

  return data;
}

// Warm up cache on startup
fetchSchedule().catch(() => {});

scheduleRouter.get("/schedule", async (req, res) => {
  try {
    const data = await fetchSchedule();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch schedule");
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

export default scheduleRouter;
