/** Rebuild reviewable tasks from the pinned ASPECT editor-model snapshots. */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectedScenarios } from "./scenarios.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = resolve(root, "test-fixtures/player-generations");
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const clone = (value) => structuredClone(value);
const save = (file, value) =>
  writeFileSync(
    resolve(directory, file),
    `${JSON.stringify(value, null, 2)}\n`,
  );
const pool = json(resolve(directory, "catalogue.json"));
pool.acpId = "30000000-0000-4000-8000-000000000003";
pool.bookletId = "player-generations";
pool.units = [];
const contentPresets = json(
  resolve(directory, "authoring/content-presets.json"),
).elements;
const numericBounds =
  json(resolve(directory, "authoring/ui-controls.json")).numericBounds || {};
const coverage = [];
const exclusions = [];
const oldPool = json(
  resolve(root, "test-fixtures/synthetic-players/pool.json"),
);
function fixture(type) {
  const entry = oldPool.units.find(
    (unit) => unit.player === "aspect" && unit.formats.includes(type),
  );
  if (!entry) return null;
  const unit = json(
    resolve(root, "test-fixtures/synthetic-players", entry.file),
  );
  function find(value) {
    if (!value || typeof value !== "object") return null;
    if (value.type === type) return value;
    for (const child of Object.values(value)) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }
  return find(unit.definition);
}
function set(object, path, value) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = clone(value);
}
function flatten(schema, defaults, prefix = "") {
  const out = [];
  for (const [key, descriptor] of Object.entries(schema || {})) {
    const path = prefix + key;
    if (
      ["id", "alias", "type", "idService"].includes(key) ||
      !Object.hasOwn(defaults || {}, key)
    )
      continue;
    const current = defaults?.[key];
    if (
      descriptor.properties &&
      current &&
      !Array.isArray(current) &&
      typeof current === "object"
    ) {
      out.push(...flatten(descriptor.properties, current, path + "."));
    } else out.push({ path, ...descriptor, default: current });
  }
  return out;
}
function samples(property) {
  const { path, type, default: initial } = property;
  const name = path.split(".").at(-1);
  if (/[Ii][Dd]$|[Ii]ds$/.test(name)) return [initial ?? null];
  if (["imgSrc", "imageSrc"].includes(name))
    return [null, fixture("image").src];
  if (property.values?.length)
    return [...(type.includes("null") ? [null] : []), ...property.values];
  if (
    /^(boolean|null|undefined|[|\s])+$/.test(type) ||
    typeof initial === "boolean"
  )
    return [false, true];
  if (
    /^(number|null|undefined|[|\s])+$/.test(type) ||
    typeof initial === "number"
  ) {
    const values = /gridColumn$|gridRow$/.test(name)
      ? [1, 2]
      : /fontSize/.test(name)
        ? [16, 24]
        : /lineHeight/.test(name)
          ? [100, 150]
          : /Volume/.test(name)
            ? [0, 1]
            : /width/i.test(name)
              ? [180, 320]
              : /height/i.test(name)
                ? [60, 140]
                : /[Dd]elay|Time$/.test(name)
                  ? [0, 200]
                  : /max|Max/.test(name)
                    ? [10, 12]
                    : /min|Min/.test(name)
                      ? [0, 1]
                      : /Count|Range|Runs|Columns|Rows/.test(name)
                        ? [1, 2]
                        : [0, 2];
    return [
      ...(type.includes("null") ? [null] : []),
      ...values.map((value) =>
        Math.min(
          numericBounds[name]?.max ?? Infinity,
          Math.max(numericBounds[name]?.min ?? -Infinity, value),
        ),
      ),
    ];
  }
  if (
    ["gridColumnSizes", "gridRowSizes"].includes(name) &&
    Array.isArray(initial)
  )
    return [
      initial,
      [
        { value: 120, unit: "px" },
        { value: 1, unit: "fr" },
      ],
      [
        { value: 50, unit: "%" },
        { value: 50, unit: "%" },
      ],
    ];
  if (
    [
      "src",
      "imageSrc",
      "fileName",
      "url",
      "ggbBase64",
      "appDefinition",
      "base64",
      "document",
      "hotspots",
      "options",
      "rows",
      "elements",
      "value",
      "variables",
      "markingPanels",
      "visibilityRules",
      "actionParam",
    ].includes(name)
  )
    return [initial ?? null];
  if (
    type === "string" ||
    type === "string | null" ||
    typeof initial === "string"
  ) {
    if (/Color/.test(name)) return ["#166b8c", "#fff4d6"];
    if (name === "pattern") return [null, "^[A-Za-zÄÖÜäöüß ]+$"];
    if (name === "inputAssistanceCustomKeys") return ["", "ä ö ü ß + −"];
    if (name === "font") return ["Arial", "Roboto"];
    return [
      "",
      name === "text"
        ? "<p>Am See: <strong>Wasser</strong>, Brot und Äpfel.</p>"
        : "Synthetisch: Wasser, Brot und Äpfel",
    ];
  }
  return [initial ?? null];
}
function decorate(element, type, major) {
  const example =
    major === 3 && contentPresets[type] ? contentPresets[type] : fixture(type);
  if (example) {
    // Keep the generation's own fields; reuse only authored content/media.
    for (const key of [
      "text",
      "label",
      "src",
      "fileName",
      "options",
      "rows",
      "document",
      "hotspots",
      "ggbBase64",
      "appDefinition",
      "trackedVariables",
      "trackedExpectedVariables",
      "variables",
      "elements",
      "columnLabels",
      "rowLabels",
      "columnCount",
      "rowCount",
    ]) {
      if (key in element && key in example) element[key] = clone(example[key]);
    }
  }
  element.id = "input";
  if ("alias" in element) element.alias = "ANSWER";
  if (element.position) {
    element.position.gridColumn = 1;
    element.position.gridRow = 2;
  }
  if (element.type === "text-field-simple") element.value = "";
  if (type === "tetfolio")
    element.htmlContent = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Wasservorrat</title></head><body tetfoliopage="tf_fixture"><p>Plane den Wasservorrat: Stelle zwei Flaschen ein.</p><button type="button" onclick="addBottle()">Flasche hinzufügen</button><output id="bottles">0</output><script>
function addBottle(){var count=Number(sessionStorage.getItem('ibe_logger-fixture')||0)+1;document.getElementById('bottles').value=String(count);sessionStorage.setItem('ibe_logger-fixture',String(count));}
addEventListener('DOMContentLoaded',function(){document.getElementById('bottles').value=sessionStorage.getItem('ibe_logger-fixture')||'0';});
</script></body></html>`;
  return element;
}
function wrap(snapshot, element, title) {
  const definition = clone(snapshot.base);
  if (definition.veronaModuleVersion)
    definition.veronaModuleVersion = "iqb-aspect-module@0.0.1";
  const section = definition.pages[0].sections[0];
  section.height = 600;
  if (typeof section.gridColumnSizes === "string")
    section.gridColumnSizes = "1fr";
  if (definition.veronaModuleVersion) {
    element.xPosition = 20;
    element.yPosition = 40;
    element.width = 600;
  }
  const instruction = clone(snapshot.types.text.defaults);
  instruction.id = "instruction";
  if ("alias" in instruction) instruction.alias = "INSTRUCTION";
  instruction.text = `<p><strong>Ausflug an den See – ${title}</strong></p><p>Erprobe das Element. Alle Angaben sind künstliche Testdaten.</p>`;
  if (instruction.position) {
    instruction.position.gridRow = 1;
    instruction.position.gridColumn = 1;
  }

  if (definition.veronaModuleVersion) {
    instruction.xPosition = 20;
    instruction.yPosition = 0;
    instruction.width = 700;
    element.yPosition = 120;
  }
  section.elements = [element, instruction];
  if (element.type === "likert-row") {
    const parent = decorate(clone(snapshot.types.likert.defaults), "likert");
    parent.id = "scale";
    if ("alias" in parent) parent.alias = "SCALE";
    parent.rows = [element];
    section.elements = [parent, instruction];
  }
  return definition;
}
function addUnit(id, name, player, definition, extra = {}) {
  const file = `units/${id}.json`;
  save(file, { id, name, definition });
  pool.units.push({ id, name, file, player, ...extra });
}
for (const major of [0, 1, 2, 3]) {
  const snapshot = json(resolve(directory, `authoring/aspect-${major}.json`));
  for (const [type, model] of Object.entries(snapshot.types)) {
    const baseline = decorate(clone(model.defaults), type, major);
    const id = `aspect-m${major}-${type}`;
    const cases = [
      {
        id: "baseline",
        changes: {},
        definition: wrap(snapshot, baseline, `${type}: Grundaufgabe`),
      },
    ];
    for (const property of flatten(model.schema, baseline)) {
      const values = samples(property);
      const entry = {
        major,
        element: type,
        path: property.path,
        source: property.source,
        line: property.line,
        domain: property.values
          ? "enum"
          : property.type.includes("boolean")
            ? "boolean"
            : "samples",
        values,
        cases: [],
      };
      values.forEach((value, index) => {
        if (value === undefined) return;
        const element = clone(baseline);
        set(element, property.path, value);
        const caseId = `${property.path.replaceAll(".", "-")}-${index}`;
        const definition = wrap(
          snapshot,
          element,
          `${type}: ${property.path} = ${JSON.stringify(value)}`,
        );
        cases.push({
          id: caseId,
          changes: { [property.path]: value },
          definition,
        });
        entry.cases.push({ unit: id, case: caseId, page: cases.length - 1 });
      });
      coverage.push(entry);
    }
    // Every variant is an ordinary page of a usable multi-page ASPECT task.
    const definition = clone(cases[0].definition);
    definition.pages = cases.flatMap((item) => item.definition.pages);
    definition.pages.forEach((page, index) => {
      page.id = `variant-${index}`;
      let child = 0;
      const used = new Set();
      function ids(value) {
        if (!value || typeof value !== "object") return;
        if (value.type && value.id && !used.has(value)) {
          used.add(value);
          value.id = `p${index}_e${++child}`;
          if (value.alias !== undefined) value.alias = `P${index}_V${child}`;
        }
        for (const nested of Object.values(value)) ids(nested);
      }
      ids(page);
    });
    addUnit(
      id,
      `ASPECT ${major}: ${type} – Einstellungen`,
      `aspect-m${major}`,
      definition,
      {
        element: type,
        authoringCases: cases.map(({ id, changes }, index) => {
          const element = definition.pages[index].sections[0].elements[0];
          const target = type === "likert-row" ? element.rows[0] : element;
          return {
            id,
            changes: Object.fromEntries(
              Object.keys(changes).map((key) => [
                key,
                key.split(".").reduce((value, part) => value?.[part], target),
              ]),
            ),
          };
        }),
      },
    );
  }
}
for (const major of [0, 1, 2, 3]) {
  const snapshot = json(resolve(directory, `authoring/aspect-${major}.json`));
  for (const [scope, schema] of Object.entries(snapshot.contexts || {})) {
    const baseline =
      scope === "unit"
        ? snapshot.base
        : scope === "page"
          ? snapshot.base.pages[0]
          : snapshot.base.pages[0].sections[0];
    for (const property of flatten(schema, baseline).filter(
      (p) =>
        ![
          "pages",
          "sections",
          "elements",
          "id",
          "version",
          "type",
          "veronaModuleVersion",
        ].includes(p.path),
    )) {
      const values = samples(property);
      const entry = {
        major,
        scope,
        element: scope,
        path: property.path,
        source: property.source,
        line: property.line,
        domain: property.values
          ? "enum"
          : property.type.includes("boolean")
            ? "boolean"
            : "samples",
        values,
        cases: [],
      };
      values.forEach((value, index) => {
        const element = decorate(
          clone(snapshot.types["text-field"].defaults),
          "text-field",
        );
        const definition = wrap(snapshot, element, scope);
        const target =
          scope === "unit"
            ? definition
            : scope === "page"
              ? definition.pages[0]
              : definition.pages[0].sections[0];
        set(target, property.path, value);
        if (property.path === "alwaysVisible" && value === true)
          definition.pages.push(clone(snapshot.base.pages[0]));
        const id = `aspect-m${major}-${scope}-${property.path.replaceAll(".", "-")}-${index}`;
        addUnit(
          id,
          `ASPECT ${major}: ${scope}.${property.path} = ${JSON.stringify(value)}`,
          `aspect-m${major}`,
          definition,
          { context: scope },
        );
        entry.cases.push({ unit: id, case: "baseline", page: 0 });
      });
      coverage.push(entry);
    }
  }
}
for (const player of pool.players.filter((p) => p.family !== "aspect")) {
  const id = `${player.id}-inputs`;
  let definition;
  if (player.family === "abi") {
    definition =
      player.major === 1
        ? "title::Ausflug an den See\ntextbox::Was nimmst du mit?::0::ANSWER::::40##1"
        : player.major < 5
          ? "iqb-scripted::1.0\ntitle::Ausflug an den See\ninput-text::ANSWER::0::Was nimmst du mit?::::0::40\ncheckbox::WATER::0::Wasser mitnehmen\nmultiple-choice::DESTINATION::0::Ziel::Bahnhof##See##Schule"
          : "iqb-scripted::1.2\ntitle::Ausflug an den See\ninput-text::ANSWER::0::Was nimmst du mit?::::1\ncheckbox::WATER::0::Wasser mitnehmen\nmultiple-choice::DESTINATION::0::Ziel::1::Bahnhof##See##Schule";
  } else if (player.family === "simple") {
    definition =
      '<fieldset><legend>Ausflug an den See</legend><label>Was nimmst du mit? <input name="ANSWER" type="text"></label><label><input type="checkbox" name="WATER"> Wasser</label><select name="DESTINATION"><option>Bahnhof</option><option>See</option></select></fieldset>';
  } else if (player.family === "speed-multi") {
    definition =
      player.major < 3
        ? {
            type: "speedtest-unit-defintion",
            version: "1.0.0",
            layout: "column",
            questions: [
              { text: "Wasser ist nass.", answers: ["Richtig", "Falsch"] },
            ],
          }
        : {
            type: "speedtest-unit-defintion",
            version: player.major === 2 ? "2.0.0" : "2.1.0",
            layout: "column",
            questionType: "text",
            answerType: "text",
            questions: [
              {
                text: "Wasser ist nass.",
                answers: [{ text: "Richtig" }, { text: "Falsch" }],
                correctAnswer: 0,
              },
            ],
          };
  } else {
    const old = oldPool.units.find(
      (unit) =>
        unit.player === player.family ||
        (player.family === "ib" && unit.player === "ib"),
    );
    definition = json(
      resolve(root, "test-fixtures/synthetic-players", old.file),
    ).definition;
  }
  if (player.family === "abi" && player.major >= 2) {
    definition = json(
      resolve(root, "test-fixtures/synthetic-players/abi-inputs.json"),
    ).definition;
    if (player.major < 5)
      definition = definition
        .replace("iqb-scripted::1.2", "iqb-scripted::1.0")
        .replaceAll("::1::Bahnhof##See##Schule", "::Bahnhof##See##Schule")
        .replaceAll("::1::Bus##Fahrrad", "::Bus##Fahrrad")
        .replace("likert-start::0::1::", "likert-start::");
    if (player.major === 3)
      definition = definition
        .replace("checkboxes-start::Proviant\n", "")
        .replace("checkboxes-end\n", "");
    const dynamic = json(
      resolve(root, "test-fixtures/synthetic-players/abi-dynamic.json"),
    ).definition.replace(
      "iqb-scripted::1.2",
      player.major < 5 ? "iqb-scripted::1.0" : "iqb-scripted::1.2",
    );
    addUnit(
      player.id + "-dynamic",
      `${player.family} ${player.version}: bedingte und wiederholte Fragen`,
      player.id,
      dynamic,
      { formats: ["if", "repeat", "navigation"] },
    );
  }
  if (player.family === "abi" && player.major === 1)
    definition = [
      "titel::Ausflug an den See",
      "header::Synthetische Eingaben",
      "textbox::Was nimmst du mit?::0::ANSWER::::40##1",
      "textbox::Begründung::0::LONG::::120##3",
      "checkbox::Wasser mitnehmen::0::WATER",
      "multiplechoice::0::CHOICE##0::Bahnhof::See::Schule",
      "selectlist::Verkehrsmittel::0::LIST##1::Bus::Fahrrad",
      "multiselectlist::Proviant::0::MULTI##3::Brot::Wasser::Äpfel",
    ].join("\n");
  if (player.family === "simple")
    definition = json(
      resolve(root, "test-fixtures/synthetic-players/simple-html.json"),
    ).definition;
  if (player.family === "speed-multi" && player.major < 3) {
    const image = fixture("image").src;
    for (const layout of ["column", "row"])
      for (const stimulus of ["text", "image"]) {
        const content = {
          ...clone(definition),
          layout,
          buttonColor: "#166b8c",
          questions: [
            {
              ...(stimulus === "text"
                ? { text: "Wasser ist ein Getränk." }
                : { imgSrc: image }),
              answers: ["Richtig", "Falsch"],
              ...(player.major === 2 ? { correctAnswerIndex: 0 } : {}),
            },
          ],
        };
        addUnit(
          `${player.id}-${stimulus}-${layout}`,
          `Speedtest ${player.version}: ${stimulus}, ${layout}`,
          player.id,
          content,
          {
            formats: [
              `question:${stimulus}`,
              "answer:text",
              `layout:${layout}`,
            ],
          },
        );
      }
  }
  if (
    (player.family === "speed-multi" && player.major === 3) ||
    player.family === "speed-mono"
  ) {
    for (const old of oldPool.units.filter((u) => u.player === player.family))
      addUnit(
        `${player.id}-${old.id}`,
        `${player.family} ${player.version}: ${old.name}`,
        player.id,
        json(resolve(root, "test-fixtures/synthetic-players", old.file))
          .definition,
        { formats: old.formats },
      );
  }
  addUnit(
    id,
    `${player.family} ${player.version}: Ausflug an den See`,
    player.id,
    definition,
  );
}
for (const task of connectedScenarios(
  json(resolve(directory, "authoring/aspect-3.json")),
  {
    ...contentPresets,
    audio: fixture("audio"),
    image: fixture("image"),
    "hotspot-image": fixture("hotspot-image"),
  },
)) {
  const { id, name, definition, ...metadata } = task;
  addUnit(id, name, "aspect-m3", definition, { scenario: metadata });
}
const uiTasks = json(resolve(directory, "authoring/ui-created-tasks.json"));
if (uiTasks.errors.length) throw new Error("Unresolved UI authoring failures");
for (const task of uiTasks.tasks) {
  addUnit(
    "aspect-m3-ui-" + task.id,
    "ASPECT Assistent: " + task.wizard + " – " + task.id,
    "aspect-m3",
    task.definition,
    {
      uiAuthoring: {
        wizard: task.wizard,
        options: task.options,
        actions: task.actions,
      },
    },
  );
}
const used = new Set(pool.units.map((unit) => unit.file.split("/").at(-1)));
for (const file of readdirSync(resolve(directory, "units")))
  if (file.endsWith(".json") && !used.has(file))
    unlinkSync(resolve(directory, "units", file));
save("pool.json", pool);
save("authoring/coverage.json", {
  policy:
    "All finite enum values and both boolean states independently; representative values for unbounded fields. No claim of a cartesian product or browser verification is derived from generation.",
  coverage,
  exclusions,
});
console.log(
  JSON.stringify({
    players: pool.players.length,
    tasks: pool.units.length,
    settings: coverage.length,
    pages: pool.units.reduce(
      (sum, unit) => sum + (unit.authoringCases?.length || 1),
      0,
    ),
  }),
);

const rows = Object.keys(
  json(resolve(directory, "authoring/aspect-3.json")).types,
).map((type) => {
  const cells = [0, 1, 2, 3].map((major) => {
    const unit = pool.units.find(
      (unit) => unit.player === `aspect-m${major}` && unit.element === type,
    );
    return unit ? `[${unit.authoringCases.length} Seiten](${unit.file})` : "–";
  });
  return `| ${type} | ${cells.join(" | ")} |`;
});
writeFileSync(
  resolve(directory, "GENERATED-COVERAGE.md"),
  `# Erzeugte Aufgabenabdeckung\n\n${pool.players.length} Playergenerationen, ${pool.units.length} Aufgaben, ${coverage.length} Einstellungen mit konkreter Werte-/Seitenzuordnung.\n${uiTasks.tasks.length} Aufgaben stammen aus echten Assistentenexporten; ${pool.units.filter((unit) => unit.scenario).length} weitere Aufgaben verbinden referenzabhängige Einstellungen.\n\nDiese Tabelle dokumentiert Fixtures; Browserbestätigungen stehen separat im Galerie-Manifest.\n\n| Element | ASPECT 0 | ASPECT 1 | ASPECT 2 | ASPECT 3 |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nZusätzlich: Aufgaben-, Seiten- und Abschnittseinstellungen sowie generationsgerechte ABI-, Simple-, Speedtest- und ItemBuilder-Aufgaben. Details und Grenzen: [README](README.md).\n`,
);
