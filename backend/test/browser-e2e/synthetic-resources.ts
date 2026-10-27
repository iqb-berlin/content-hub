import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

interface Download {
  source: string;
  sha256: string;
}

/** Called only by the guarded E2E seed. Never installs assets in development storage. */
export async function prepareSyntheticResources(
  fixtureDirectory: string,
): Promise<void> {
  if (
    process.env.NODE_ENV !== "test" ||
    !process.env.DB_DATABASE?.includes("e2e")
  ) {
    throw new Error(
      "Synthetic resources require the isolated E2E environment.",
    );
  }
  const source = resolve(__dirname, "../../../test-fixtures/synthetic-players");
  const resources = JSON.parse(
    await readFile(join(source, "resources.json"), "utf8"),
  );
  const storage = resolve(fixtureDirectory, "storage");
  if (resolve(process.env.FILE_STORAGE_PATH || "") !== storage) {
    throw new Error(
      "Synthetic resources require FILE_STORAGE_PATH in the E2E fixture directory.",
    );
  }
  const cache = join(fixtureDirectory, "resource-cache");
  await mkdir(cache, { recursive: true });
  const download = async (entry: Download): Promise<Buffer> => {
    const cachedFile = join(cache, entry.sha256);
    let content: Buffer | undefined;
    try {
      content = await readFile(cachedFile);
    } catch {
      // Populate the cache once; every reuse still verifies its contents.
    }
    if (!content) {
      const response = await fetch(entry.source, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok)
        throw new Error(`Synthetic resource download failed: ${entry.source}`);
      content = Buffer.from(await response.arrayBuffer());
    }
    if (createHash("sha256").update(content).digest("hex") !== entry.sha256) {
      throw new Error(`Synthetic resource checksum mismatch: ${entry.source}`);
    }
    await writeFile(cachedFile, content);
    return content;
  };
  const put = async (file: string, content: Buffer | string) => {
    const destination = resolve(storage, "shared-assets", file);
    if (!destination.startsWith(`${join(storage, "shared-assets")}${sep}`)) {
      throw new Error("Invalid synthetic resource path.");
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  // Same ZIP library used by the application's GeoGebra upload.
  const JSZip = require("jszip");
  const archive = await JSZip.loadAsync(await download(resources.geogebra));
  for (const file of Object.values(archive.files) as {
    name: string;
    dir: boolean;
    async: (type: string) => Promise<Buffer>;
  }[]) {
    if (!file.dir && file.name.startsWith("GeoGebra/")) {
      await put(
        `geogebra/current/${file.name}`,
        await file.async("nodebuffer"),
      );
    }
  }
  for (const file of resources.ib.files) {
    await put(
      `geogebra/current/synthetic-ib/runtimes/${resources.ib.version}/${file.file}`,
      await download(file),
    );
  }
  await put(
    "geogebra/current/synthetic-ib/runtimes/ib-runtime.9.9.0.html",
    await readFile(join(source, "ib/ib-runtime.9.9.0.html")),
  );
  await put(
    "geogebra/current/synthetic-ib/units/demo/config.json",
    await readFile(join(source, "ib/config.json")),
  );
}
