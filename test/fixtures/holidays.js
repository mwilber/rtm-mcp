export const holiday = (name, date, extras = {}) => ({
  name, date: { iso: date }, country: { id: "us" }, type: ["National holiday"],
  locations: "All", states: "All", ...extras,
});

export const federal2026 = [
  ["New Year's Day", "2026-01-01"], ["Martin Luther King Jr. Day", "2026-01-19"],
  ["Presidents' Day", "2026-02-16"], ["Memorial Day", "2026-05-25"],
  ["Juneteenth", "2026-06-19"], ["Independence Day", "2026-07-04"],
  ["Labor Day", "2026-09-07"], ["Columbus Day", "2026-10-12"],
  ["Veterans Day", "2026-11-11"], ["Thanksgiving Day", "2026-11-26"],
  ["Christmas Day", "2026-12-25"],
].map(([name, date]) => holiday(name, date));

export const federal2027 = federal2026.map((row, index) => holiday(row.name, [
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-19", "2027-07-04",
  "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-25",
][index]));

export const ok = (rows = federal2026) => ({
  ok: true, status: 200, json: async () => ({ meta: { code: 200 }, response: { holidays: rows } }),
});
export const httpError = (status, retryAfter = null) => ({
  ok: false, status, headers: { get: () => retryAfter },
});
