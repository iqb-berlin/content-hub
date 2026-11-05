// Source-root argument contains pinned checkouts named aspect-0 through aspect-3.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { createRequire } = require("node:module");
const r = createRequire(path.resolve("frontend/package.json")),
  ts = r("typescript");
const output = path.resolve("test-fixtures/player-generations/authoring");
for (const major of [0, 1, 2, 3]) {
  const root = path.resolve(process.argv[2], `aspect-${major}`);
  const file =
    root +
    (major === 0
      ? "/projects/editor/src/app/UnitFactory.ts"
      : major === 3
        ? "/projects/common/utils/element-factory.ts"
        : "/projects/common/util/element.factory.ts");
  const program = ts.createProgram(
    [file, root + "/projects/common/models/unit.ts"],
    {
      baseUrl: root + "/projects",
      paths: { "common/*": ["common/*"] },
      strictNullChecks: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
  );
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file),
    model = require(path.resolve(process.argv[2], `models-${major}.cjs`));
  const types = {};
  function describe(type, decl, depth = 0) {
    const clean = checker.getNonNullableType(type);
    const parts = type.isUnion() ? type.types : [type];
    const result = { type: checker.typeToString(type) };
    const values = parts
      .filter(
        (t) =>
          (t.flags &
            (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) !==
          0,
      )
      .map((t) => t.value);
    if (values.length) result.values = values;
    if (checker.isArrayType(clean)) {
      const item = checker.getTypeArguments(clean)[0];
      const choices = (item?.isUnion() ? item.types : [item])
        .filter(
          (t) =>
            t &&
            (t.flags &
              (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) !==
              0,
        )
        .map((t) => t.value);
      if (choices.length) result.itemValues = choices;
    }
    if (
      depth < 3 &&
      clean.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection) &&
      !checker.isArrayType(clean) &&
      !clean.getCallSignatures().length
    ) {
      const props = {};
      for (const p of clean.getProperties()) {
        const d = p.valueDeclaration || p.declarations?.[0] || decl;
        const t = checker.getTypeOfSymbolAtLocation(p, d);
        if (t.getCallSignatures().length) continue;
        props[p.name] = describe(t, d, depth + 1);
      }
      if (Object.keys(props).length) result.properties = props;
    }
    const declFile = decl?.getSourceFile();
    if (declFile && declFile.fileName.startsWith(root)) {
      result.source = declFile.fileName.slice(root.length + 1);
      result.line =
        declFile.getLineAndCharacterOfPosition(decl.getStart()).line + 1;
    }
    return result;
  }
  if (major === 0) {
    for (const s of sf.statements) {
      if (!ts.isFunctionDeclaration(s) || !s.name?.text.startsWith("create"))
        continue;
      const sig = checker.getSignatureFromDeclaration(s);
      if (!sig) continue;
      const val = model[s.name.text]?.();
      if (val?.type && val.id) {
        types[val.type] = {
          defaults: val,
          schema: describe(checker.getReturnTypeOfSignature(sig), s).properties,
        };
      }
    }
  } else {
    const classes = model.ElementFactory.ELEMENT_CLASSES;
    for (const [type, Class] of Object.entries(classes)) {
      let cls;
      for (const f of program.getSourceFiles()) {
        cls = f.statements.find(
          (n) =>
            ts.isClassDeclaration(n) &&
            n.name?.text === Class.name.replace(/^_/, ""),
        );
        if (cls) break;
      }
      if (!cls) throw new Error(`Missing ${Class.name}`);
      const obj = model.ElementFactory.createElement({
        type,
        id: "input",
        alias: "ANSWER",
      });
      const info = checker.getDeclaredTypeOfSymbol(
        checker.getSymbolAtLocation(cls.name),
      );
      types[type] = {
        defaults: JSON.parse(JSON.stringify(obj)),
        schema: describe(info, cls).properties,
      };
    }
  }
  const base =
    major === 0
      ? {
          veronaModuleVersion: "0.0.1",
          pages: [
            {
              ...model.createUnitPage(1),
              sections: [model.createUnitPageSection()],
            },
          ],
        }
      : JSON.parse(JSON.stringify(new model.Unit()));
  // Make fallback child ids deterministic. This changes fixture identifiers, not module bytes.
  let n = 0;
  function stable(value) {
    if (!value || typeof value !== "object") return;
    if (value.id && value.type) {
      value.id = "element_" + ++n;
      if (value.alias !== undefined) value.alias = "VARIABLE_" + n;
    }
    for (const v of Object.values(value)) stable(v);
  }
  for (const t of Object.values(types)) stable(t.defaults);
  const contexts = {};
  for (const [scope, name] of Object.entries(
    major === 0
      ? { page: "UnitPage", section: "UnitPageSection" }
      : { unit: "Unit", page: "Page", section: "Section" },
  )) {
    let declaration;
    for (const f of program.getSourceFiles()) {
      declaration = f.statements.find(
        (n) =>
          (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n)) &&
          n.name?.text === name,
      );
      if (declaration) break;
    }
    if (declaration) {
      const info = checker.getDeclaredTypeOfSymbol(
        checker.getSymbolAtLocation(declaration.name),
      );
      contexts[scope] = describe(info, declaration).properties;
    }
  }
  const sourceFiles = {};
  for (const f of program
    .getSourceFiles()
    .filter((f) => f.fileName.startsWith(root + "/"))) {
    const rel = f.fileName.slice(root.length + 1);
    sourceFiles[rel] = crypto
      .createHash("sha256")
      .update(fs.readFileSync(f.fileName))
      .digest("hex");
  }
  const repo = "https://github.com/iqb-berlin/verona-modules-aspect";
  const tags = [
    "0.1.0",
    "editor/1.39.0+player/1.32.0",
    "editor/2.12.6+player/2.12.6",
    "editor/3.1.0+player/3.1.0",
  ];
  fs.writeFileSync(
    output + `/aspect-${major}.json`,
    JSON.stringify(
      {
        source: repo,
        ref: tags[major],
        derivation:
          "Original editor model defaults and declared property types. Rendering methods excluded only from the temporary Node build; original editor/player HTML is unchanged.",
        sourceFiles,
        base,
        types,
        contexts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(major, Object.keys(types).length);
}
