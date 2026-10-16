import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callCalendarTool } from "../src/calendar-tools.js";
import { HolidayProvider } from "../src/holiday-provider.js";
import { federal2026, federal2027, holiday, httpError, ok } from "./fixtures/holidays.js";

const fixedNow = () => new Date("2026-10-16T12:00:00Z");
const run = async (args, provider, name = "rtm-resolve-date") =>
  (await callCalendarTool(name, { referenceDate: "2026-10-16", ...args }, { provider, now: fixedNow })).structuredContent;
const dateAnchor = (date) => ({ kind: "date", date });
const periodAnchor = (unit, offset = 0) => ({ kind: "period", unit, offset });
const weekend = (membership = "startsInPeriod", ordinal = 1) => ({ operation: "weekend", ordinal, membership });
const boundary = (edge) => ({ operation: "boundary", edge });
const provider = () => new HolidayProvider({ apiKey: "test", fetchImpl: async (url) => {
  const year = Number(new URL(url).searchParams.get("year"));
  return ok(year === 2026 ? federal2026 : year === 2027 ? federal2027 : [holiday("New Year's Day", "2028-01-01")]);
} });

describe("calendar date helpers", () => {
  it("returns timezone-aware dates and period boundaries without credentials", async () => {
    const result = await callCalendarTool("rtm-get-date-context", { timeZone: "America/New_York" }, {
      now: () => new Date("2026-01-01T02:30:00Z"),
    });
    assert.equal(result.structuredContent.today, "2025-12-31");
    assert.equal(result.structuredContent.localTime, "21:30:00");
    assert.equal(result.structuredContent.weekday, "wednesday");
    assert.deepEqual(result.structuredContent.periods.week, { start: "2025-12-29", end: "2026-01-04" });
    assert.deepEqual(result.structuredContent.periods.quarter, { start: "2025-10-01", end: "2025-12-31" });
  });

  it("keeps date arithmetic independent of daylight saving transitions", async () => {
    for (const referenceDate of ["2026-03-07", "2026-10-31"]) {
      const result = await run({ referenceDate, timeZone: "America/New_York", anchor: { kind: "today" }, steps: [
        { operation: "offset", unit: "days", amount: 1 },
      ] });
      assert.equal(result.date, referenceDate === "2026-03-07" ? "2026-03-08" : "2026-11-01");
    }
  });

  it("distinguishes the first weekend starting in a month from one overlapping it", async () => {
    const starts = await run({ anchor: periodAnchor("month", 1), steps: [weekend()] });
    assert.equal(starts.start, "2026-11-07");
    assert.equal(starts.end, "2026-11-08");
    assert.equal(starts.requiresDateSelection, true);
    const overlaps = await run({ anchor: periodAnchor("month", 1), steps: [weekend("overlapsPeriod")] });
    assert.equal(overlaps.start, "2026-10-31");
    assert.equal(overlaps.end, "2026-11-01");
    const selected = await run({ anchor: periodAnchor("month", 1), steps: [weekend(), boundary("start")] });
    assert.equal(selected.date, "2026-11-07");
  });

  it("handles current versus upcoming weekend on a Sunday", async () => {
    const current = await run({ referenceDate: "2026-11-01", anchor: periodAnchor("week"), steps: [weekend()] });
    const upcoming = await run({ referenceDate: "2026-11-01", anchor: periodAnchor("week", 1), steps: [weekend()] });
    assert.equal(current.start, "2026-10-31");
    assert.equal(upcoming.start, "2026-11-07");
  });

  it("finds nth and last weekdays, and rejects missing fifth occurrences", async () => {
    assert.equal((await run({ anchor: periodAnchor("month", 1), steps: [
      { operation: "nthWeekday", weekday: "tuesday", ordinal: 2 },
    ] })).date, "2026-11-10");
    assert.equal((await run({ anchor: periodAnchor("month", 1), steps: [
      { operation: "nthWeekday", weekday: "friday", ordinal: "last" },
    ] })).date, "2026-11-27");
    assert.equal((await run({ referenceDate: "2027-02-01", anchor: periodAnchor("month"), steps: [
      { operation: "nthWeekday", weekday: "monday", ordinal: 5 },
    ] })).error.code, "NO_MATCHING_DATE");
    assert.equal((await run({ referenceDate: "2027-02-01", anchor: periodAnchor("month"), steps: [
      weekend("startsInPeriod", 5),
    ] })).error.code, "NO_MATCHING_DATE");
  });

  it("uses strict and inclusive weekday relations", async () => {
    for (const [direction, inclusive, expected] of [
      ["before", false, "2026-12-18"], ["before", true, "2026-12-25"],
      ["after", false, "2027-01-01"], ["after", true, "2026-12-25"],
    ]) {
      assert.equal((await run({ anchor: dateAnchor("2026-12-25"), steps: [
        { operation: "weekday", weekday: "friday", direction, inclusive },
      ] })).date, expected);
    }
  });

  it("handles leap years and explicit overflow policies", async () => {
    const offset = (unit, amount, overflow) => ({ operation: "offset", unit, amount, overflow });
    assert.equal((await run({ anchor: dateAnchor("2028-01-31"), steps: [offset("months", 1, "constrain")] })).date, "2028-02-29");
    assert.equal((await run({ anchor: dateAnchor("2028-02-29"), steps: [offset("years", 1, "constrain")] })).date, "2029-02-28");
    assert.equal((await run({ anchor: dateAnchor("2028-01-31"), steps: [offset("months", 1, "reject")] })).error.code, "INVALID_DATE");
    assert.equal((await run({ anchor: dateAnchor("2028-02-29"), steps: [offset("months", -1, "constrain")] })).date, "2028-01-29");
  });

  it("calculates quarter/year boundaries and weeks before a date", async () => {
    assert.equal((await run({ anchor: periodAnchor("quarter", 1), steps: [boundary("end")] })).date, "2027-03-31");
    assert.equal((await run({ anchor: dateAnchor("2028-02-29"), steps: [
      { operation: "period", unit: "year", offset: 1 }, boundary("start"),
    ] })).date, "2029-01-01");
    assert.equal((await run({ anchor: dateAnchor("2026-09-07"), steps: [
      { operation: "offset", unit: "weeks", amount: -2 },
    ] })).date, "2026-08-24");
  });

  it("lists filtered known holidays with IDs, coverage, and freshness", async () => {
    const result = await run({ search: "Christmas", categories: ["federal"] }, provider(), "rtm-list-holidays");
    assert.equal(result.total, 1);
    assert.equal(result.holidays[0].id, "us-christmas-day");
    assert.equal(result.coverage.country, "US");
    assert.equal(result.cache, "fresh");
    assert.ok(result.retrievedAt);
  });

  it("resolves the Friday before the next Christmas", async () => {
    const result = await run({ anchor: { kind: "holiday", holidayId: "us-christmas-day", occurrence: "next", dateType: "actual" }, steps: [
      { operation: "weekday", weekday: "friday", direction: "before", inclusive: false },
    ] }, provider());
    assert.equal(result.date, "2026-12-18");
    assert.equal(result.sources.length, 1);
  });

  it("distinguishes actual and observed holiday dates, with next including today", async () => {
    const holidayAnchor = { kind: "holiday", holidayId: "us-christmas-day", year: 2027 };
    assert.equal((await run({ anchor: { ...holidayAnchor, dateType: "actual" } }, provider())).date, "2027-12-25");
    assert.equal((await run({ anchor: { ...holidayAnchor, dateType: "observed" } }, provider())).date, "2027-12-24");
    assert.equal((await run({ referenceDate: "2026-12-25", anchor: {
      kind: "holiday", holidayId: "us-christmas-day", occurrence: "next", dateType: "actual",
    } }, provider())).date, "2026-12-25");
    assert.equal((await run({ referenceDate: "2026-12-26", anchor: {
      kind: "holiday", holidayId: "us-christmas-day", occurrence: "next", dateType: "actual",
    } }, provider())).date, "2027-12-25");
  });

  it("resolves next observed New Year's Day across the holiday-year boundary", async () => {
    assert.equal((await run({ referenceDate: "2027-12-20", anchor: {
      kind: "holiday", holidayId: "us-new-years-day", occurrence: "next", dateType: "observed",
    } }, provider())).date, "2027-12-31");
  });

  it("does not substitute an actual date when an observed date is unknown", async () => {
    const holidays = new HolidayProvider({ apiKey: "test", fetchImpl: async () => ok([
      holiday("Halloween", "2026-10-31", { type: ["Observance"] }),
    ]) });
    assert.equal((await run({ anchor: { kind: "holiday", holidayId: "us-halloween", year: 2026, dateType: "observed" } }, holidays)).error.code, "HOLIDAY_NOT_FOUND");
  });

  it("preserves repeated observances and requires an unambiguous occurrence", async () => {
    const holidays = new HolidayProvider({ apiKey: "test", fetchImpl: async () => ok([
      holiday("Example Observance", "2026-01-05", { type: ["Religious"] }),
      holiday("Example Observance", "2026-12-26", { type: ["Religious"] }),
    ]) });
    const anchor = { kind: "holiday", holidayId: "us-example-observance", dateType: "actual" };
    const ambiguous = await run({ anchor: { ...anchor, year: 2026 } }, holidays);
    assert.equal(ambiguous.error.code, "HOLIDAY_AMBIGUOUS");
    assert.deepEqual(ambiguous.error.candidates, ["2026-01-05", "2026-12-26"]);
    assert.equal((await run({ anchor: { ...anchor, occurrence: "next" } }, holidays)).date, "2026-12-26");
  });

  it("calculates weekday and federal business days in both directions", async () => {
    const offset = (amount, calendar) => ({ operation: "offset", unit: "businessDays", amount, calendar });
    assert.equal((await run({ anchor: dateAnchor("2026-11-25"), steps: [offset(1, "us-federal")] }, provider())).date, "2026-11-27");
    assert.equal((await run({ anchor: dateAnchor("2026-11-25"), steps: [offset(1, "weekdays")] })).date, "2026-11-26");
    assert.equal((await run({ anchor: dateAnchor("2026-07-06"), steps: [offset(-1, "us-federal")] }, provider())).date, "2026-07-02");
    assert.equal((await run({ anchor: dateAnchor("2026-11-26"), steps: [offset(3, "us-federal")] }, provider())).date, "2026-12-01");
    assert.equal((await run({ anchor: dateAnchor("2026-12-30"), steps: [offset(2, "us-federal")] }, provider())).date, "2027-01-04");
  });

  it("handles first/last business days and next-year federal closures in December", async () => {
    assert.equal((await run({ referenceDate: "2027-12-01", anchor: periodAnchor("month"), steps: [
      { operation: "businessDay", ordinal: "last", calendar: "us-federal" },
    ] }, provider())).date, "2027-12-30");
    assert.equal((await run({ referenceDate: "2027-02-01", anchor: periodAnchor("month"), steps: [
      { operation: "businessDay", ordinal: "last", calendar: "weekdays" },
    ] })).date, "2027-02-26");
    assert.equal((await run({ referenceDate: "2026-11-01", anchor: periodAnchor("month"), steps: [
      { operation: "businessDay", ordinal: "first", calendar: "weekdays" },
    ] })).date, "2026-11-02");
  });

  it("fails closed for incomplete federal calendars", async () => {
    const incomplete = new HolidayProvider({ apiKey: "test", fetchImpl: async () => ok([holiday("Christmas Day", "2026-12-25")]) });
    assert.equal((await run({ anchor: dateAnchor("2026-11-25"), steps: [
      { operation: "offset", unit: "businessDays", amount: 1, calendar: "us-federal" },
    ] }, incomplete)).error.code, "INCOMPLETE_HOLIDAY_CALENDAR");
    const misclassified = new HolidayProvider({ apiKey: "test", fetchImpl: async () => ok(federal2026.map((row) => ({ ...row, type: ["Observance"] }))) });
    assert.equal((await run({ anchor: dateAnchor("2026-11-25"), steps: [
      { operation: "offset", unit: "businessDays", amount: 1, calendar: "us-federal" },
    ] }, misclassified)).error.code, "INCOMPLETE_HOLIDAY_CALENDAR");
  });

  it("accepts bounded explicit ranges, requiring endpoint selection", async () => {
    const anchor = { kind: "range", start: "2026-11-10", end: "2026-11-20" };
    const result = await run({ anchor, steps: [{ operation: "nthWeekday", weekday: "friday", ordinal: 1 }] });
    assert.equal(result.date, "2026-11-13");
    assert.equal((await run({ anchor: { ...anchor, end: "2026-11-01" } })).error.code, "INVALID_RANGE");
    assert.equal((await run({ anchor: { ...anchor, end: "2030-11-01" } })).error.code, "INVALID_RANGE");
  });

  it("returns actionable provider errors without fabricated dates, while ordinary arithmetic still works", async () => {
    let requests = 0;
    const failed = new HolidayProvider({ apiKey: "test", fetchImpl: async () => { requests++; return httpError(410); } });
    const list = await run({}, failed, "rtm-list-holidays");
    const resolution = await run({ anchor: { kind: "holiday", holidayId: "us-christmas-day", year: 2027, dateType: "actual" } }, failed);
    const business = await run({ anchor: dateAnchor("2026-11-25"), steps: [
      { operation: "offset", unit: "businessDays", amount: 1, calendar: "us-federal" },
    ] }, failed);
    for (const result of [list, resolution, business]) {
      assert.equal(result.status, "error");
      assert.equal(result.error.code, "HOLIDAY_SERVICE_RETIRED");
      assert.equal(result.error.doNotRetry, true);
      assert.equal("date" in result, false);
    }
    assert.equal(requests, 1);
    assert.equal((await run({ anchor: periodAnchor("month", 1), steps: [weekend()] }, failed)).start, "2026-11-07");
  });

  it("propagates stale-cache provenance through date resolution", async () => {
    let now = Date.parse("2026-10-16T00:00:00Z");
    let requests = 0;
    const holidays = new HolidayProvider({ apiKey: "test", now: () => now, fetchImpl: async () => ++requests === 1 ? ok() : httpError(503) });
    await holidays.getYear(2026);
    now += 2 * 86_400_000;
    const result = await run({ anchor: { kind: "holiday", holidayId: "us-christmas-day", year: 2026, dateType: "actual" } }, holidays);
    assert.equal(result.date, "2026-12-25");
    assert.equal(result.sources[0].cache, "stale");
    assert.equal(result.warnings[0].code, "STALE_HOLIDAY_DATA");
  });

  it("requests clarification for vague or personal calendar references", async () => {
    for (const description of ["early next month", "my birthday", "school spring break", "next payday", "end of our fiscal quarter"]) {
      const result = await run({ anchor: { kind: "uncertain", description } });
      assert.equal(result.status, "needsClarification");
      assert.equal("date" in result, false);
    }
  });

  it("validates schemas, dates, timezones, and range composition before lookup", async () => {
    let requests = 0;
    const holidays = { getYear: async () => { requests++; throw new Error("Unexpected lookup"); } };
    for (const args of [
      { anchor: { kind: "date", date: "2026-02-30" } },
      { anchor: dateAnchor("2026-10-16"), timeZone: "Not/A_Zone" },
      { anchor: { kind: "holiday", holidayId: "us-christmas-day", year: 2026, occurrence: "next", dateType: "actual" } },
      { anchor: periodAnchor("month"), steps: [{ operation: "weekend", ordinal: 1 }] },
      { anchor: dateAnchor("2026-01-31"), steps: [{ operation: "offset", unit: "months", amount: 1 }] },
      { anchor: dateAnchor("2026-01-01"), steps: [{ operation: "offset", unit: "days", amount: "1" }] },
      { anchor: periodAnchor("month"), extra: true },
    ]) assert.equal((await run(args, holidays)).status, "error");
    assert.equal(requests, 0);
    assert.equal((await run({ anchor: periodAnchor("month"), steps: [{ operation: "offset", unit: "days", amount: 1 }] })).error.code, "RANGE_NEEDS_SELECTION");
    assert.equal((await run({ anchor: dateAnchor("2026-10-16"), steps: [weekend()] })).error.code, "PERIOD_REQUIRED");
  });
});
