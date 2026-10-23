import { readFileSync } from "fs";
import { join } from "path";
import { buildReviewManifest } from "./review-manifest";
import { parseBookletXml } from "./booklet-parser";

const fixture = readFileSync(
  join(__dirname, "fixtures/review-booklet.xml"),
  "utf8",
);
const index = (
  booklets: any[] = [{ id: "review-1", definitionId: "review.xml" }],
) => ({
  assessmentParts: [
    {
      units: [
        { id: "intro", items: [] },
        { id: "task-1", items: [{ id: "i1" }] },
        { id: "task-2", items: [] },
      ],
      instruments: [{ testcenterBooklet: booklets }],
    },
  ],
});

describe("Review manifest / #59", () => {
  it("preserves nested blocks, document order, aliases and stable content identities", () => {
    const manifest = buildReviewManifest(
      index(),
      new Map([["review.xml", fixture]]),
    );
    expect(manifest.issues).toEqual([]);
    const booklet = manifest.booklets[0];
    expect(booklet.name).toBe("Review & Navigation");
    expect(booklet.units.map((unit) => unit.id)).toEqual([
      "intro",
      "task-1",
      "task-2",
      "task-1",
    ]);
    expect(booklet.units[2].blockPath).toEqual([
      "Mathematik",
      "Geometrie",
      "Erster Abschnitt",
    ]);
    expect(booklet.units[3].alias).toBe("repeat");
    expect(new Set(booklet.units.map((unit) => unit.occurrenceId)).size).toBe(
      4,
    );
    expect(manifest.units.filter((unit) => unit.id === "task-1")).toHaveLength(
      1,
    );
    expect(
      buildReviewManifest(index(), new Map([["review.xml", fixture]])),
    ).toEqual(manifest);
  });

  it("uses canonical task titles for repeated occurrences while retaining aliases separately", () => {
    const source = index();
    Object.assign(source.assessmentParts[0].units[1], {
      name: "Kanonischer Titel",
    });
    const manifest = buildReviewManifest(
      source,
      new Map([["review.xml", fixture]]),
    );
    const occurrences = manifest.booklets[0].units.filter(
      (unit) => unit.id === "task-1",
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((unit) => unit.name)).toEqual([
      "Kanonischer Titel",
      "Kanonischer Titel",
    ]);
    expect(occurrences[1].alias).toBe("repeat");
    expect(occurrences[0].occurrenceId).not.toBe(occurrences[1].occurrenceId);
  });

  it("supports multiple booklets and rejects conflicting or duplicate canonical IDs", () => {
    const second = fixture.replace("<Id>review-1</Id>", "<Id>review-2</Id>");
    const definitions = new Map([
      ["review.xml", fixture],
      ["second.xml", second],
    ]);
    const valid = buildReviewManifest(
      index([{ definitionId: "review.xml" }, { definitionId: "second.xml" }]),
      definitions,
    );
    expect(valid.booklets.map((booklet) => booklet.id)).toEqual([
      "review-1",
      "review-2",
    ]);
    expect(valid.issues).toEqual([]);
    const mismatch = buildReviewManifest(
      index([{ id: "other", definitionId: "review.xml" }]),
      definitions,
    );
    expect(mismatch.issues[0].message).toContain("widerspricht");
    const duplicate = buildReviewManifest(
      index([{ definitionId: "review.xml" }, { definitionId: "review.xml" }]),
      definitions,
    );
    expect(duplicate.issues[0].message).toContain("doppelt");
  });

  it("reports missing unit and module references with their source paths", () => {
    const broken = buildReviewManifest(
      index(),
      new Map([["review.xml", fixture.replace('id="task-2"', 'id="missing"')]]),
    );
    expect(broken.issues).toEqual([
      expect.objectContaining({
        severity: "error",
        path: expect.stringContaining("/Testlet[0]/Testlet[0]/Unit[0]"),
        message: "Unbekannte Unit: missing",
      }),
    ]);
    const missingModule = buildReviewManifest(
      index([{ id: "legacy", modules: ["missing"] }]),
      new Map(),
    );
    expect(missingModule.issues[0].path).toContain(".modules[0]");
    expect(missingModule.issues[0].message).toContain("Unbekanntes Modul");
  });

  it("preserves legacy modules, stable ordering and inputs", () => {
    const legacy = {
      assessmentParts: [
        {
          units: [{ id: "a" }, { id: "b" }],
          bookletModules: [
            {
              id: "m",
              units: [
                { id: "b", order: 2 },
                { id: "a", order: 1 },
              ],
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(legacy);
    const result = buildReviewManifest(legacy, new Map());
    expect(result.issues).toEqual([]);
    expect(result.booklets[0].id).toBe("m");
    expect(result.booklets[0].units.map((unit) => unit.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it.each([
    ["<ProgressEnd/>", "passend geöffnet"],
    ['<ProgressStart id="x"/><Unit id="intro"/>', "nicht geschlossen"],
    [
      '<ProgressStart id="x"/><Unit id="intro"/><ProgressEnd id="y"/>',
      "passend geöffnet",
    ],
    ['<ProgressStart id="x"/><ProgressEnd/>', "Leerer"],
    ['<Testlet id="x"/><Testlet id="x"/>', "doppelt"],
    ["<Unit/>", "Unit-ID fehlt"],
    ["<Unknown/>", "Unbekanntes Navigationselement"],
  ])("rejects invalid navigation %s", (units, message) => {
    expect(() =>
      parseBookletXml(
        `<Booklet><Metadata><Id>b</Id></Metadata><Units>${units}</Units></Booklet>`,
        "test.xml",
      ),
    ).toThrow(message);
  });

  it("rejects malformed XML, DTDs and missing metadata", () => {
    expect(() =>
      parseBookletXml("<Booklet><Units></Booklet>", "broken.xml"),
    ).toThrow("Ungültiges Booklet-XML");
    expect(() =>
      parseBookletXml(
        '<!DOCTYPE Booklet SYSTEM "file:///etc/passwd"><Booklet/>',
        "broken.xml",
      ),
    ).toThrow("DTDs");
    expect(() =>
      parseBookletXml("<Booklet><Units/></Booklet>", "broken.xml"),
    ).toThrow("Booklet-ID fehlt");
  });
});
