import { CalendarError, addDays, iso, parseDate } from "./calendar-date.js";

const DAY_MS = 86_400_000;
export const HOLIDAY_YEARS = { min: 2000, max: 2100 };
const FEDERAL_ALIASES = {
  "new-years-day": "new-years-day",
  "martin-luther-king-jr-day": "martin-luther-king-jr-day",
  "martin-luther-king-jr-s-birthday": "martin-luther-king-jr-day",
  "washingtons-birthday": "washingtons-birthday",
  "washington-s-birthday": "washingtons-birthday",
  "presidents-day": "washingtons-birthday",
  "presidents-day-washingtons-birthday": "washingtons-birthday",
  "memorial-day": "memorial-day",
  "juneteenth": "juneteenth-national-independence-day",
  "juneteenth-national-independence-day": "juneteenth-national-independence-day",
  "independence-day": "independence-day",
  "labor-day": "labor-day",
  "columbus-day": "columbus-day",
  "veterans-day": "veterans-day",
  "thanksgiving": "thanksgiving-day",
  "thanksgiving-day": "thanksgiving-day",
  "christmas-day": "christmas-day",
};
export const FEDERAL_IDS = [...new Set(Object.values(FEDERAL_ALIASES))].map((id) => `us-${id}`);
const slug = (name) => name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function validateHolidayYear(year) {
  if (!Number.isInteger(year) || year < HOLIDAY_YEARS.min || year > HOLIDAY_YEARS.max) {
    throw new CalendarError("UNSUPPORTED_YEAR", `Holiday lookups support ${HOLIDAY_YEARS.min}–${HOLIDAY_YEARS.max}.`);
  }
}

function normalizeHolidays(rows, year) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Empty holiday dataset");
  const records = new Map();
  for (const row of rows) {
    if (typeof row?.name !== "string" || !row.name.trim() || row.country?.id?.toLowerCase() !== "us" || !Array.isArray(row.type)) {
      throw new Error("Invalid holiday record");
    }
    const date = row.date?.iso?.slice(0, 10);
    parseDate(date);
    // Adjacent dates are allowed for substitute New Year's days.
    if (Math.abs(Number(date.slice(0, 4)) - year) > 1) throw new Error("Wrong holiday year");
    if (row.locations !== "All" && row.states !== "All") continue;
    const observed = /\b(observed|substitute)\b/i.test(row.name);
    const name = row.name.replace(/\s*\(?\b(observed|substitute)\b\)?/gi, "").trim();
    const nameSlug = slug(name);
    const federalId = FEDERAL_ALIASES[nameSlug];
    const id = `us-${federalId || nameSlug}`;
    const types = row.type.map((type) => String(type).toLowerCase()).join(" ");
    const isFederal = federalId && /national|federal|public/.test(`${types} ${String(row.primary_type).toLowerCase()}`) &&
      (federalId !== "juneteenth-national-independence-day" || Number(date.slice(0, 4)) >= 2021);
    const category = isFederal ? "federal" : /religious|christian|orthodox|muslim|hindu|buddhist|hebrew|jewish/.test(types)
      ? "religious" : /national|public|bank/.test(types) ? "national" : "observance";
    const holidayYear = Number(date.slice(0, 4)) + (observed && id === "us-new-years-day" && date.endsWith("12-31") ? 1 : 0);
    // Some religious/other observances occur twice in a Gregorian year. Preserve
    // those dates rather than rejecting the entire year's valid dataset. Without
    // a federal substitute rule, don't guess which actual date an observed row belongs to.
    const key = federalId ? `${id}:${holidayYear}` : `${id}:${holidayYear}:${observed ? "observed" : "actual"}:${date}`;
    const record = records.get(key) || { id, name, holidayYear, aliases: [], actualDate: null, observedDate: null, category };
    const field = observed ? "observedDate" : "actualDate";
    if (record[field] && record[field] !== date) throw new Error("Ambiguous holiday record");
    record[field] = date;
    record.aliases = [...new Set([...record.aliases, row.name, name.replace(/ Day$/, "")])];
    records.set(key, record);
  }
  if (!records.size) throw new Error("No nationwide holidays");
  for (const record of records.values()) {
    // Federal substitute rules are deterministic; don't invent observed dates for other observances.
    if (record.category === "federal" && record.actualDate && !record.observedDate) {
      const date = parseDate(record.actualDate);
      record.observedDate = iso(addDays(date, date.getUTCDay() === 6 ? -1 : date.getUTCDay() === 0 ? 1 : 0));
    }
    record.source = "https://calendarific.com/api/v2/holidays";
  }
  return [...records.values()].sort((a, b) => (a.actualDate || a.observedDate).localeCompare(b.actualDate || b.observedDate));
}

