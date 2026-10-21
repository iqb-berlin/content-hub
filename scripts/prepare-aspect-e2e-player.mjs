import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

// Pin both version and bytes: acceptance tests must exercise a real release player.
const url =
  "https://github.com/iqb-berlin/verona-modules-aspect/releases/download/editor/3.0.1%2Bplayer/3.0.1/iqb-player-aspect-3.0.1.html";
const digest =
  "54ee0f792c105c933b1c811ded0ee54eefae8502fa690edb18f6dd0b71c803c2";
const directory = new URL("../frontend/tmp/", import.meta.url);
const destination = new URL("aspect-3.0.1.html", directory);
const matches = (bytes) =>
  createHash("sha256").update(bytes).digest("hex") === digest;
let cached;
try {
  cached = await readFile(destination);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!cached || !matches(cached)) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(`Aspect fixture download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes))
    throw new Error("Aspect fixture SHA-256 does not match the pinned release");
  await mkdir(directory, { recursive: true });
  const temporary = new URL("aspect-3.0.1.html.partial", directory);
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
}
console.log("Aspect 3.0.1 E2E player verified (SHA-256).");
