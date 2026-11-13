import { SemanticValidator } from "./semantic-validator";

describe("SemanticValidator", () => {
  let validator: SemanticValidator;
  let apRepository: { findOne: jest.Mock };
  let fileRepository: { find: jest.Mock };

  beforeEach(() => {
    apRepository = { findOne: jest.fn() };
    fileRepository = { find: jest.fn() };
    validator = new SemanticValidator(
      apRepository as any,
      fileRepository as any,
    );
  });

  it("returns error when AP is missing", async () => {
    apRepository.findOne.mockResolvedValue(null);

    const result = await validator.validate("ap-1");

    expect(result).toEqual({
      valid: false,
      issues: [{ severity: "error", message: "AP not found" }],
    });
  });

  it("collects semantic issues for missing files, unit refs and duplicate item ids", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        assessmentParts: [
          {
            id: "part-1",
            units: [
              {
                id: "unit-1",
                dependencies: [{ id: "missing.xml", type: "xml" }],
                items: [{ id: "item-1" }, { name: "missing-id" }],
              },
              {
                id: "unit-2",
                items: [{ id: "dup" }, { id: "dup" }],
              },
            ],
            instruments: [
              {
                id: "instrument-1",
                units: ["unit-1", { id: "missing-unit" }],
              },
            ],
          },
        ],
      },
    });

    fileRepository.find.mockResolvedValue([{ originalName: "present.xml" }]);

    const result = await validator.validate("ap-1");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining('references file "missing.xml"'),
        }),
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining('references unit "missing-unit"'),
        }),
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining("item without an ID"),
        }),
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining('Duplicate item ID "dup"'),
        }),
      ]),
    );
  });

  it("returns valid result when AP references are consistent", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        assessmentParts: [
          {
            id: "part-1",
            units: [
              {
                id: "unit-1",
                dependencies: [{ id: "unit.xml", type: "xml" }],
                items: [{ id: "item-1" }],
              },
            ],
            instruments: [
              {
                id: "instrument-1",
                units: [{ id: "unit-1" }],
              },
            ],
          },
        ],
      },
    });

    fileRepository.find.mockResolvedValue([{ originalName: "unit.xml" }]);

    const result = await validator.validate("ap-1");

    expect(result).toEqual({ valid: true, issues: [] });
  });
});
