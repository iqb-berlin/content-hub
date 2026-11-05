import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("bundled official chemistry runtimes", () => {
  const directory = join(__dirname, "assets/widgets");
  const sources = JSON.parse(
    readFileSync(join(directory, "sources.json"), "utf8"),
  );
  it("ships both unchanged release artifacts with their license", () => {
    expect(sources.version).toBe("1.1.0");
    expect(sources.files.map((file: { file: string }) => file.file)).toEqual([
      "periodic-table.html",
      "molecule-editor.html",
    ]);
    for (const file of sources.files) {
      const content = readFileSync(join(directory, file.file));
      expect(createHash("sha256").update(content).digest("hex")).toBe(
        file.sha256,
      );
      expect(file.source).toMatch(
        /^https:\/\/github.com\/iqb-berlin\/verona-widgets-chemistry\/releases\/download\/1\.1\.0\//,
      );
      expect(content.toString()).toContain("vowReadyNotification");
    }
    expect(readFileSync(join(directory, "LICENSE"), "utf8")).toContain(
      "MIT License",
    );
  });
});
