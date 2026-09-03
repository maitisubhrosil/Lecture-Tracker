import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

// This CSV is maintained by the schedule administrator in the public repository.
// Keep this URL non-interactive so GitHub Actions can refresh the bundled data
// without a university account or a stored personal session.
const SCHEDULE_CSV_URL =
  process.env.SCHEDULE_CSV_URL ??
  "https://raw.githubusercontent.com/maitisubhrosil/Lecture-Tracker/main/attached_assets/Term_VI_Schedule_Final_Live.xlsx_-_Sheet1_1788178867780.csv";

const EXCLUDED_SUBJECTS = new Set([
  "Buffer slot",
  "Conclusion of In-Campus II",
  "Id ul Zuha",
  "Muharram",
  "Work Shop (CR203)",
]);

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

function hasScheduleChanged(previous: ScheduleData, next: ScheduleData): boolean {
  return JSON.stringify({
    subjects: previous.subjects,
    schedule: previous.schedule,
  }) !== JSON.stringify({
    subjects: next.subjects,
    schedule: next.schedule,
  });
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) { cells.push(current.trim()); current = ""; }
      else current += char;
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
    "09:00 AM-10:30 AM", "11:15 AM-12:45 PM", "02:00 PM-03:30 PM",
    "03:45 PM-05:15 PM", "05:30 PM-07:00 PM",
  ]);
  const weekdayTimes = readTimes(timingRow("weekday"), [
    "", "", "", "07:30 PM-09:00 PM", "09:15 PM-10:45 PM",
  ]);
  const weekendTimes = readTimes(timingRow("weekend"), [
    "10:00 AM-11:30 AM", "11:45 AM-01:15 PM", "03:00 PM-04:30 PM",
    "04:45 PM-06:15 PM", "06:30 PM-08:00 PM",
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

  const schedule: DaySchedule[] = [];
  const subjectsSet = new Set<string>();
  let currentWeek = "";

  for (const row of rows) {
    const dateStr = row[dateColumn];
    if (!dateStr || !/^\d{1,2}-[A-Za-z]+(?:-\d{2,4})?$/.test(dateStr.trim())) continue;
    if (row[0]?.startsWith("Week")) currentWeek = row[0];
    const dayCol = row[dayColumn];
    if (!dayCol || dayCol === "Day") continue;

    const isWeekend = dayCol === "Saturday" || dayCol === "Sunday";
    const hasCampus = sessionColumns.slice(0, 3).some((column) => row[column]);
    const times = isWeekend
      ? weekendTimes
      : hasCampus && timingRow("campus")
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
      schedule.push({ date: dateStr, day: dayCol, week: currentWeek, sessions });
    }
  }

  return { subjects: Array.from(subjectsSet).sort(), schedule, lastFetched: new Date().toISOString() };
}

async function main() {
  console.log("Fetching schedule from the administrator-provided CSV...");
  let response: Response;
  try {
    response = await fetch(SCHEDULE_CSV_URL, { redirect: "follow" });
  } catch (error) {
    console.warn(
      `Warning: live schedule could not be reached (${error instanceof Error ? error.message : String(error)}).`,
    );
    console.warn("Keeping the existing stored schedule data.");
    return;
  }
  if (!response.ok) {
    console.warn(`Warning: live schedule returned HTTP ${response.status}.`);
    console.warn("Keeping the existing stored schedule data.");
    return;
  }

  const csvText = await response.text();
  const data = parseSchedule(csvText);
  if (data.schedule.length === 0 || data.subjects.length === 0) {
    console.warn("Warning: live schedule did not contain any usable sessions.");
    console.warn("Keeping the existing stored schedule data.");
    return;
  }

  const outputPath = path.resolve("artifacts/schedule/public/schedule-data.json");
  try {
    const existingData = JSON.parse(readFileSync(outputPath, "utf8")) as ScheduleData;
    if (!hasScheduleChanged(existingData, data)) {
      console.log("✓ Schedule is unchanged; keeping the existing stored data.");
      return;
    }
  } catch {
    // A missing or unreadable fallback should be replaced by the valid live data.
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`✓ Schedule updated: ${data.schedule.length} days, ${data.subjects.length} subjects`);
  console.log(`  Last fetched: ${data.lastFetched}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
