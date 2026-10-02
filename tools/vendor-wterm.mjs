#!/usr/bin/env node
/**
 * Vendor @wterm/{core,dom} into assets/vendor/wterm so the sandbox runs with
 * no bundler and no CDN.
 *
 *   npm run vendor        refresh the vendored copies
 *   npm run vendor:check  fail if the vendored copies drift from the pin
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "assets/vendor/wterm");
const manifestPath = join(outDir, "manifest.json");
const check = process.argv.includes("--check");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const pinned = Object.fromEntries(
  Object.entries(pkg.dependencies ?? {}).map(([k, v]) => [k, v.replace(/^[\^~]/, "")]),
);

// Everything the sandbox loads at runtime, plus the upstream licenses.
const VENDORED_FILES = [
  "core/LICENSE",
  "core/index.js",
  "core/terminal-core.js",
  "core/transport.js",
  "core/wasm-bridge.js",
  "core/wasm-inline.js",
  "core/wasm-loading.js",
  "dom/debug.js",
  "dom/graphics-layer.js",
  "dom/history-selection.js",
  "dom/hyperlink.js",
  "dom/index.js",
  "dom/input-accessibility.js",
  "dom/input.js",
  "dom/LICENSE",
  "dom/kitty-keys.js",
  "dom/output-announcements.js",
  "dom/rectangle-drag.js",
  "dom/rectangle-selection.js",
  "dom/renderer.js",
  "dom/search.js",
  "dom/selection-range.js",
  "dom/selection.js",
  "dom/terminal.css",
  "dom/text-capture.js",
  "dom/tracked-selection.js",
  "dom/wterm.js",
];

const SOURCES = [
  { from: join(root, "node_modules/@wterm/core/dist"), to: join(outDir, "core"), keep: /\.js$/ },
  { from: join(root, "node_modules/@wterm/dom/dist"), to: join(outDir, "dom"), keep: /\.js$/ },
  { from: join(root, "node_modules/@wterm/dom/src"), to: join(outDir, "dom"), keep: /^terminal\.css$/ },
  // Apache-2.0 license text ships at the package root, so copy it by hand.
  { from: join(root, "node_modules/@wterm/core"), to: join(outDir, "core"), keep: /^LICENSE$/ },
  { from: join(root, "node_modules/@wterm/dom"), to: join(outDir, "dom"), keep: /^LICENSE$/ },
];

async function treeDigest() {
  const h = createHash("sha256");
  for (const name of VENDORED_FILES) {
    h.update(name);
    h.update(await readFile(join(outDir, name)));
  }
  return h.digest("hex");
}

async function ensureInstalled() {
  for (const [name, version] of Object.entries(pinned)) {
    const manifest = join(root, "node_modules", name, "package.json");
    try {
      const found = JSON.parse(await readFile(manifest, "utf8")).version;
      if (found !== version) {
        console.error(`${name} is ${found} but package.json pins ${version}. Run: npm install`);
        process.exit(1);
      }
    } catch {
      console.error(`${name}@${version} is not installed. Run: npm install`);
      process.exit(1);
    }
  }
}

await ensureInstalled();

if (!check) {
  await rm(outDir, { recursive: true, force: true });
  for (const src of SOURCES) {
    await mkdir(src.to, { recursive: true });
    const names = (await readdir(src.from)).filter((n) => src.keep.test(n));
    for (const n of names) {
      await writeFile(join(src.to, n), await readFile(join(src.from, n)));
    }
  }

  const manifest = {
    generatedBy: "tools/vendor-wterm.mjs",
    source: "https://github.com/vercel-labs/wterm",
    versions: pinned,
    files: VENDORED_FILES,
    sha256: await treeDigest(),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`vendored ${VENDORED_FILES.length} files from wterm@${pinned["@wterm/dom"]}`);
  console.log(`manifest sha256: ${manifest.sha256.slice(0, 16)}`);
} else {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    console.error("vendor:check failed — manifest.json missing. Run: npm run vendor");
    process.exit(1);
  }

  const drift = Object.entries(pinned).filter(([n, v]) => manifest.versions?.[n] !== v);
  if (drift.length) {
    console.error(
      "vendor:check failed — pin drift: " +
        drift.map(([n, v]) => `${n} pinned=${v} vendored=${manifest.versions?.[n]}`).join(", "),
    );
    process.exit(1);
  }

  const missing = [];
  for (const name of manifest.files) {
    try {
      await stat(join(outDir, name));
    } catch {
      missing.push(name);
    }
  }
  if (missing.length) {
    console.error(`vendor:check failed — missing: ${missing.join(", ")}. Run: npm run vendor`);
    process.exit(1);
  }

  if ((await treeDigest()) !== manifest.sha256) {
    console.error("vendor:check failed — vendored files edited in place. Run: npm run vendor");
    process.exit(1);
  }

  console.log(`vendor:check ok — wterm@${manifest.versions["@wterm/dom"]}, ${manifest.files.length} files`);
}