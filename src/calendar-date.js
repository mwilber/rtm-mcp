export class CalendarError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_MS = 86_400_000;

// UTC is only a container for civil dates. Never add milliseconds to a local time.
export function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CalendarError("INVALID_DATE", "Use an exact YYYY-MM-DD date.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new CalendarError("INVALID_DATE", `Invalid calendar date: ${value}.`);
  }
  return date;
}

export function iso(date) {
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    throw new CalendarError("DATE_OUT_OF_RANGE", "The calculation exceeds supported calendar dates.");
  }
  return date.toISOString().slice(0, 10);
}

export const addDays = (date, amount) => new Date(date.getTime() + amount * DAY_MS);
export const weekday = (date) => WEEKDAYS[date.getUTCDay()];
export const isWeekday = (date) => ![0, 6].includes(date.getUTCDay());

export function addMonths(date, amount, overflow = "constrain") {
  const target = new Date(date);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + amount);
  const lastDay = new Date(target);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  if (day > lastDay.getUTCDate() && overflow === "reject") {
    throw new CalendarError("INVALID_DATE", "The target month has no such day. Choose overflow=constrain or another date.");
  }
  target.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  iso(target);
  return target;
}

export function period(date, unit, offset = 0) {
  let start = new Date(date);
  if (unit === "week") {
    start = addDays(start, -((start.getUTCDay() + 6) % 7) + offset * 7);
    return { start, end: addDays(start, 6) };
  }
  start.setUTCDate(1);
  if (unit === "year") start.setUTCMonth(0);
  if (unit === "quarter") start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
  const months = { month: 1, quarter: 3, year: 12 }[unit];
  if (!months) throw new CalendarError("INVALID_ARGUMENT", "Unknown calendar period.");
  start = addMonths(start, offset * months);
  return { start, end: addDays(addMonths(start, months), -1) };
}

export function dateContext({ timeZone = process.env.CALENDAR_TIME_ZONE || "UTC", referenceDate } = {}, now = new Date()) {
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(({ type, value }) => [type, value]));
  } catch {
    throw new CalendarError("INVALID_TIME_ZONE", "Use a valid IANA timeZone or configure CALENDAR_TIME_ZONE.");
  }
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const date = parseDate(referenceDate ?? today);
  return {
    today, referenceDate: iso(date), localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    timeZone, weekday: weekday(date),
    periods: Object.fromEntries(["week", "month", "quarter", "year"].map((unit) => {
      const range = period(date, unit);
      return [unit, { start: iso(range.start), end: iso(range.end) }];
    })),
    conventions: { weekStartsOn: "monday", weekend: ["saturday", "sunday"], quarters: "calendar" },
  };
}
