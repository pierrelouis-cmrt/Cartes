#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, "assets");
const MANIFEST_PATH = path.join(ROOT, "asset-manifest.json");
const HTML_PATH = path.join(ROOT, "index.html");
const START_MARKER = "<!-- build:hashed-assets -->";
const END_MARKER = "<!-- endbuild -->";

const ASSET_SOURCES = [
  { id: "css", source: "styles.css", prefix: "styles", ext: "css" },
  { id: "js", source: "app.js", prefix: "app", ext: "js" },
];

const args = new Set(process.argv.slice(2));
const isCheckOnly = args.has("--check") || args.has("--verify");

function shortHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

function sriHash(buffer) {
  return `sha384-${createHash("sha384").update(buffer).digest("base64")}`;
}

function toPosixRelative(fileName) {
  return path.posix.join("assets", fileName);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function bufferEquals(a, b) {
  return a.byteLength === b.byteLength && Buffer.compare(a, b) === 0;
}

function renderBlock({ indent, css, js }) {
  const childIndent = `${indent}  `;
  const lines = [
    `${indent}${START_MARKER}`,
    `${indent}<!-- Managed by scripts/build-assets.mjs -->`,
    `${indent}<link rel="preload" as="style" href="${css.relPath}" crossorigin="anonymous" />`,
    `${indent}<link rel="stylesheet" href="${css.relPath}" integrity="${css.integrity}" crossorigin="anonymous" />`,
    `${indent}<noscript>`,
    `${childIndent}<link rel="stylesheet" href="${css.relPath}" integrity="${css.integrity}" crossorigin="anonymous" />`,
    `${indent}</noscript>`,
    `${indent}<script defer src="${js.relPath}" integrity="${js.integrity}" crossorigin="anonymous"></script>`,
    `${indent}${END_MARKER}`,
  ];
  return lines.join("\n");
}

function buildManifest(entries) {
  const css = entries.css;
  const js = entries.js;
  const buildId = createHash("sha1")
    .update(css.hash + js.hash)
    .digest("hex")
    .slice(0, 12);

  return {
    buildId,
    css: {
      source: css.source,
      file: css.relPath,
      hash: css.hash,
      integrity: css.integrity,
      bytes: css.size,
    },
    js: {
      source: js.source,
      file: js.relPath,
      hash: js.hash,
      integrity: js.integrity,
      bytes: js.size,
    },
  };
}

async function cleanOldArtifacts({ keepFile, prefix, ext }) {
  if (!(await fileExists(ASSETS_DIR))) {
    return;
  }

  const suffix = `.${ext}`;
  const entries = await fs.readdir(ASSETS_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .filter((entry) => entry.name.startsWith(`${prefix}-`))
      .filter((entry) => entry.name.endsWith(suffix))
      .filter((entry) => entry.name !== keepFile)
      .map((entry) => fs.unlink(path.join(ASSETS_DIR, entry.name)))
  );
}

async function processAssets() {
  const results = {};

  for (const asset of ASSET_SOURCES) {
    const absolute = path.join(ROOT, asset.source);
    const buffer = await fs.readFile(absolute);
    const hash = shortHash(buffer);
    const integrity = sriHash(buffer);
    const fileName = `${asset.prefix}-${hash}.${asset.ext}`;
    const relPath = toPosixRelative(fileName);

    results[asset.id] = {
      ...asset,
      absolute,
      buffer,
      hash,
      integrity,
      fileName,
      relPath,
      outputPath: path.join(ASSETS_DIR, fileName),
      size: buffer.byteLength,
    };
  }

  return results;
}

function computeIndent(html, startIndex) {
  const newlineIndex = html.lastIndexOf("\n", startIndex);
  if (newlineIndex === -1) {
    return { indent: "", blockStart: 0 };
  }
  return {
    indent: html.slice(newlineIndex + 1, startIndex),
    blockStart: newlineIndex + 1,
  };
}

async function prepareHtml(entries) {
  const html = await fs.readFile(HTML_PATH, "utf8");
  const startIndex = html.indexOf(START_MARKER);
  if (startIndex === -1) {
    throw new Error(`Cannot find ${START_MARKER} in index.html`);
  }
  const endIndex = html.indexOf(END_MARKER, startIndex);
  if (endIndex === -1) {
    throw new Error(`Cannot find ${END_MARKER} in index.html`);
  }
  const { indent, blockStart } = computeIndent(html, startIndex);
  const replacement = renderBlock({ indent, css: entries.css, js: entries.js });
  const afterIndex = endIndex + END_MARKER.length;
  const nextHtml = html.slice(0, blockStart) + replacement + html.slice(afterIndex);
  return { html, nextHtml };
}

async function writeFileIfChanged(filePath, nextContent) {
  const existing = (await fileExists(filePath)) ? await fs.readFile(filePath, "utf8") : null;
  if (existing === nextContent) {
    return false;
  }
  await fs.writeFile(filePath, nextContent);
  return true;
}

async function verifyBuild(entries) {
  const manifestExpected = buildManifest(entries);
  const manifestCurrent = await readJson(MANIFEST_PATH).catch(() => {
    throw new Error("asset-manifest.json is missing. Run npm run build:assets");
  });

  if (JSON.stringify(manifestExpected) !== JSON.stringify(manifestCurrent)) {
    throw new Error("asset-manifest.json is out of date. Run npm run build:assets");
  }

  const { html, nextHtml } = await prepareHtml(entries);
  if (html !== nextHtml) {
    throw new Error("index.html has stale hashed asset references. Run npm run build:assets");
  }

  for (const entry of Object.values(entries)) {
    const exists = await fileExists(entry.outputPath);
    if (!exists) {
      throw new Error(`${entry.outputPath} is missing. Run npm run build:assets`);
    }
    const onDisk = await fs.readFile(entry.outputPath);
    if (!bufferEquals(onDisk, entry.buffer)) {
      throw new Error(`${entry.outputPath} is outdated. Run npm run build:assets`);
    }
  }
}

async function runBuild(entries) {
  await ensureDir(ASSETS_DIR);

  for (const entry of Object.values(entries)) {
    await fs.writeFile(entry.outputPath, entry.buffer);
    await cleanOldArtifacts({ keepFile: entry.fileName, prefix: entry.prefix, ext: entry.ext });
    console.log(`✔ ${entry.id.toUpperCase()} → ${entry.relPath}`);
  }

  const manifest = buildManifest(entries);
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestChanged = await writeFileIfChanged(MANIFEST_PATH, manifestContent);
  if (manifestChanged) {
    console.log(`✔ Manifest → ${path.relative(ROOT, MANIFEST_PATH)}`);
  }

  const { nextHtml, html } = await prepareHtml(entries);
  if (html !== nextHtml) {
    await fs.writeFile(HTML_PATH, nextHtml);
    console.log(`✔ Updated hashed asset block in ${path.relative(ROOT, HTML_PATH)}`);
  } else {
    console.log("ℹ index.html already up to date");
  }
}

async function main() {
  const entries = await processAssets();
  if (isCheckOnly) {
    await verifyBuild(entries);
    console.log("✔ Hashed assets are up to date");
    return;
  }
  await runBuild(entries);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
