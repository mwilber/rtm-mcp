import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { CalendarError, WEEKDAYS, addDays, addMonths, dateContext, iso, isWeekday, parseDate, period, weekday } from "./calendar-date.js";
import { FEDERAL_IDS, HOLIDAY_YEARS, HolidayProvider, validateHolidayYear } from "./holiday-provider.js";

const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const choice = (...values) => ({ type: "string", enum: values });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Exact Gregorian date, YYYY-MM-DD." };
const contextProperties = {
  timeZone: { type: "string", minLength: 1, description: "IANA timezone. Defaults to CALENDAR_TIME_ZONE, otherwise UTC." },
  referenceDate: { ...dateSchema, description: "Anchor for relative dates; defaults to today in the chosen timezone." },
};
const periodUnit = choice("week", "month", "quarter", "year");
const ordinal = { oneOf: [integer(1, 5), choice("last")] };
const businessCalendar = choice("us-federal", "weekdays");
const stepSchema = { oneOf: [
  object({ operation: { const: "offset" }, unit: choice("days", "weeks"), amount: integer(-3660, 3660) }, ["operation", "unit", "amount"]),
  object({ operation: { const: "offset" }, unit: choice("months", "years"), amount: integer(-100, 100), overflow: choice("constrain", "reject") }, ["operation", "unit", "amount", "overflow"]),
  object({ operation: { const: "offset" }, unit: { const: "businessDays" }, amount: integer(-366, 366), calendar: businessCalendar }, ["operation", "unit", "amount", "calendar"]),
  object({ operation: { const: "weekday" }, weekday: choice(...WEEKDAYS), direction: choice("before", "after"), inclusive: { type: "boolean" } }, ["operation", "weekday", "direction", "inclusive"]),
  object({ operation: { const: "nthWeekday" }, weekday: choice(...WEEKDAYS), ordinal }, ["operation", "weekday", "ordinal"]),
  object({ operation: { const: "weekend" }, ordinal, membership: choice("startsInPeriod", "overlapsPeriod") }, ["operation", "ordinal", "membership"]),
  object({ operation: { const: "boundary" }, edge: choice("start", "end") }, ["operation", "edge"]),
  object({ operation: { const: "businessDay" }, ordinal: choice("first", "last"), calendar: businessCalendar }, ["operation", "ordinal", "calendar"]),
  object({ operation: { const: "period" }, unit: periodUnit, offset: integer(-100, 100) }, ["operation", "unit"]),
] };
const anchorSchema = { oneOf: [
  object({ kind: { const: "date" }, date: dateSchema }, ["kind", "date"]),
  object({ kind: { const: "range" }, start: dateSchema, end: dateSchema }, ["kind", "start", "end"]),
  object({ kind: { const: "today" } }, ["kind"]),
  object({ kind: { const: "period" }, unit: periodUnit, offset: integer(-100, 100) }, ["kind", "unit"]),
  object({ kind: { const: "holiday" }, holidayId: { type: "string", pattern: "^us-[a-z0-9-]+$" }, year: integer(2000, 2100), dateType: choice("actual", "observed") }, ["kind", "holidayId", "year", "dateType"]),
  object({ kind: { const: "holiday" }, holidayId: { type: "string", pattern: "^us-[a-z0-9-]+$" }, occurrence: { const: "next" }, dateType: choice("actual", "observed") }, ["kind", "holidayId", "occurrence", "dateType"]),
  object({ kind: { const: "uncertain" }, description: { type: "string", minLength: 1, maxLength: 500 } }, ["kind", "description"]),
] };