export class HolidayProvider {
  constructor({ apiKey = process.env.CALENDARIFIC_API_KEY, enabled = process.env.CALENDARIFIC_ENABLED !== "false",
    fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), timeoutMs = 8000,
    cacheTtlMs = DAY_MS, maxStaleMs = 30 * DAY_MS } = {}) {
    this.apiKey = apiKey;
    this.enabled = enabled;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.maxStaleMs = maxStaleMs;
    this.cache = new Map();
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.failureCount = 0;
    this.block = null;
  }

  #failure(code, message, { permanent = false, delayMs } = {}) {
    this.failureCount++;
    if (!permanent && code === "HOLIDAY_UNAVAILABLE" && this.failureCount >= 5) {
      permanent = true;
      code = "HOLIDAY_PROVIDER_SUSPENDED";
      message = "Calendarific failed five consecutive lookups and may have shut down or changed its API. Requests are suspended until operator intervention.";
    }
    const cooldown = Math.max(delayMs ?? 0, Math.min(DAY_MS, 300_000 * 4 ** Math.min(this.failureCount - 1, 5)));
    const error = new CalendarError(code, message, {
      provider: "Calendarific", retryable: !permanent, doNotRetry: true,
      retryAfter: permanent ? null : new Date(this.now() + cooldown).toISOString(),
      nextAction: permanent
        ? "Do not repeat holiday requests. Ask the server operator to fix configuration or replace the provider and restart the server. Calendar-only calculations still work."
        : "Do not retry this request in the current turn, including through other holiday tools or years. Retry only after retryAfter. Use calendar-only calculations or ask the user for the holiday date.",
    });
    this.block = { until: permanent ? Infinity : this.now() + cooldown, error };
    return error;
  }

  #configurationError() {
    if (this.enabled && this.apiKey) return null;
    return new CalendarError(this.enabled ? "HOLIDAY_NOT_CONFIGURED" : "HOLIDAY_DISABLED",
      this.enabled ? "Calendarific is not configured." : "Calendarific has been disabled by the server operator.", {
        provider: "Calendarific", retryable: false, doNotRetry: true, retryAfter: null,
        nextAction: "Do not repeat holiday requests. Ask the operator to configure CALENDARIFIC_API_KEY or enable CALENDARIFIC_ENABLED and restart. Calendar-only calculations still work.",
      });
  }

  async getYear(year) {
    validateHolidayYear(year);
    if (this.pending.has(year)) return this.pending.get(year);
    // Serialize different years too: one failed lookup blocks all queued lookups.
    const request = this.queue.then(() => this.#getYear(year));
    this.queue = request.catch(() => {});
    this.pending.set(year, request);
    try { return await request; }
    finally { this.pending.delete(year); }
  }

  #cached(entry, error) {
    return {
      holidays: entry.holidays, retrievedAt: new Date(entry.at).toISOString(),
      source: "Calendarific", cache: error ? "stale" : "fresh",
      warnings: error ? [{ code: "STALE_HOLIDAY_DATA", message: "Using previously retrieved holiday dates because the provider is unavailable.",
        providerError: { code: error.code, message: error.message, ...error.details } }] : [],
    };
  }

  async #getYear(year) {
    const entry = this.cache.get(year);
    const age = entry ? this.now() - entry.at : Infinity;
    if (entry && age < this.cacheTtlMs) return this.#cached(entry);
    try {
      const configurationError = this.#configurationError();
      if (configurationError) throw configurationError;
      if (this.block && this.now() < this.block.until) throw this.block.error;
      const controller = new AbortController();
      let timer;
      try {
        // Bound the entire request, including parsing, even if fetch ignores abort.
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Holiday request timed out"));
          }, this.timeoutMs);
        });
        const work = async () => {
          const url = new URL("https://calendarific.com/api/v2/holidays");
          url.search = new URLSearchParams({ api_key: this.apiKey, country: "US", year: String(year) });
          const response = await this.fetchImpl(url.toString(), { signal: controller.signal, redirect: "error" });
          if (controller.signal.aborted) throw new Error("Request aborted");
          if (!response.ok) throw this.#httpError(response.status, response.headers?.get("retry-after"));
          const data = await response.json();
          if (controller.signal.aborted) throw new Error("Request aborted");
          if (data?.meta?.code !== 200) {
            if (Number.isInteger(data?.meta?.code) && data.meta.code !== 200) throw this.#httpError(data.meta.code);
            throw new Error("Invalid holiday response");
          }
          return normalizeHolidays(data.response?.holidays, year);
        };
        const holidays = await Promise.race([work(), timeout]);
        const saved = { holidays, at: this.now() };
        this.cache.set(year, saved);
        this.failureCount = 0;
        this.block = null;
        return this.#cached(saved);
      } catch (error) {
        if (error instanceof CalendarError && error.details.provider === "Calendarific") throw error;
        // Never expose upstream bodies, URLs, or error messages: they may contain the key.
        throw this.#failure("HOLIDAY_UNAVAILABLE", "Calendarific could not be reached or returned unusable data. The service may be offline or discontinued.");
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (entry && age <= this.maxStaleMs) return this.#cached(entry, error);
      throw error;
    }
  }

  #httpError(status, retryAfter) {
    if ([401, 402, 403].includes(status)) return this.#failure("HOLIDAY_ACCESS_DENIED", "Calendarific credentials or subscription require operator attention.", { permanent: true });
    if ([404, 410].includes(status)) return this.#failure("HOLIDAY_SERVICE_RETIRED", "The Calendarific endpoint is missing or retired. Holiday lookups are disabled until operator intervention.", { permanent: true });
    const now = this.now();
    const headerTime = retryAfter && (/^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter));
    if (status === 429) {
      const date = new Date(now);
      const monthlyReset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      const until = Math.max(monthlyReset, Number.isFinite(headerTime) ? headerTime : 0);
      return this.#failure("HOLIDAY_QUOTA_EXCEEDED", "Calendarific request quota is exhausted. Requests are blocked until at least the next monthly reset.", { delayMs: until - now });
    }
    if (status >= 400 && status < 500 && status !== 408) return this.#failure("HOLIDAY_PROVIDER_REJECTED", "Calendarific rejected the server's request. The integration requires operator attention.", { permanent: true });
    return this.#failure("HOLIDAY_UNAVAILABLE", "Calendarific is temporarily unavailable or may have been discontinued.", {
      delayMs: Number.isFinite(headerTime) ? Math.max(0, headerTime - now) : undefined,
    });
  }
}
