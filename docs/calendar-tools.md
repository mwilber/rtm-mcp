# Calendar helpers

These read-only tools resolve calendar references before creating or updating RTM
tasks. They are available over both HTTP and stdio and do not require RTM
credentials. Holiday-dependent calculations additionally require Calendarific.

## Configuration

```dotenv
CALENDAR_TIME_ZONE=America/New_York
CALENDARIFIC_API_KEY=your-key
CALENDARIFIC_ENABLED=true
```

The timezone defaults to `UTC` when unconfigured. Set it to the timezone used by
your RTM account. Each helper accepts an optional IANA `timeZone` and ISO
`referenceDate`; otherwise it uses today in the configured timezone. Calculations
use Gregorian civil dates, so daylight saving transitions cannot shift the result
by a day. Times of day and recurring schedules are outside these helpers' scope;
continue using the existing task tools' `repeats` parameter for recurrence.

Calendarific documentation: https://calendarific.com/api-documentation

## `rtm-get-date-context`

Optional inputs: `timeZone`, `referenceDate`.

Returns `today`, `referenceDate`, current `localTime`, `timeZone`, the reference
date's `weekday`, and inclusive `periods` for its week, month, quarter, and year.
The current local time always describes now, even when a reference date is supplied.
Weeks start Monday, weekends are Saturday–Sunday, and quarters are calendar quarters.

## `rtm-list-holidays`

Optional inputs:

- `year`: 2000–2100; defaults to the reference date's year.
- `search`: case-insensitive substring of holiday name, aliases, or server ID.
- `categories`: any of `federal`, `national`, `religious`, `observance`.
- `timeZone`, `referenceDate`.

Looks up Calendarific's US dataset and filters it to nationwide records. The
response includes `holidays`, `total`, `year`, coverage, retrieval timestamp,
cache freshness, and warnings. An empty search result does not prove an event
does not exist. State, employer, school, stock market, and personal calendars
are not included.

Each holiday has a server-owned `id` (for example `us-christmas-day`), English
`name`, `aliases`, `holidayYear`, `category`, `actualDate`, `observedDate`, and
`source`. Unknown dates are `null`, never substituted silently. Non-federal
observances do not automatically receive an observed day off. Standard nationwide
federal substitute days are derived from the actual date when the provider omits
them: Saturday → Friday, Sunday → Monday, otherwise the actual date.

The dataset is selected by calendar year. A December 31 observed New Year's Day
can have the following `holidayYear`; these are separate occurrences with the
same holiday ID, rather than being merged into January's occurrence.
Other observances may also occur more than once in a Gregorian year. They retain
separate records with the same ID. An explicit-year resolution with multiple
matching dates returns `HOLIDAY_AMBIGUOUS` and its candidate dates; `occurrence:
"next"` selects the first matching date on or after the reference date.

Example input:

```json
{ "year": 2027, "search": "Christmas" }
```

Example holiday:

```json
{
  "id": "us-christmas-day",
  "name": "Christmas Day",
  "aliases": ["Christmas Day", "Christmas"],
  "holidayYear": 2027,
  "category": "federal",
  "actualDate": "2027-12-25",
  "observedDate": "2027-12-24",
  "source": "https://calendarific.com/api/v2/holidays"
}
```

## `rtm-resolve-date`

Supply an `anchor` and optional `steps` (at most ten), plus optional `timeZone`
and `referenceDate`. Tool schemas reject missing discriminators, invalid enums,
unknown fields, excessive offsets, impossible dates, and ambiguous combinations.

Anchors:

| `kind` | Other fields | Meaning |
| --- | --- | --- |
| `today` | None | Reference date |
| `date` | `date` | Exact `YYYY-MM-DD` |
| `range` | `start`, `end` | Explicit inclusive range of at most 366 days |
| `period` | `unit`, optional `offset` | Reference week, month, quarter, or year, shifted by whole periods |
| `holiday` | `holidayId`, `year`, `dateType` | A known holiday year's `actual` or `observed` date |
| `holiday` | `holidayId`, `occurrence: "next"`, `dateType` | Next occurrence on or after the reference date, looking in this and the next holiday year |
| `uncertain` | `description` | Return `needsClarification`; do not calculate a guessed date |