export const CALENDAR_TOOLS = [
  {
    name: "rtm-get-date-context", title: "RTM: Get Date Context",
    description: "Get today's date, weekday, local time, timezone, and calendar period boundaries. No RTM or holiday credentials needed. Weeks start Monday; weekends are Saturday–Sunday.",
    inputSchema: object(contextProperties),
  },
  {
    name: "rtm-list-holidays", title: "RTM: List US Holidays",
    description: "Discover known nationwide US holidays and observances, stable IDs, actual/observed dates, coverage, and freshness for a year (default reference year). Optional search and category filters. Requires Calendarific. On provider error obey doNotRetry and retryAfter; changing years or tools does not bypass the outage.",
    inputSchema: object({ ...contextProperties, year: integer(2000, 2100), search: { type: "string", maxLength: 200 },
      categories: { type: "array", items: choice("federal", "national", "religious", "observance"), minItems: 1, uniqueItems: true } }),
  },
  {
    name: "rtm-resolve-date", title: "RTM: Resolve Date",
    description: "Resolve structured calendar calculations into an exact ISO date or inclusive range. Choose an anchor, then apply up to 10 ordered steps: offset, weekday before/after, nthWeekday, weekend, boundary, businessDay, or period. nthWeekday/weekend/businessDay/boundary require a period/range. Use boundary to explicitly select a range endpoint before date arithmetic. weekday inclusive=false means strictly before/after. Holiday next means on/after referenceDate, searching this and next holiday year. Business calendar us-federal excludes observed federal holidays; weekdays excludes only weekends. Weekend membership must be explicit. Months/years require overflow=constrain or reject. Use uncertain for vague wording or missing personal calendars; never invent a date. A range is not an exact task due date: clarify the endpoint. Provider failures must not be retried in this turn, including through other tools.",
    inputSchema: object({ ...contextProperties, anchor: anchorSchema,
      steps: { type: "array", items: stepSchema, maxItems: 10 } }, ["anchor"]),
  },
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: tool.name !== "rtm-get-date-context" } }));

const validator = new AjvJsonSchemaValidator();
const validators = new Map(CALENDAR_TOOLS.map((tool) => [tool.name, validator.getValidator(tool.inputSchema)]));
let sharedProvider;
// Lazily construct after dotenv is loaded, and share cache/circuit across MCP sessions.
const defaultProvider = () => sharedProvider ??= new HolidayProvider();

