import { BadRequestException } from "@nestjs/common";
import { normalizePartId, normalizeRelativePath } from "./relative-path";

describe("normalizeRelativePath", () => {
  it.each([
    "/absolute/unit.xml",
    "C:/absolute/unit.xml",
    "../unit.xml",
    "units/../../unit.xml",
    "units/",
    "units/\0unit.xml",
    "",
  ])("rejects unsafe path %p", (value) => {
    expect(() => normalizeRelativePath(value)).toThrow(BadRequestException);
  });

  it("normalizes separators and harmless dot segments to POSIX paths", () => {
    expect(normalizeRelativePath("units\\Ma1\\./unit.xml")).toBe(
      "units/Ma1/unit.xml",
    );
  });

  it("uses one canonical slug for assessment part path segments", () => {
    expect(normalizePartId("Mäthe Teil 1")).toBe("mathe-teil-1");
  });
});
