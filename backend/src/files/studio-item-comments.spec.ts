import { parseStudioItemComments } from "./studio-item-comments";

describe("Studio item comments", () => {
  it("maps VOUC comments to UUIDs, inherits replies, and preserves export order", () => {
    const result = parseStudioItemComments(
      JSON.stringify([
        {
          id: 1,
          body: "<p>First</p>",
          userName: "Author",
          itemUuids: ["a", "b"],
          createdAt: "2026-10-21T08:00:00Z",
        },
        { id: 2, body: "Reply", parentId: 1, itemUuids: [] },
        { id: 3, body: "Unit comment", itemUuids: [] },
        { id: 4, body: "Other item", itemUuids: ["b"] },
        { id: 5, body: "Hidden in Studio", itemUuids: ["a"], hidden: true },
      ]),
    );
    expect(result.get("a")).toEqual([
      {
        id: 1,
        body: "<p>First</p>",
        userName: "Author",
        createdAt: "2026-10-21T08:00:00.000Z",
        hidden: false,
      },
      { id: 2, body: "Reply", parentId: 1, hidden: false },
      { id: 5, body: "Hidden in Studio", hidden: true },
    ]);
    expect(result.get("b")?.map((comment) => comment.id)).toEqual([1, 2, 4]);
    expect(result.has("other")).toBe(false);
  });

  it("respects explicit reply assignments and resolves out-of-order parents", () => {
    const result = parseStudioItemComments(
      JSON.stringify([
        { id: 2, body: "Reply for b", parentId: 1, itemUuids: ["b"] },
        { id: 3, body: "Inherited reply", parentId: 1 },
        { id: 1, body: "Root for a", itemUuids: ["a"] },
      ]),
    );
    expect(result.get("a")?.map((comment) => comment.id)).toEqual([3, 1]);
    expect(result.get("b")?.map((comment) => comment.id)).toEqual([2]);
  });

  it("ignores invalid entries, orphan replies, duplicates, and parent cycles", () => {
    const result = parseStudioItemComments(
      JSON.stringify([
        null,
        { id: 1, body: "Valid", itemUuids: ["a", "a"] },
        { id: 1, body: "Duplicate", itemUuids: ["a"] },
        { id: 2, body: "  ", itemUuids: ["a"] },
        { id: 3, body: 42, itemUuids: ["a"] },
        { id: 4, body: "Orphan", parentId: 99 },
        { id: 5, body: "Cycle", parentId: 6 },
        { id: 6, body: "Cycle", parentId: 5 },
        { id: 7, body: "No valid item", itemUuids: [null, false] },
      ]),
    );
    expect([...result.keys()]).toEqual(["a"]);
    expect(result.get("a")?.map((comment) => comment.body)).toEqual(["Valid"]);
  });

  it.each(["{", "{}", "null"])(
    "rejects malformed VOUC content %s",
    (content) => {
      expect(() => parseStudioItemComments(content)).toThrow();
    },
  );
});
