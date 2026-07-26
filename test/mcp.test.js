import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";

const connectClient = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
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
});
