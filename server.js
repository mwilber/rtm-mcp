import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import cors from "cors";
import dotenv from "dotenv";
import { registerMcpRoutes, runMcpStdio } from "./src/mcp.js";

dotenv.config();

const HOST = process.env.HOST || (process.env.DYNO ? "0.0.0.0" : "127.0.0.1");
const app = createMcpExpressApp({ host: HOST });
const PORT = process.env.PORT || 3000;
const repoUrl = "https://github.com/mwilber/webmcptest";

app.use(
  cors({
    exposedHeaders: ["mcp-session-id"],
  })
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "rtm-mcp" });
});

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WebMCP Server</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        background: #f7f3ee;
        color: #1d1b18;
      }
      main {
        max-width: 720px;
        margin: 0 auto;
        padding: 72px 24px 64px;
      }
      h1 {
        font-size: 40px;
        margin: 0 0 12px;
        letter-spacing: -0.02em;
      }
      p {
        margin: 0 0 18px;
        font-size: 18px;
        line-height: 1.55;
      }
      a {
        color: #1446a0;
        text-decoration: none;
        border-bottom: 1px solid #1446a0;
      }
      a:hover {
        color: #0f2f6f;
        border-bottom-color: #0f2f6f;
      }
      .card {
        background: #fffaf3;
        border: 1px solid #e7ded3;
        border-radius: 16px;
        padding: 28px 32px;
        box-shadow: 0 12px 30px rgba(57, 41, 21, 0.1);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>WebMCP Server</h1>
        <p>
          This service exposes a Model Context Protocol server with HTTP and
          stdio transports, designed to plug into MCP-capable clients.
        </p>
        <p>
          Repo: <a href="${repoUrl}">${repoUrl}</a>
        </p>
      </div>
    </main>
  </body>
</html>`);
});

registerMcpRoutes(app);

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`MCP server running on ${HOST}:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

// If running with stdio flag
if (process.argv.includes("--stdio")) {
  runMcpStdio().catch(console.error);
}
