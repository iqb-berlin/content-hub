import {
  DEFAULT_AP_INDEX_VERSION,
  getIndexScales,
  getIndexUnits,
  normalizeIndexForStorage,
  toRuntimeApIndex,
} from "./ap-index.utils";

describe("ap-index.utils", () => {
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

  it("falls back to top-level units for legacy APs", () => {
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

  it("normalizes legacy units/scales into assessmentParts", () => {
    const normalized = normalizeIndexForStorage({
      units: [{ id: "u1" }],
      scales: [{ id: "s1" }],
      assessmentParts: [],
    }) as any;

    expect(normalized.assessmentParts?.length).toBe(1);
    expect(normalized.assessmentParts[0].units).toEqual([{ id: "u1" }]);
    expect(normalized.assessmentParts[0].scales).toEqual([{ id: "s1" }]);
  });

  it("adds runtime compatibility units/scales for modern APs", () => {
    const runtime = toRuntimeApIndex({
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
    const runtime = toRuntimeApIndex({
      assessmentParts: [],
    }) as any;

    expect(runtime.version).toBe(DEFAULT_AP_INDEX_VERSION);
  });
});
