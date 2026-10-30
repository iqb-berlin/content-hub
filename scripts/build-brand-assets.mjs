#!/usr/bin/env node
// Render the approved vector with the browser pinned by frontend/package-lock.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "frontend/package.json"));
const { chromium } = require("@playwright/test");
const check = process.argv.includes("--check");
const master = await readFile(
  resolve(root, "branding/content-hub/master.svg"),
  "utf8",
);
const svg = master.replace(
  /<title id="title">[^<]*<\/title>/,
  '<title id="title">Content Hub</title>',
);
const files = new Map();
const assetDir = "frontend/public/branding/content-hub-v1";
const themeDir = "keycloak/themes/iqb-theme/login/resources/img/content-hub-v1";
files.set(`${assetDir}/logo.svg`, Buffer.from(svg));
files.set(`${assetDir}/favicon.svg`, Buffer.from(svg));
files.set(`${themeDir}/logo.svg`, Buffer.from(svg));
files.set(`${themeDir}/favicon.svg`, Buffer.from(svg));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const images = new Map();
  for (const size of [16, 32, 48, 180, 192, 256, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:100%;height:100%;background:transparent}
      svg{display:block;width:100%;height:100%}
    </style>${svg}`);
    images.set(
      size,
      await page.screenshot({ type: "png", omitBackground: true }),
    );
    if (size === 180) {
      // Apple adds its own corner treatment; give it a fully opaque canvas.
      files.set(
        `${assetDir}/apple-touch-icon.png`,
        await page.screenshot({ type: "png" }),
      );
    }
  }
  files.set(`${assetDir}/logo.png`, images.get(512));
  files.set(`${assetDir}/favicon-16x16.png`, images.get(16));
  files.set(`${assetDir}/favicon-32x32.png`, images.get(32));
  files.set(`${assetDir}/android-chrome-192x192.png`, images.get(192));
  files.set(`${assetDir}/android-chrome-512x512.png`, images.get(512));
  files.set(`${themeDir}/favicon-32x32.png`, images.get(32));

  // ICO directory with four independently rendered, PNG-compressed frames.
  const sizes = [16, 32, 48, 256];
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images.get(size).length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images.get(size).length;
  });
  const ico = Buffer.concat([
    directory,
    ...sizes.map((size) => images.get(size)),
  ]);
  files.set(`${assetDir}/favicon.ico`, ico);
  files.set(`${themeDir}/favicon.ico`, ico);
  files.set("frontend/public/favicon.ico", ico);
} finally {
  await browser.close();
}

let outdated = false;
for (const [name, contents] of files) {
  const path = resolve(root, name);
  if (check) {
    const existing = await readFile(path).catch(() => null);
    if (!existing?.equals(contents)) {
      console.error(`Missing or outdated brand asset: ${name}`);
      outdated = true;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}
if (outdated) process.exitCode = 1;
else
  console.log(
    `${check ? "Verified" : "Generated"} ${files.size} Content Hub brand assets.`,
  );
