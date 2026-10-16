import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HolidayProvider } from "../src/holiday-provider.js";
import { federal2026, holiday, httpError, ok } from "./fixtures/holidays.js";

const start = Date.parse("2026-10-16T12:00:00Z");
const makeProvider = (options = {}) => new HolidayProvider({ apiKey: "secret-key", now: () => start, ...options });

describe("Calendarific provider", () => {
  it("normalizes nationwide holidays, observances, aliases and substitute dates", async () => {
    const provider = makeProvider({ fetchImpl: async (url, options) => {
      assert.equal(new URL(url).searchParams.get("country"), "US");
      assert.equal(options.redirect, "error");
      return ok([...federal2026,
        holiday("Halloween", "2026-10-31", { type: ["Observance"] }),
        holiday("Mother's Day", "2026-05-10", { type: ["Observance"] }),
        holiday("Easter Sunday", "2026-04-05", { type: ["Christian"] }),
        holiday("State Day", "2026-01-03", { locations: "New York", states: [{ id: "us-ny" }] }),
        holiday("Independence Day observed", "2026-07-03"),
      ]);
    } });
    const data = await provider.getYear(2026);
    assert.equal(data.holidays.find((h) => h.id === "us-independence-day").observedDate, "2026-07-03");
    assert.equal(data.holidays.find((h) => h.id === "us-washingtons-birthday").category, "federal");
    assert.equal(data.holidays.find((h) => h.id === "us-halloween").category, "observance");
    assert.equal(data.holidays.find((h) => h.id === "us-easter-sunday").category, "religious");
    assert.ok(data.holidays.find((h) => h.id === "us-mothers-day").aliases.includes("Mother's"));
    assert.equal(data.holidays.some((h) => h.id === "us-state-day"), false);
    assert.equal(data.cache, "fresh");
  });

  it("keeps adjacent observed New Year's occurrences separate", async () => {
    const provider = makeProvider({ fetchImpl: async () => ok([
      holiday("New Year's Day", "2027-01-01"),
      holiday("New Year's Day observed", "2027-12-31"),
    ]) });
    const { holidays } = await provider.getYear(2027);
    assert.equal(holidays.length, 2);
    assert.equal(holidays.find((h) => h.holidayYear === 2028).actualDate, null);
    assert.equal(holidays.find((h) => h.holidayYear === 2028).observedDate, "2027-12-31");
  });

  it("caches successful lookups and coalesces concurrent requests", async () => {
    let requests = 0;
    const provider = makeProvider({ fetchImpl: async () => { requests++; return ok(); } });
    await Promise.all([provider.getYear(2026), provider.getYear(2026), provider.getYear(2026)]);
    await provider.getYear(2026);
    assert.equal(requests, 1);
  });

  for (const status of [401, 402, 403, 404, 410, 422]) {
    it(`blocks all years after HTTP ${status}, even far in the future`, async () => {
      let requests = 0;
      let now = start;
      const provider = makeProvider({ now: () => now, fetchImpl: async () => { requests++; return httpError(status); } });
      const results = await Promise.allSettled([provider.getYear(2026), provider.getYear(2027), provider.getYear(2028)]);
      for (const result of results) {
        assert.equal(result.status, "rejected");
        assert.equal(result.reason.details.retryable, false);
        assert.equal(result.reason.details.doNotRetry, true);
        assert.equal(result.reason.details.retryAfter, null);
      }
      now += 400 * 86_400_000;
      await assert.rejects(provider.getYear(2029));
      assert.equal(requests, 1);
      if ([404, 410].includes(status)) assert.equal(results[0].reason.code, "HOLIDAY_SERVICE_RETIRED");
    });
  }

  it("honors monthly quotas and longer Retry-After values", async () => {
    for (const header of [null, "60", "Mon, 02 Nov 2026 00:00:00 GMT"]) {
      let requests = 0;
      let now = start;
      const provider = makeProvider({ now: () => now, fetchImpl: async () => { requests++; return requests === 1 ? httpError(429, header) : ok(); } });
      let retryAfter;
      await assert.rejects(provider.getYear(2026), (error) => {
        assert.equal(error.code, "HOLIDAY_QUOTA_EXCEEDED");
        retryAfter = error.details.retryAfter;
        assert.ok(Date.parse(retryAfter) >= Date.parse("2026-11-01T00:00:00Z"));
        return true;
      });
      now += 300_000;
      await assert.rejects(provider.getYear(2027));
      assert.equal(requests, 1);
      now = Date.parse(retryAfter);
      await provider.getYear(2026);
      assert.equal(requests, 2);
    }
  });

  it("honors maintenance Retry-After without an early probe", async () => {
    let now = start;
    let requests = 0;
    const provider = makeProvider({ now: () => now, fetchImpl: async () => { requests++; return httpError(503, "3600"); } });
    await assert.rejects(provider.getYear(2026), (error) => {
      assert.equal(Date.parse(error.details.retryAfter), start + 3_600_000);
      return true;
    });
    now += 300_000;
    await assert.rejects(provider.getYear(2027));
    assert.equal(requests, 1);
  });

  for (const [name, fetchImpl] of [
    ["DNS failure / disappeared service", async () => { throw new Error("ENOTFOUND secret-key"); }],
    ["HTTP 503", async () => httpError(503)],
    ["invalid JSON / parked domain", async () => ({ ok: true, json: async () => { throw new Error("<html>secret-key</html>"); } })],
    ["empty data", async () => ok([])],
    ["invalid dates", async () => ok([holiday("Christmas Day", "2026-02-30")])],
    ["changed response shape", async () => ({ ok: true, json: async () => ({ response: {} }) })],
  ]) {
    it(`backs off for ${name} without leaking upstream data`, async () => {
      let now = start;
      let requests = 0;
      const provider = makeProvider({ now: () => now, fetchImpl: async (...args) => { requests++; return fetchImpl(...args); } });
      for (let attempt = 0; attempt < 5; attempt++) {
        const before = requests;
        await assert.rejects(provider.getYear(2026), (error) => {
          assert.equal(error.code, attempt === 4 ? "HOLIDAY_PROVIDER_SUSPENDED" : "HOLIDAY_UNAVAILABLE");
          assert.equal(error.message.includes("secret-key"), false);
          if (attempt < 4) assert.ok(Date.parse(error.details.retryAfter) - now >= 300_000 * 4 ** attempt);
          else {
            assert.equal(error.details.retryAfter, null);
            assert.equal(error.details.retryable, false);
          }
          assert.equal(error.details.doNotRetry, true);
          return true;
        });
        await assert.rejects(provider.getYear(2027));
        assert.equal(requests, before + 1);
        now = attempt === 4 ? now + 400 * 86_400_000 : provider.block.until;
      }
      await assert.rejects(provider.getYear(2030), { code: "HOLIDAY_PROVIDER_SUSPENDED" });
      assert.equal(requests, 5);
    });
  }

  it("bounds hung requests even if fetch ignores cancellation", async () => {
    let requests = 0;
    const provider = makeProvider({ timeoutMs: 10, fetchImpl: () => { requests++; return new Promise(() => {}); } });
    await assert.rejects(provider.getYear(2026), { code: "HOLIDAY_UNAVAILABLE" });
    await assert.rejects(provider.getYear(2027));
    assert.equal(requests, 1);
  });

  it("bounds a hung JSON body too", async () => {
    const provider = makeProvider({ timeoutMs: 10, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
    await assert.rejects(provider.getYear(2026), { code: "HOLIDAY_UNAVAILABLE" });
  });

  it("classifies failures embedded in HTTP 200 responses", async () => {
    const provider = makeProvider({ fetchImpl: async () => ({ ok: true, json: async () => ({ meta: { code: 429 } }) }) });
    await assert.rejects(provider.getYear(2026), { code: "HOLIDAY_QUOTA_EXCEEDED" });
  });

  it("uses bounded stale data with retry guidance, then fails after expiration", async () => {
    let now = start;
    let requests = 0;
    const provider = makeProvider({ now: () => now, fetchImpl: async () => { requests++; return requests === 1 ? ok() : httpError(410); } });
    await provider.getYear(2026);
    now += 2 * 86_400_000;
    const stale = await provider.getYear(2026);
    assert.equal(stale.cache, "stale");
    assert.equal(stale.retrievedAt, new Date(start).toISOString());
    assert.equal(stale.warnings[0].providerError.code, "HOLIDAY_SERVICE_RETIRED");
    await provider.getYear(2026);
    assert.equal(requests, 2);
    now += 30 * 86_400_000;
    await assert.rejects(provider.getYear(2026), { code: "HOLIDAY_SERVICE_RETIRED" });
    assert.equal(requests, 2);
  });

  it("resets backoff after recovery", async () => {
    let now = start;
    let requests = 0;
    const provider = makeProvider({ now: () => now, fetchImpl: async () => ++requests === 1 ? httpError(500) : ok() });
    await assert.rejects(provider.getYear(2026));
    now += 300_000;
    assert.equal((await provider.getYear(2026)).cache, "fresh");
    assert.equal(provider.block, null);
    assert.equal(provider.failureCount, 0);
  });

  it("does not request unsupported years, missing credentials, or disabled services", async () => {
    let requests = 0;
    const fetchImpl = async () => { requests++; return ok(); };
    await assert.rejects(makeProvider({ fetchImpl }).getYear(1999), { code: "UNSUPPORTED_YEAR" });
    await assert.rejects(makeProvider({ apiKey: "", fetchImpl }).getYear(2026), { code: "HOLIDAY_NOT_CONFIGURED" });
    await assert.rejects(makeProvider({ enabled: false, fetchImpl }).getYear(2026), { code: "HOLIDAY_DISABLED" });
    assert.equal(requests, 0);
  });
});
