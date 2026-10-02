#!/usr/bin/env node
/**
 * Assemble the deployable static site into dist/.
 *
 * The site has no bundler: dist/ is the source tree minus the things that
 * should not be published (.github, tools, node_modules, package files).
 * Keeping the paths identical means GitHub Pages needs no base-path rewriting.
 *
 *   node tools/build.mjs            build dist/
 *   node tools/build.mjs --serve    build, then serve dist/ on :4173
 */

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const INCLUDE_FILES = [
  ".nojekyll",
  "index.html",
  "demo.html",
  "laya_uiux_guide.html",
  "README.md",
  "LICENSE",
];

const INCLUDE_DIRS = ["assets"];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyIntoDist() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const file of INCLUDE_FILES) {
    const from = join(root, file);
    if (!(await exists(from))) {
      console.warn(`skip (missing): ${file}`);
      continue;
    }
    await cp(from, join(dist, file));
  }

  for (const dir of INCLUDE_DIRS) {
    const from = join(root, dir);
    if (!(await exists(from))) {
      console.warn(`skip (missing): ${dir}/`);
      continue;
    }
    await cp(from, join(dist, dir), { recursive: true });
  }

  const entries = await readdir(dist);
  return entries.sort();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serve(port) {
  createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let filePath = join(dist, normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));

    if (!(await exists(filePath)) || (await stat(filePath)).isDirectory()) {
      const candidate = join(filePath, "index.html");
      if (await exists(candidate)) filePath = candidate;
      else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404");
        return;
      }
    }

    if (!resolve(filePath).startsWith(resolve(dist))) {
      res.writeHead(403);
      res.end("403");
      return;
    }

    const { readFile } = await import("node:fs/promises");
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(filePath));
  }).listen(port, () => {
    console.log(`serving dist/ at http://localhost:${port}/`);
  });
}

const entries = await copyIntoDist();
console.log(`built dist/: ${entries.join(", ")}`);

if (process.argv.includes("--serve")) serve(4173);