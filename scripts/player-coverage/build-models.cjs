// Source-root argument contains pinned checkouts named aspect-0 through aspect-3.
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const r = createRequire(path.resolve("frontend/package.json"));
const esbuild = r("esbuild");
(async () => {
  for (const major of [0, 1, 2, 3]) {
    const root = path.resolve(process.argv[2], `aspect-${major}`);
    const candidates = [
      "projects/common/utils/element-factory.ts",
      "projects/common/element-factory.ts",
      "projects/common/ElementFactory.ts",
      "projects/common/util/element.factory.ts",
      "projects/common/ui-elements/element-factory.ts",
    ];
    const factory = candidates.find((f) => fs.existsSync(root + "/" + f));
    const uf = fs.existsSync(root + "/projects/common/models/unit.ts")
      ? "projects/common/models/unit.ts"
      : "projects/common/unit.ts";
    if (major === 0) {
      await esbuild.build({
        entryPoints: [root + "/projects/editor/src/app/UnitFactory.ts"],
        bundle: true,
        platform: "node",
        format: "cjs",
        outfile: path.resolve(process.argv[2], "models-0.cjs"),
      });
      console.log("built", major);
      continue;
    }
    if (!factory) {
      console.log("NO FACTORY", major);
      continue;
    }
    try {
      await esbuild.build({
        stdin: {
          contents: `export * from './${factory}'; export * from './${uf}';`,
          resolveDir: root,
        },
        plugins: [
          {
            name: "editor-environment",
            setup(b) {
              b.onLoad({ filter: /common\/models\/.*\.ts$/ }, async (args) => {
                let s = fs.readFileSync(args.path, "utf8");
                const ts = r("typescript");
                const sf = ts.createSourceFile(
                  args.path,
                  s,
                  ts.ScriptTarget.Latest,
                  true,
                );
                const edits = sf.statements.filter(
                  (n) =>
                    ts.isImportDeclaration(n) &&
                    /^common\/(components|directives)\//.test(
                      n.moduleSpecifier.text,
                    ),
                );
                function visit(n) {
                  if (
                    (ts.isMethodDeclaration(n) ||
                      ts.isPropertyDeclaration(n)) &&
                    n.name?.getText(sf) === "getElementComponent"
                  )
                    edits.push(n);
                  else ts.forEachChild(n, visit);
                }
                ts.forEachChild(sf, visit);
                edits.sort((a, b) => a.pos - b.pos);
                for (const n of edits.reverse())
                  s = s.slice(0, n.getFullStart()) + s.slice(n.getEnd());
                return { contents: s, loader: "ts" };
              });
              b.onLoad({ filter: /common\/environment\.ts$/ }, () => ({
                contents:
                  "export const environment={strictInstantiation:false};",
                loader: "ts",
              }));
            },
          },
        ],
        nodePaths: [path.resolve("frontend/node_modules")],
        bundle: true,
        platform: "node",
        format: "cjs",
        outfile: path.resolve(process.argv[2], `models-${major}.cjs`),
        tsconfigRaw: {
          compilerOptions: {
            baseUrl: root + "/projects",
            paths: { "common/*": ["common/*"] },
            experimentalDecorators: true,
          },
        },
      });
      console.log("built", major);
    } catch (e) {
      console.log("ERROR", major, e.message);
    }
  }
})();
