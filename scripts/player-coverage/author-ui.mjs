/** Recreate synthetic tasks by operating the unmodified ASPECT 3.1 editor UI. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createModuleTestbed, loadModule } from "./module-testbed.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "frontend/package.json"));
const { chromium } = require("playwright");
const directory = resolve(root, "test-fixtures/player-generations");
const read = (file) =>
  JSON.parse(readFileSync(resolve(directory, file), "utf8"));
const baseline = read("authoring/aspect-3.json").base;
// The marking wizard needs an actual stimulus to reference.
baseline.pages[0].sections[0].elements = [
  {
    ...read("authoring/aspect-3.json").types.text.defaults,
    id: "stimulus",
    alias: "STIMULUS",
    text: "<p>Am See teilen wir Wasser und Äpfel. Markiere die Lebensmittel.</p>",
  },
];
const recipes = [];
const add = (wizard, id, options = {}) => recipes.push({ wizard, id, options });
for (const numbering of [0, 1, 2, 3])
  add("Antwortfeld(er)", `input-numbering-${numbering}`, { numbering });
for (const length of [0, 1, 2, 3])
  add("Antwortfeld(er)", `input-length-${length}`, { length });
add("Antwortfeld(er)", "input-multiline", { multiline: true });
add("Antwortfeld(er)", "input-math", { math: true });
add("Antwortfeld(er)", "input-subquestions", { subquestions: true });
add("Antwortfeld(er)", "input-one", { count: 1 });
add("Antwortfeld(er)", "input-nine", { count: 9 });
for (const variant of ["Text", "Bilder"])
  for (const extra of ["none", "text", "math"])
    add("MC", `mc-${variant === "Text" ? "text" : "image"}-${extra}`, {
      variant,
      extra,
    });
for (const imagePosition of [0, 1, 2, 3])
  add("MC", `mc-image-position-${imagePosition}`, {
    variant: "Bilder",
    extra: "none",
    imagePosition,
  });
add("CMC", "cmc-text");
add("CMC", "cmc-images", { images: true });
add("Kontrollkästchen", "checkbox-text");
add("Kontrollkästchen", "checkbox-images", { images: true });
for (const variant of [
  "Text",
  "E-Mail",
  "Mobiltelefon",
  "Instruktion und Hörtext in einem Audio",
  "Instruktion und Hörtext getrennt",
]) {
  const count = [
    "E-Mail",
    "Mobiltelefon",
    "Instruktion und Hörtext getrennt",
  ].includes(variant)
    ? 3
    : 2;
  for (let choice = 0; choice < count; choice++)
    add(
      "Stimulus",
      `stimulus-${["Text", "E-Mail", "Mobiltelefon", "Instruktion und Hörtext in einem Audio", "Instruktion und Hörtext getrennt"].indexOf(variant)}-${choice}`,
      { variant, choice },
    );
}
for (const variant of ["Zuordnung", "Zuordnung (2-seitig)", "Sortieren"]) {
  const count = variant === "Zuordnung" ? 5 : variant === "Sortieren" ? 4 : 7;
  for (let choice = 0; choice < count; choice++)
    add(
      "Drag & Drop",
      `drag-${["Zuordnung", "Zuordnung (2-seitig)", "Sortieren"].indexOf(variant)}-${choice}`,
      { variant, choice },
    );
}
for (const mode of [0, 1])
  for (const helper of [false, true])
    add("Markieren", `mark-${mode}-${helper}`, { mode, helper });
for (const operation of [0, 1, 2])
  add("Rechenkästchen", `math-table-${operation}`, { operation });
for (const helper of [false, true])
  add("GeoGebra", `geometry-${helper}`, { helper });
add("Aufgabenidee", "idea");
const image = JSON.parse(
  readFileSync(
    resolve(root, "test-fixtures/synthetic-players/aspect-image.json"),
  ),
).definition.pages[0].sections[0].elements.find((e) => e.type === "image").src;
const imageFile = {
  name: "ausflug.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(image.split(",")[1], "base64"),
};
const results = [];
const errors = [];
const host = await createModuleTestbed(directory);
const browser = await chromium.launch();
const selected = process.argv.slice(2);
try {
  for (const recipe of recipes.filter(
    (r) => !selected.length || selected.some((s) => r.id.startsWith(s)),
  )) {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    page.setDefaultTimeout(15_000);
    const actions = [];
    try {
      const frame = await loadModule(
        page,
        host.url,
        "players/aspect-editor-3.1.0.html",
        baseline,
        true,
      );
      await frame
        .locator("aspect-ui-element-toolbox")
        .getByRole("tab")
        .nth(1)
        .click();
      await frame
        .locator("aspect-ui-element-toolbox")
        .getByRole("button", { name: recipe.wizard, exact: true })
        .click();
      const dialog = frame.getByRole("dialog").last();
      const o = recipe.options;
      const choose = async (index, value) => {
        await dialog.getByRole("combobox").nth(index).click();
        const options = frame.getByRole("option");
        value = Math.min(value, (await options.count()) - 1);
        const option = options.nth(value);
        actions.push({
          control: "select",
          index,
          value,
          label: await option.innerText(),
        });
        await option.click();
      };
      const check = async (index, value) => {
        const input = dialog.getByRole("checkbox").nth(index);
        actions.push({ control: "checkbox", index, value });
        await input.setChecked(value);
      };
      const radio = async (index) => {
        const input = dialog.getByRole("radio").nth(index);
        actions.push({
          control: "radio",
          index,
          label: await input
            .innerText()
            .catch(() => input.getAttribute("value")),
        });
        await input.check();
      };
      const texts = async () => {
        for (const input of await dialog
          .locator("[contenteditable=true]:visible")
          .all()) {
          if (await input.isEditable())
            await input.fill(
              "Ausflug an den See: Wasser, Brot und Äpfel. Dies sind synthetische Testdaten.",
            );
        }
      };
      const append = async (panel, values) => {
        const input = panel.locator("textarea").first();
        for (const value of values) {
          await input.fill(value);
          await input.press("Enter");
        }
      };
      const upload = async (button, file) => {
        const chooser = page.waitForEvent("filechooser");
        await button.click();
        await (await chooser).setFiles(file);
      };
      const imageOption = async (panel) => {
        await panel
          .locator("button")
          .filter({ hasText: /^image$/ })
          .click();
        const label = frame.getByRole("dialog").last();
        await label
          .locator("[contenteditable=true]")
          .fill("Synthetischer Kreis und Quadrat");
        await upload(
          label.getByRole("button", { name: "Bild laden", exact: true }),
          imageFile,
        );
        await label.getByRole("combobox").click();
        await frame
          .getByRole("option")
          .nth(o.imagePosition ?? 0)
          .click();
        await label
          .getByRole("button", { name: "Speichern", exact: true })
          .click();
      };
      await texts();
      if (recipe.wizard === "Antwortfeld(er)") {
        const count = dialog.locator("input[type=number]").first();
        await count.fill(String(o.count ?? 3));
        await count.press("Tab");
        if (o.numbering !== undefined) await choose(0, o.numbering);
        if (o.length !== undefined) await choose(1, o.length);
        if (o.multiline) {
          await radio(1);
          await dialog.locator("input[type=number]").last().fill("120");
        }
        if (o.math) await check(1, true);
        if (o.subquestions) {
          await check(0, true);
          for (const [i, t] of (
            await dialog.locator("textarea").all()
          ).entries())
            await t.fill(`Was nehmen wir an Tag ${i + 1} mit?`);
        }
      } else if (recipe.wizard === "MC") {
        await dialog
          .getByRole("button", { name: o.variant, exact: true })
          .click();
        await texts();
        const panel = dialog.locator("aspect-option-list-panel");
        if (o.variant === "Bilder") {
          await imageOption(panel);
          await imageOption(panel);
          await dialog.locator("input[type=number]").fill("2");
        } else await append(panel, ["Wasser", "Brot", "Sand"]);
        if (o.extra !== "none") {
          await check(0, true);
          await texts();
          if (o.extra === "math") await check(1, true);
        }
      } else if (recipe.wizard === "CMC") {
        const panels = dialog.locator("aspect-option-list-panel");
        if (o.images) {
          await imageOption(panels.nth(0));
          await imageOption(panels.nth(1));
        } else {
          await append(panels.nth(0), ["trifft zu", "trifft nicht zu"]);
          await append(panels.nth(1), [
            "Wasser ist ein Getränk.",
            "Brot ist ein Getränk.",
          ]);
        }
      } else if (recipe.wizard === "Kontrollkästchen") {
        if (o.images) {
          await check(0, true);
          await dialog
            .locator("input[type=file]")
            .last()
            .setInputFiles(imageFile);
          await dialog
            .locator("input[type=file]")
            .last()
            .setInputFiles(imageFile);
        } else await append(dialog, ["Wasser mitnehmen", "Brot mitnehmen"]);
      } else if (recipe.wizard === "Stimulus") {
        await dialog
          .getByRole("button", { name: o.variant, exact: true })
          .click();
        await texts();
        if (o.variant === "Text") await check(0, o.choice === 1);
        else if (["E-Mail", "Mobiltelefon"].includes(o.variant))
          await radio(o.choice);
        else {
          for (const button of await dialog
            .locator("button")
            .filter({ hasText: /^upload_file$/ })
            .all()) {
            const media = JSON.parse(
              readFileSync(
                resolve(
                  root,
                  "test-fixtures/synthetic-players/aspect-audio.json",
                ),
              ),
            ).definition.pages[0].sections[0].elements.find(
              (e) => e.type === "audio",
            ).src;
            await upload(button, {
              name: "hoertext.wav",
              mimeType: "audio/wav",
              buffer: Buffer.from(media.split(",")[1], "base64"),
            });
          }
          for (const input of await dialog.locator("input[type=number]").all())
            await input.fill(String(o.choice + 1));
          if (o.variant.endsWith("getrennt")) await radio(o.choice);
        }
      } else if (recipe.wizard === "Drag & Drop") {
        await dialog
          .getByRole("button", { name: o.variant, exact: true })
          .click();
        await texts();
        if (o.variant === "Zuordnung (2-seitig)" && o.choice >= 2) {
          await check(0, true);
          await dialog
            .locator("input[type=file][id=button-image-upload]")
            .first()
            .setInputFiles(imageFile);
          await radio(o.choice === 2 ? 0 : 1);
          if (o.choice >= 5) {
            await check(1, true);
            await dialog
              .locator("input[type=file][id=button-image-upload]")
              .last()
              .setInputFiles(imageFile);
          }
        }
        for (const input of await dialog.locator("textarea").all()) {
          await input.fill("Wasser");
          await input.press("Enter");
          await input.fill("Brot");
          await input.press("Enter");
        }
        const selects = dialog.getByRole("combobox");
        for (let i = 0; i < (await selects.count()); i++)
          await choose(i, Math.min(o.choice, 3));
        if (o.variant === "Zuordnung" && o.choice === 4) await radio(1);
        if (o.variant === "Sortieren") await check(0, o.choice === 3);
        if (o.variant === "Zuordnung (2-seitig)" && o.choice < 2)
          await radio(o.choice);
        if (
          o.variant === "Zuordnung (2-seitig)" &&
          o.choice >= 3 &&
          o.choice < 5
        )
          await radio(o.choice === 3 ? 2 : 3);
      } else if (recipe.wizard === "Markieren") {
        await choose(0, 0);
        await radio(o.mode);
        await check(0, o.helper);
      } else if (recipe.wizard === "Rechenkästchen") {
        await choose(0, o.operation);
        const inputs = dialog.locator("input");
        await inputs.nth(0).fill("24");
        await inputs.nth(1).fill("12");
      } else if (recipe.wizard === "GeoGebra") {
        const definition = JSON.parse(
          readFileSync(
            resolve(
              root,
              "test-fixtures/synthetic-players/aspect-geometry.json",
            ),
          ),
        ).definition.pages[0].sections[0].elements.find(
          (e) => e.type === "geometry",
        ).appDefinition;
        await upload(dialog.locator("button").filter({ hasText: /^edit$/ }), {
          name: "dreieck.ggb",
          mimeType: "application/vnd.geogebra.file",
          buffer: Buffer.from(definition, "base64"),
        });
        await check(0, o.helper);
      }
      await page.evaluate(() => {
        window.moduleMessages = window.moduleMessages.filter(
          (m) => m.type !== "voeDefinitionChangedNotification",
        );
      });
      await dialog
        .getByRole("button", { name: "Bestätigen", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          window.moduleMessages.some(
            (m) => m.type === "voeDefinitionChangedNotification",
          ),
        undefined,
        { timeout: 15000 },
      );
      const accepted = await page.evaluate(() =>
        JSON.parse(
          window.moduleMessages
            .filter((m) => m.type === "voeDefinitionChangedNotification")
            .at(-1).unitDefinition,
        ),
      );
      if (
        accepted.pages.reduce(
          (n, p) => n + p.sections.flatMap((s) => s.elements).length,
          0,
        ) < 2
      )
        throw Error("Wizard did not create any elements");
      results.push({ ...recipe, actions, definition: accepted });
      console.log("CREATED", recipe.id, accepted.pages.length);
    } catch (error) {
      errors.push({ id: recipe.id, message: String(error) });
      console.log("FAILED", recipe.id, String(error));
      await page.screenshot({
        path: `/tmp/content-hub-wizard-${recipe.id}.png`,
      });
      writeFileSync(
        `/tmp/content-hub-wizard-${recipe.id}.txt`,
        await page
          .frameLocator("iframe")
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await host.close();
}
const file = resolve(directory, "authoring/ui-created-tasks.json");
const previous = selected.length
  ? read("authoring/ui-created-tasks.json").tasks.filter(
      (t) => !selected.some((s) => t.id.startsWith(s)),
    )
  : [];
writeFileSync(
  file,
  JSON.stringify(
    {
      editor: "ASPECT 3.1.0",
      method:
        "Created via real assistant dialogs in the original, unmodified release editor; text/media filled through UI controls and accepted with Bestätigen.",
      tasks: [...previous, ...results],
      errors,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ created: results.length, errors }));
if (errors.length) process.exitCode = 1;
