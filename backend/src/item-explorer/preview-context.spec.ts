import { normalizePreviewContext } from "./preview-context";

describe("presentation context", () => {
  const context = {
    definitionKey: "123-abc-def",
    target: "item",
    page: 1,
    dataParts: { elementCodes: "[]", stateVariableCodes: "[]" },
  };
  it("retains supported player state without mixing it with saved answers", () => {
    expect(
      normalizePreviewContext({
        ...context,
        target: " item ",
        extra: "discard",
      }),
    ).toEqual(context);
  });
  it("rejects invalid keys, pages, scalar data and oversized payloads", () => {
    for (const input of [
      null,
      [],
      { ...context, definitionKey: "invalid" },
      { ...context, page: -1 },
      { ...context, target: "" },
      { ...context, dataParts: [] },
      { ...context, dataParts: {} },
      { ...context, dataParts: { script: "[]" } },
      { ...context, dataParts: { elementCodes: "{}" } },
      { ...context, dataParts: { elementCodes: "[" } },
      { ...context, dataParts: { elementCodes: 1 } },
      { ...context, dataParts: { elementCodes: " ".repeat(524289) } },
    ])
      expect(normalizePreviewContext(input)).toBeNull();
  });
});