export function calendarErrorResult(error) {
  const known = error instanceof CalendarError;
  const result = {
    status: "error", error: {
      code: known ? error.code : "CALENDAR_INTERNAL_ERROR",
      message: known ? error.message : "The calendar calculation failed. Do not guess a due date.",
      retryable: false, doNotRetry: true, retryAfter: null,
      nextAction: "Correct the inputs or ask the user for a specific date before creating a task.",
      ...(known ? error.details : {}),
    },
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
}

export async function callCalendarTool(name, args, { provider, now = () => new Date() } = {}) {
  try {
    const validation = validators.get(name)?.(args);
    if (!validation?.valid) throw new CalendarError("INVALID_ARGUMENT", validation?.errorMessage || "Unknown calendar tool.");
    const context = dateContext(args, now());
    let result;
    if (name === "rtm-get-date-context") result = { status: "resolved", ...context };
    else if (name === "rtm-list-holidays") {
      const year = args.year ?? Number(context.referenceDate.slice(0, 4));
      const data = await (provider || defaultProvider()).getYear(year);
      const search = args.search?.toLowerCase();
      const holidays = data.holidays.filter((holiday) =>
        (!args.categories || args.categories.includes(holiday.category)) &&
        (!search || [holiday.id, holiday.name, ...holiday.aliases].some((value) => value.toLowerCase().includes(search))));
      result = { status: "resolved", ...data, year, holidays, total: holidays.length,
        coverage: { country: "US", scope: "nationwide", supportedYears: HOLIDAY_YEARS,
          note: "Provider-reported holidays and observances; not employer, state, school, or market calendars. No matches does not prove an event does not exist. Observed-only records can belong to an adjacent holidayYear." } };
    } else {
      result = await resolveDate(args, context, () => provider || defaultProvider());
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    return calendarErrorResult(error);
  }
}

async function resolveDate(args, context, getProvider) {
  const { anchor, steps = [] } = args;
  if (anchor.kind === "uncertain") return { status: "needsClarification", explanation: "The wording or personal calendar does not identify an exact date. Ask for a date, range, calendar definition, or explicit interpretation. Do not create a task with a guessed due date." };
  const reference = parseDate(context.referenceDate);
  const warnings = [];
  const sources = [];
  const explanation = [];
  const yearData = new Map();
  const getYear = async (year) => {
    if (!yearData.has(year)) {
      const data = await getProvider().getYear(year);
      yearData.set(year, data);
      warnings.push(...data.warnings);
      sources.push({ source: data.source, year, retrievedAt: data.retrievedAt, cache: data.cache });
    }
    return yearData.get(year).holidays;
  };
  let value;
  if (anchor.kind === "date") value = parseDate(anchor.date);
  if (anchor.kind === "range") {
    value = { start: parseDate(anchor.start), end: parseDate(anchor.end) };
    if (value.start > value.end || value.end - value.start > 365 * 86_400_000) {
      throw new CalendarError("INVALID_RANGE", "Use an inclusive range of at most 366 days, with start on or before end.");
    }
  }
  if (anchor.kind === "today") value = reference;
  if (anchor.kind === "period") value = period(reference, anchor.unit, anchor.offset ?? 0);
  if (anchor.kind === "holiday") {
    const year = anchor.year ?? reference.getUTCFullYear();
    const field = `${anchor.dateType}Date`;
    let found;
    // Adjacent holiday years cover next observed New Year's Day in December.
    for (const lookupYear of anchor.occurrence === "next" ? [year, year + 1] : [year]) {
      validateHolidayYear(lookupYear);
      const matches = (await getYear(lookupYear)).filter((holiday) => holiday.id === anchor.holidayId &&
        (anchor.year === undefined || holiday.holidayYear === anchor.year) && holiday[field] &&
        (anchor.occurrence !== "next" || holiday[field] >= context.referenceDate));
      if (anchor.year !== undefined && new Set(matches.map((holiday) => holiday[field])).size > 1) {
        throw new CalendarError("HOLIDAY_AMBIGUOUS", "This holiday has multiple known dates in that year. Ask the user to select an occurrence or use occurrence=next with an explicit referenceDate.", {
          candidates: [...new Set(matches.map((holiday) => holiday[field]))].sort(),
        });
      }
      const candidate = matches.sort((a, b) => a[field].localeCompare(b[field]))[0];
      if (candidate && (!found || candidate[field] < found[field])) found = candidate;
      if (found) break;
    }
    if (!found) throw new CalendarError("HOLIDAY_NOT_FOUND", "No known date matched that holiday ID and date type within the requested year or next-occurrence search horizon. Use rtm-list-holidays or ask for an explicit date.");
    value = parseDate(found[field]);
    explanation.push(`${found.name}: ${anchor.dateType} date ${found[field]} (holiday year ${found.holidayYear})`);
  }

  const businessSets = new Map();
  const business = async (date, calendar) => {
    if (!isWeekday(date)) return false;
    if (calendar === "weekdays") return true;
    const year = date.getUTCFullYear();
    if (!businessSets.has(year)) {
      const rows = await getYear(year);
      const expected = FEDERAL_IDS.filter((id) => id !== "us-juneteenth-national-independence-day" || year >= 2021);
      if (expected.some((id) => !rows.some((holiday) => holiday.id === id && holiday.category === "federal" && holiday.actualDate?.startsWith(`${year}-`)))) {
        throw new CalendarError("INCOMPLETE_HOLIDAY_CALENDAR", "The provider did not supply a complete nationwide federal calendar. Cannot safely calculate business days.");
      }
      businessSets.set(year, new Set(rows.filter((holiday) => holiday.category === "federal")
        .map((holiday) => holiday.observedDate).filter(Boolean)));
    }
    // Only December 31 can require the following year's closure data. Avoid
    // requesting another year (or exhausting coverage) for unrelated dates.
    if (iso(date).endsWith("-12-31") && date.getUTCDay() === 5 && !businessSets.get(year).has(iso(date))) {
      const rows = await getYear(year + 1);
      const newYear = rows.find((holiday) => holiday.id === "us-new-years-day" && holiday.actualDate === `${year + 1}-01-01`);
      if (!newYear?.observedDate) throw new CalendarError("INCOMPLETE_HOLIDAY_CALENDAR", "The provider did not supply next year's New Year's closure. Cannot safely calculate business days.");
      businessSets.get(year).add(newYear.observedDate);
    }
    return !businessSets.get(year).has(iso(date));
  };
  const requireDate = () => {
    if (!(value instanceof Date)) throw new CalendarError("RANGE_NEEDS_SELECTION", "Select a range endpoint using boundary before applying date arithmetic.");
  };
  const requireRange = () => {
    if (value instanceof Date) throw new CalendarError("PERIOD_REQUIRED", "This operation requires a period anchor or a period step.");
  };
  explanation.push(value instanceof Date ? `Anchor ${iso(value)}` : `Anchor range ${iso(value.start)} through ${iso(value.end)}`);
  for (const step of steps) {
    switch (step.operation) {
      case "offset": {
        requireDate();
        if (step.unit === "days" || step.unit === "weeks") value = addDays(value, step.amount * (step.unit === "weeks" ? 7 : 1));
        else if (step.unit === "months" || step.unit === "years") value = addMonths(value, step.amount * (step.unit === "years" ? 12 : 1), step.overflow);
        else {
          let remaining = Math.abs(step.amount);
          while (remaining) {
            value = addDays(value, Math.sign(step.amount));
            if (await business(value, step.calendar)) remaining--;
          }
        }
        break;
      }
      case "weekday": {
        requireDate();
        const direction = step.direction === "before" ? -1 : 1;
        if (!step.inclusive) value = addDays(value, direction);
        while (weekday(value) !== step.weekday) value = addDays(value, direction);
        break;
      }
      case "period":
        requireDate();
        value = period(value, step.unit, step.offset ?? 0);
        break;
      case "boundary":
        requireRange();
        value = value[step.edge];
        break;
      case "nthWeekday": {
        requireRange();
        const matches = [];
        for (let date = value.start; date <= value.end; date = addDays(date, 1)) {
          if (weekday(date) === step.weekday) matches.push(date);
        }
        value = matches[step.ordinal === "last" ? matches.length - 1 : step.ordinal - 1];
        if (!value) throw new CalendarError("NO_MATCHING_DATE", "That weekday occurrence does not exist in the period.");
        break;
      }
      case "weekend": {
        requireRange();
        const matches = [];
        const start = step.membership === "overlapsPeriod" ? addDays(value.start, -1) : value.start;
        for (let date = start; date <= value.end; date = addDays(date, 1)) {
          if (date.getUTCDay() === 6) matches.push({ start: date, end: addDays(date, 1) });
        }
        value = matches[step.ordinal === "last" ? matches.length - 1 : step.ordinal - 1];
        if (!value) throw new CalendarError("NO_MATCHING_DATE", "That weekend occurrence does not exist in the period.");
        break;
      }
      case "businessDay": {
        requireRange();
        const range = value;
        const direction = step.ordinal === "first" ? 1 : -1;
        let date = step.ordinal === "first" ? range.start : range.end;
        while (date >= range.start && date <= range.end && !await business(date, step.calendar)) date = addDays(date, direction);
        if (date < range.start || date > range.end) throw new CalendarError("NO_MATCHING_DATE", "No business day exists in the selected range.");
        value = date;
        break;
      }
    }
    explanation.push(`${step.operation}: ${value instanceof Date ? iso(value) : `${iso(value.start)} through ${iso(value.end)}`}`);
  }
  return { status: "resolved", kind: value instanceof Date ? "date" : "range",
    ...(value instanceof Date ? { date: iso(value), weekday: weekday(value) }
      : { start: iso(value.start), end: iso(value.end), inclusive: true, requiresDateSelection: true }),
    referenceDate: context.referenceDate, timeZone: context.timeZone, explanation: explanation.join("; "),
    sources, warnings,
  };
}
