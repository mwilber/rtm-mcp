import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { HolidayProvider } from "../src/holiday-provider.js";
import { httpError, ok } from "./fixtures/holidays.js";

const connectClient = async (options) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(options);
  const client = new Client({ name: "rtm-mcp-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
};

afterEach(() => {
  delete process.env.RTM_API_KEY;
  delete process.env.RTM_SHARED_SECRET;
  delete process.env.RTM_AUTH_TOKEN;
  delete globalThis.fetch;
});

describe("RTM MCP tools", () => {
  it("publishes compatible update and note tool schemas", async () => {
    const { client, server } = await connectClient();
    try {
      const { tools } = await client.listTools();
      const addTool = tools.find((tool) => tool.name === "rtm-add-task");
      const updateTool = tools.find((tool) => tool.name === "rtm-update-task");
      const noteTool = tools.find((tool) => tool.name === "rtm-add-task-note");

      assert.ok(addTool);
      assert.ok(updateTool);
      assert.ok(noteTool);
      assert.equal("note" in addTool.inputSchema.properties, false);
      assert.deepEqual(updateTool.inputSchema.properties.id.required, [
        "list",
        "series",
        "task",
      ]);
      assert.deepEqual(updateTool.inputSchema.properties.priority.enum, [
        1,
        2,
        3,
        null,
      ]);
      assert.deepEqual(noteTool.inputSchema.required, ["id", "text"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("publishes and executes calendar tools over MCP without RTM credentials", async () => {
    const calendarProvider = new HolidayProvider({ apiKey: "test", fetchImpl: async () => ok() });
    const { client, server } = await connectClient({ calendarProvider, calendarNow: () => new Date("2026-10-16T12:00:00Z") });
    try {
      const { tools } = await client.listTools();
      for (const name of ["rtm-get-date-context", "rtm-list-holidays", "rtm-resolve-date"]) {
        assert.equal(tools.find((tool) => tool.name === name).annotations.readOnlyHint, true);
      }
      const context = await client.callTool({ name: "rtm-get-date-context", arguments: { timeZone: "UTC" } });
      assert.equal(context.structuredContent.today, "2026-10-16");
      const holidays = await client.callTool({ name: "rtm-list-holidays", arguments: { year: 2026, search: "Christmas" } });
      assert.equal(holidays.structuredContent.holidays[0].id, "us-christmas-day");
      const date = await client.callTool({ name: "rtm-resolve-date", arguments: {
        anchor: { kind: "holiday", holidayId: "us-christmas-day", year: 2026, dateType: "actual" },
        steps: [{ operation: "weekday", weekday: "friday", direction: "before", inclusive: false }],
      } });
      assert.equal(date.structuredContent.date, "2026-12-18");
      assert.deepEqual(JSON.parse(date.content[0].text), date.structuredContent);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns provider guidance as tool errors and shares the circuit across MCP sessions", async () => {
    let requests = 0;
    const calendarProvider = new HolidayProvider({ apiKey: "test", fetchImpl: async () => { requests++; return httpError(410); } });
    const first = await connectClient({ calendarProvider });
    const second = await connectClient({ calendarProvider });
    try {
      for (const { client } of [first, second]) {
        const result = await client.callTool({ name: "rtm-list-holidays", arguments: { year: 2026 } });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent.error.code, "HOLIDAY_SERVICE_RETIRED");
        assert.equal(result.structuredContent.error.doNotRetry, true);
        assert.equal(result.structuredContent.error.retryAfter, null);
      }
      assert.equal(requests, 1);
      const invalid = await second.client.callTool({ name: "rtm-resolve-date", arguments: { anchor: { kind: "date", date: "2026-02-30" } } });
      assert.equal(invalid.isError, true);
      assert.equal(invalid.structuredContent.error.code, "INVALID_DATE");
    } finally {
      await first.client.close();
      await first.server.close();
      await second.client.close();
      await second.server.close();
    }
  });

  it("reports rejected supplied due dates as tool errors without RTM writes", async () => {
    process.env.RTM_API_KEY = "test";
    process.env.RTM_SHARED_SECRET = "test";
    process.env.RTM_AUTH_TOKEN = "test";
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error("Unexpected RTM request"); };
    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "rtm-add-task", arguments: { name: "Example", dueDate: "1900-01-01" } });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.code, "DUE_DATE_OUT_OF_RANGE");
      assert.equal(requests, 0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
