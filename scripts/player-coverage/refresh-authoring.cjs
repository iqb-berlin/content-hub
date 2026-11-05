/** Download pinned editor source and rebuild its reviewable model/UI snapshots. */
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
if (!process.argv[2]) throw Error("Pass a disposable source cache directory");
const cache = path.resolve(process.argv[2]);
mkdirSync(cache, { recursive: true });
const refs = [
  "0.1.0",
  "editor/1.39.0+player/1.32.0",
  "editor/2.12.6+player/2.12.6",
  "editor/3.1.0+player/3.1.0",
];
for (const [major, ref] of refs.entries()) {
  const checkout = path.join(cache, `aspect-${major}`);
  if (!existsSync(checkout))
    execFileSync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        ref,
        "https://github.com/iqb-berlin/verona-modules-aspect.git",
        checkout,
      ],
      { stdio: "inherit" },
    );
  // Ref and source hashes remain in the resulting snapshots for review.
}
for (const script of [
  "build-models.cjs",
  "extract-authoring.cjs",
  "extract-ui.cjs",
])
  execFileSync(process.execPath, [path.join(__dirname, script), cache], {
    stdio: "inherit",
  });