Use the IDs returned by `rtm-list-holidays`. `year` and `occurrence` are mutually
exclusive. An unavailable date or exhausted lookup horizon returns an error.

Steps are applied in order:

| `operation` | Fields | Meaning |
| --- | --- | --- |
| `offset` | `unit: days/weeks`, integer `amount` | Shift an exact date (up to 3660 units in either direction) |
| `offset` | `unit: months/years`, integer `amount`, `overflow: constrain/reject` | Shift a date; explicitly choose handling for a nonexistent target day |
| `offset` | `unit: businessDays`, integer `amount`, `calendar` | Shift by up to 366 business days; excludes the anchor day |
| `weekday` | `weekday`, `direction: before/after`, boolean `inclusive` | Find a named weekday; `inclusive: false` means strictly before/after |
| `period` | `unit: week/month/quarter/year`, optional `offset` | Expand a date to its containing period, optionally shifted |
| `nthWeekday` | `weekday`, `ordinal: 1..5/last` | Select an occurrence inside a range; error if it does not exist |
| `weekend` | `ordinal: 1..5/last`, `membership: startsInPeriod/overlapsPeriod` | Select a Saturday–Sunday range |
| `boundary` | `edge: start/end` | Explicitly select a range endpoint |
| `businessDay` | `ordinal: first/last`, `calendar` | Select a business day within a range |

Weekday names are lowercase English names. Month/year offsets and period offsets
are limited to ±100. Business calendars must be explicit: `weekdays` excludes only
Saturday/Sunday; `us-federal` also excludes observed nationwide federal holidays.
Religious and cultural observances do not automatically close a business day.
Incomplete federal datasets cause an error instead of an inaccurate business date.
New Year's closures that cross a year boundary are included.

Date arithmetic requires an exact date. Select an endpoint with `boundary` before
applying it to a range. A weekend overlapping a period may extend outside it.
On Sunday, this week's weekend includes yesterday and today; next week's weekend
is the upcoming one. Choose that interpretation explicitly.

### First weekend of next month

```json
{
  "referenceDate": "2026-10-16",
  "anchor": { "kind": "period", "unit": "month", "offset": 1 },
  "steps": [
    { "operation": "weekend", "ordinal": 1, "membership": "startsInPeriod" }
  ]
}
```

Returns the inclusive range November 7–8, 2026. `overlapsPeriod` instead returns
October 31–November 1. To select Saturday explicitly, append
`{ "operation": "boundary", "edge": "start" }`.

### Friday before Christmas

```json
{
  "referenceDate": "2026-10-16",
  "anchor": {
    "kind": "holiday",
    "holidayId": "us-christmas-day",
    "occurrence": "next",
    "dateType": "actual"
  },
  "steps": [
    { "operation": "weekday", "weekday": "friday", "direction": "before", "inclusive": false }
  ]
}
```

Returns `date: "2026-12-18"`. Christmas itself is a Friday that year, so the
explicit strict relation matters.

### Last business day of next month

```json
{
  "anchor": { "kind": "period", "unit": "month", "offset": 1 },
  "steps": [
    { "operation": "businessDay", "ordinal": "last", "calendar": "us-federal" }
  ]
}
```

### Result handling for the calling LLM

- `status: resolved`, `kind: date`: pass `date` unchanged as the task's `dueDate`.
- `status: resolved`, `kind: range`: `start`/`end` are inclusive, with
  `requiresDateSelection: true`. Clarify the desired endpoint before creating a
  task; do not silently choose Saturday or Sunday.
- `status: needsClarification`: ask the user for a specific date or interpretation.
  This covers "early next month", "around Christmas", birthdays, payday, school
  breaks, fiscal quarters, and other personal/approximate references. If the user
  supplies an explicit range or date, use it as the anchor.
