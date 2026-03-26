import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { createUsageService } from "./lib/usage-data.js";

const port = Number(process.env.PORT || 3184);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

class BadRequestError extends Error {}

function sendBody(res, method, statusCode, body, headers = {}) {
  const responseHeaders = { ...headers };
  if (body != null) {
    responseHeaders["Content-Length"] = Buffer.byteLength(body);
  }
  res.writeHead(statusCode, responseHeaders);
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function sendJson(res, method, statusCode, payload) {
  const body = JSON.stringify(payload);
  sendBody(res, method, statusCode, body, {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function parseBooleanFlag(value, defaultValue = true) {
  if (value == null) {
    return defaultValue;
  }

  return value !== "0" && value !== "false";
}

function isValidDateParam(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function parseDashboardParams(url) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");

  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new BadRequestError("start_date and end_date must be provided together");
  }

  if (startDate || endDate) {
    if (!isValidDateParam(startDate) || !isValidDateParam(endDate)) {
      throw new BadRequestError("start_date and end_date must use YYYY-MM-DD");
    }

    if (startDate > endDate) {
      throw new BadRequestError("start_date must be on or before end_date");
    }
  }

  const daysParam = url.searchParams.get("days");
  const days = daysParam && daysParam.toLowerCase() === "all"
    ? "all"
    : Number(daysParam || 365);

  return {
    startDate,
    endDate,
    days: days === "all" || Number.isFinite(days) ? days : 365,
    workspace: url.searchParams.get("workspace") || "all",
    includeSubagents: parseBooleanFlag(url.searchParams.get("include_subagents"), true)
  };
}

async function serveStaticFile(req, res, staticRoot, requestPathname) {
  const requestPath = requestPathname === "/" ? "/index.html" : requestPathname || "/index.html";
  const normalizedPath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(staticRoot, normalizedPath);

  try {
    const content = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";
    sendBody(res, req.method, 200, content, { "Content-Type": contentType });
  } catch {
    sendJson(res, req.method, 404, { error: "Not found" });
  }
}

export function createAppServer({
  usageService = createUsageService(),
  staticRoot = join(process.cwd(), "public")
} = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const isReadMethod = req.method === "GET" || req.method === "HEAD";

      if (isReadMethod && url.pathname === "/api/dashboard") {
        sendJson(res, req.method, 200, await usageService.getDashboard(parseDashboardParams(url)));
        return;
      }

      if (isReadMethod && url.pathname.startsWith("/api/day/")) {
        const date = decodeURIComponent(url.pathname.slice("/api/day/".length));
        if (!isValidDateParam(date)) {
          throw new BadRequestError("day route must use YYYY-MM-DD");
        }
        sendJson(res, req.method, 200, await usageService.getDay(date, parseDashboardParams(url)));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh") {
        sendJson(res, req.method, 200, await usageService.refresh());
        return;
      }

      if (!isReadMethod) {
        sendJson(res, req.method, 405, { error: "Method not allowed" });
        return;
      }

      await serveStaticFile(req, res, staticRoot, url.pathname);
    } catch (error) {
      if (error instanceof BadRequestError) {
        sendJson(res, req.method || "GET", 400, {
          error: "Bad request",
          detail: error.message
        });
        return;
      }

      sendJson(res, req.method || "GET", 500, {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

export function startServer({
  usageService = createUsageService(),
  staticRoot = join(process.cwd(), "public"),
  portOverride = port
} = {}) {
  const server = createAppServer({ usageService, staticRoot });
  server.listen(portOverride, () => {
    console.log(`KJ Codex Usage Dashboard listening on http://localhost:${portOverride}`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
