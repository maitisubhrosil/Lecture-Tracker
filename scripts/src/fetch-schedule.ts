import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1VZauPSkJxNduZixiecFjoF0c0BmH7NNY6nBNNSnbJac/export?format=csv&gid=502725552";

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

  let campusTimes: string[] = rows[5]
    ? [rows[5][4] || "09:00 AM-10:30 AM", rows[5][5] || "11:15 AM-12:45 PM",
       rows[5][6] || "02:00 PM-03:30 PM", rows[5][7] || "03:45 PM-05:15 PM",
       rows[5][8] || "05:30 PM-07:00 PM"]
    : ["09:00 AM-10:30 AM", "11:15 AM-12:45 PM", "02:00 PM-03:30 PM", "03:45 PM-05:15 PM", "05:30 PM-07:00 PM"];

  let weekdayTimes: string[] = [];
  let weekendTimes: string[] = [];

  for (const row of rows) {
    const label = (row[2] || "").toLowerCase();
    if (label.includes("mon-friday") || label.includes("weekday")) {
      weekdayTimes = ["", "", "", row[7] || "07:30 PM-09:00 PM", row[8] || "09:15 PM-10:45 PM"];
    }
    if (label.includes("sat-sun") || label.includes("weekend")) {
      weekendTimes = [row[4] || "10:00 AM-11:30 AM", row[5] || "11:45 AM-01:15 PM",
        row[6] || "03:00 PM-04:30 PM", row[7] || "04:45 PM-06:15 PM", row[8] || "06:30 PM-08:00 PM"];
    }
  }

  if (!weekdayTimes.length) weekdayTimes = ["", "", "", "07:30 PM-09:00 PM", "09:15 PM-10:45 PM"];
  if (!weekendTimes.length) weekendTimes = ["10:00 AM-11:30 AM", "11:45 AM-01:15 PM",
    "03:00 PM-04:30 PM", "04:45 PM-06:15 PM", "06:30 PM-08:00 PM"];

  const schedule: DaySchedule[] = [];
  const subjectsSet = new Set<string>();
  let currentWeek = "";

  for (const row of rows) {
    const dateStr = row[1];
    if (!dateStr || !/\d{2}-[A-Za-z]+-\d{2}/.test(dateStr)) continue;
    if (row[0]?.startsWith("Week")) currentWeek = row[0];
    const dayCol = row[2];
    if (!dayCol || dayCol === "Day") continue;

    const isWeekend = dayCol === "Saturday" || dayCol === "Sunday";
    const hasCampus = !!(row[4] || row[5] || row[6]);
    const times = isWeekend ? weekendTimes : hasCampus ? campusTimes : weekdayTimes;

    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      const subject = (row[4 + i] || "").trim();
      const time = times[i] || "";
      if (subject && time && !EXCLUDED_SUBJECTS.has(subject)) {
        subjectsSet.add(subject);
        sessions.push({ slot: i + 1, time, subject });
      }
    }
    if (sessions.length > 0) {
      schedule.push({ date: dateStr, day: dayCol, week: currentWeek, sessions });
    }
  }

  return { subjects: Array.from(subjectsSet).sort(), schedule, lastFetched: new Date().toISOString() };
}

async function main() {
  console.log("Fetching schedule from Google Sheets...");
  const response = await fetch(SHEET_CSV_URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const csvText = await response.text();
  const data = parseSchedule(csvText);

  const outputPath = path.resolve("artifacts/schedule/public/schedule-data.json");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`✓ Schedule updated: ${data.schedule.length} days, ${data.subjects.length} subjects`);
  console.log(`  Last fetched: ${data.lastFetched}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
