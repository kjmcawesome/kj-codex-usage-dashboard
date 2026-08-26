import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { exportStaticSite } from "./export-static-site.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distRoot = join(repoRoot, "dist");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8"
};

async function collectAssets(directory, assets = {}) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "server") {
        await collectAssets(filePath, assets);
      }
      continue;
    }

    const route = `/${relative(distRoot, filePath).split(sep).join("/")}`;
    const content = await readFile(filePath);
    assets[route] = {
      body: gzipSync(content, { level: 9 }).toString("base64"),
      content_type: CONTENT_TYPES[extname(filePath)] || "application/octet-stream"
    };
  }

  return assets;
}

function buildWorkerSource(assets) {
  return `const ASSETS = ${JSON.stringify(assets)};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname.endsWith("/")) {
      pathname += "index.html";
    }

    const asset = ASSETS[pathname] || (!pathname.includes(".") ? ASSETS["/index.html"] : null);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const compressed = decodeBase64(asset.body);
    const body = new Response(compressed).body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": asset.content_type,
        "cache-control": pathname.includes("/data/") ? "no-store, max-age=0" : "public, max-age=120"
      }
    });
  }
};
`;
}

export async function buildSitesDeployment() {
  const result = await exportStaticSite();
  const assets = await collectAssets(distRoot);
  const workerDirectory = join(distRoot, "server");
  await mkdir(workerDirectory, { recursive: true });
  await writeFile(join(workerDirectory, "index.js"), buildWorkerSource(assets), "utf8");

  return {
    ...result,
    asset_count: Object.keys(assets).length
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildSitesDeployment();
  console.log(`Prepared Sites deployment with ${result.asset_count} assets`);
  console.log(`Snapshot: ${result.generated_at}`);
  console.log(`Sessions: ${result.session_count}`);
}
