import { CommentCategories1789700000000 } from "../migrations/1789700000000-CommentCategories";

describe("CommentCategories rollback", () => {
  it.each(["comments", "configuration", "empty"])(
    "protects existing %s",
    async (state) => {
      const q = {
        query: jest.fn(async (sql: string) => {
          if (
            sql.startsWith("SELECT") &&
            ((state === "comments" && sql.includes("FROM comments")) ||
              (state === "configuration" &&
                sql.includes("FROM acp_access_configs")))
          )
            return [{ exists: 1 }];
          return [];
        }),
      };
      const rollback = new CommentCategories1789700000000().down(q as any);
      if (state === "empty") {
        await expect(rollback).resolves.toBeUndefined();
        expect(q.query).toHaveBeenCalledWith(
          expect.stringContaining("DROP COLUMN category_id"),
        );
      } else {
        await expect(rollback).rejects.toThrow(
          "rollback would lose review data",
        );
        expect(
          q.query.mock.calls.some(([sql]) => sql.includes("DROP COLUMN")),
        ).toBe(false);
      }
    },
  );
});