- `status: error`: MCP also sets `isError: true`. Obey the structured `error`
  instructions. Never create a task with a fabricated fallback date.
- Always communicate stale-data warnings and their retrieval date. Respect the
  nested provider error's retry guidance even when cached data resolves a date.

Resolved calculations include their interpretation in `explanation` and holiday
`sources` with retrieval dates and freshness. They perform no task writes.

## External-service failures and shutdowns

Each Calendarific request has an eight-second deadline, including body parsing.
There are **no automatic network retries**. Requests for the same year coalesce;
requests for different years are serialized and recheck the shared failure state.
The cache and failure circuit are shared across every MCP session in this process.

| Failure | Server behavior |
| --- | --- |
| Missing API key or explicitly disabled provider | No network call; operator action required |
| HTTP 401/402/403 or other non-retryable request rejection | Disable further lookups until operator intervention |
| HTTP 404/410 | `HOLIDAY_SERVICE_RETIRED`; disable further lookups until operator intervention |
| HTTP 429, including a quota error inside HTTP 200 | Block until the next UTC monthly reset, or a later `Retry-After` |
| DNS/TLS/network failure, timeout, 5xx, redirects, invalid JSON, empty/changed response data | `HOLIDAY_UNAVAILABLE`; block for 5, 20, 80, then 320 minutes after consecutive failures, respecting a longer `Retry-After` |
| Fifth consecutive failed lookup | `HOLIDAY_PROVIDER_SUSPENDED`; no further network requests until operator intervention |

Suspension also handles a permanently disappeared service that never sends an
explicit retirement response: DNS failures, a parked website, or a changed API
cannot cause an endless sequence of recovery requests. A successful live response
resets the failure count. No timer probes the provider: a later eligible tool call
is the only way to attempt recovery during a temporary cooldown.

An error result carries `code`, safe `message`, `provider`, `retryable`,
`doNotRetry`, `retryAfter`, and `nextAction`. `doNotRetry: true` means **do not
repeat requests in this turn, including changing the year or switching between
holiday listing, resolution, and business-day calculations**. For transient
failures, `retryable: true` permits only a future call after `retryAfter`.
Permanent failures have `retryable: false` and `retryAfter: null`.

Fresh results are cached for 24 hours. During an outage, previously retrieved
data no older than 30 days can be returned with `cache: stale` and a
`STALE_HOLIDAY_DATA` warning containing the provider error and retry guidance.
Uncached or older data fails explicitly. The provider's raw response bodies,
request URLs, and exception messages are never exposed, preventing API-key leaks.

Cache and circuit state are in memory and reset on process restart. For a
confirmed service shutdown, set `CALENDARIFIC_ENABLED=false` before restarting;
this prevents requests across subsequent restarts. To restore a suspended service,
the operator should investigate, repair credentials/integration or replace the
provider implementation, and restart. There is deliberately no LLM-facing reset
or retry-bypass tool. Ordinary calendar calculations and RTM tools remain usable.

## RTM creation validation

An omitted due date still defaults to `today`. Supplied parseable dates outside
today through two calendar years ahead now return `DUE_DATE_OUT_OF_RANGE` before
any RTM write, rather than silently creating a task due today. Impossible ISO
date-only values are also rejected. Validation uses `CALENDAR_TIME_ZONE`; exact
ISO dates are civil dates, not UTC instants. Natural-language dates that cannot
be parsed locally still go through RTM's existing parser.

Use the same timezone as the RTM account and the helper calculation. Helpers can
calculate dates outside the creation policy; receiving a helper result does not
bypass that policy. Existing update behavior is unchanged.

## Verification

Run `npm test`. Tests use fixed clocks, in-memory MCP clients, and mocked HTTP
responses; they do not contact Calendarific or mutate real RTM tasks. Coverage
includes leap dates, absent fifth weekdays, weekend membership, strict weekday
relations, federal business days, cross-year observed dates, cache/coalescing,
quota/reset behavior, service retirement, prolonged shutdown, and error redaction.
