import {
  DEFAULT_ACP_INDEX_VERSION,
  getIndexScales,
  getIndexUnits,
  normalizeIndexForStorage,
  toRuntimeAcpIndex,
} from "./acp-index.utils";

describe("acp-index.utils", () => {
  it("prefers assessmentParts units over top-level units", () => {
    const index = {
      units: [{ id: "legacy-u1" }],
      assessmentParts: [
        {
          id: "p1",
          units: [{ id: "modern-u1" }],
        },
      ],
    };

    expect(getIndexUnits(index).map((u) => u.id)).toEqual(["modern-u1"]);
  });

  it("falls back to top-level units for legacy ACPs", () => {
    const index = {
      units: [{ id: "legacy-u1" }, { id: "legacy-u2" }],
      assessmentParts: [],
    };

    expect(getIndexUnits(index).map((u) => u.id)).toEqual([
      "legacy-u1",
      "legacy-u2",
    ]);
  });

  it("prefers assessmentParts scales over top-level scales", () => {
    const index = {
      scales: [{ id: "legacy-s1" }],
      assessmentParts: [
        {
          id: "p1",
          scales: [{ id: "modern-s1" }],
        },
      ],
    };

    expect(getIndexScales(index).map((s) => s.id)).toEqual(["modern-s1"]);
  });

  it("keeps equal scale ids separate across assessment parts", () => {
    const index = {
      assessmentParts: [
        { id: "p1", scales: [{ id: "shared", marker: "p1" }] },
        { id: "p2", scales: [{ id: "shared", marker: "p2" }] },
      ],
    };

    expect(getIndexScales(index).map((scale) => scale.marker)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("reads both 0.6 scale types and preserves them in storage", () => {
    const index = {
      assessmentParts: [
        {
          id: "p1",
          baseScales: [{ id: "base" }],
          derivedScales: [{ id: "derived" }],
        },
      ],
    };
    expect(getIndexScales(index).map((scale) => scale.id)).toEqual([
      "base",
      "derived",
    ]);
    expect(normalizeIndexForStorage(index)).toEqual(index);
    expect(toRuntimeAcpIndex(index).scales).toEqual([
      { id: "base" },
      { id: "derived" },
    ]);
  });

  it("drops legacy top-level units/scales instead of persisting them", () => {
    const normalized = normalizeIndexForStorage({
      units: [{ id: "u1" }],
      scales: [{ id: "s1" }],
      assessmentParts: [],
    }) as any;

    expect(normalized.assessmentParts).toBeUndefined();
    expect(normalized.units).toBeUndefined();
    expect(normalized.scales).toBeUndefined();
  });

  it("adds runtime compatibility units/scales for modern ACPs", () => {
    const runtime = toRuntimeAcpIndex({
      assessmentParts: [
        {
          id: "p1",
          units: [{ id: "u1" }],
          scales: [{ id: "s1" }],
        },
      ],
    }) as any;

    expect(runtime.units).toEqual([{ id: "u1" }]);
    expect(runtime.scales).toEqual([{ id: "s1" }]);
  });

  it("defaults version to 0.5.0 if missing", () => {
    const runtime = toRuntimeAcpIndex({
      assessmentParts: [],
    }) as any;

    expect(runtime.version).toBe(DEFAULT_ACP_INDEX_VERSION);
  });
});
