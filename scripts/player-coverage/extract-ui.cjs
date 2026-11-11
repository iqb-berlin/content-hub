// Source-root argument contains pinned checkouts named aspect-0 through aspect-3.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const src = path.resolve(process.argv[2], "aspect-3");
const out = path.resolve("test-fixtures/player-generations/authoring");
const baseline = fs.readFileSync(
  src +
    "/projects/editor/src/app/modules/properties-panel/properties-panel.baseline.ts",
  "utf8",
);
const entries = {};
for (const m of baseline.matchAll(/'([^']+)': `([\s\S]*?)`/g)) {
  if (!m[1].includes("multi-")) entries[m[1]] = m[2];
}
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|ts)$/.test(p) && !/(spec|baseline)\./.test(p))
      files.push(p);
  }
}
walk(src + "/projects/editor");
files.sort();
const controls = {};
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(
    /(?:property\s*:\s*['"]([\w]+)['"]|combinedProperties\.([\w]+)|(?:styles|player|positionProperties|dimensionProperties)\.([\w]+))/g,
  )) {
    const key = m[1] || m[2] || m[3];
    (controls[key] ??= []).push({
      file: file.slice(src.length + 1),
      line: text.slice(0, m.index).split("\n").length,
      sha256: crypto.createHash("sha256").update(text).digest("hex"),
    });
  }
}

const numericBounds = {};
for (const file of files.filter((f) => f.endsWith(".html"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/<input\b[\s\S]*?>/g)) {
    const tag = m[0];
    for (const match of tag.matchAll(
      /(?:property\s*:\s*['"](\w+)['"]|(?:combinedProperties|newPlayerConfig|newHotspot|player)\.(\w+))/g,
    )) {
      const name = match[1] || match[2];
      for (const bound of tag.matchAll(/\b(min|max)="(-?\d+(?:\.\d+)?)"/g)) {
        const entry = (numericBounds[name] ??= {});
        const n = Number(bound[2]);
        entry[bound[1]] = (bound[1] === "min" ? Math.max : Math.min)(
          entry[bound[1]] ?? n,
          n,
        );
      }
    }
  }
}
const record = {
  source: "https://github.com/iqb-berlin/verona-modules-aspect",
  ref: "editor/3.1.0+player/3.1.0",
  commit: "d4b122659f3eecc4ffb200be72eac7043f8573c5",
  scope:
    "Editor standard and expert panels, including conditional controls and dialogs. Multi-selection, undo/copy/delete are authoring actions, not extra player element types.",
  panelBaseline: entries,
  controls,
  numericBounds,
};
fs.writeFileSync(
  out + "/ui-controls.json",
  JSON.stringify(record, null, 2) + "\n",
);
console.log(
  Object.keys(entries).length,
  "panels",
  Object.keys(controls).length,
  "UI property names",
);
