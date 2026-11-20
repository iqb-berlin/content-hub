/** Small, independently usable tasks for functional editor/player acceptance. */
export function acceptanceScenarios(readUnit) {
  const tasks = [];
  const names = {
    "input-limits": "Pflichtfeld, Länge und zulässige Zeichen",
    "read-only": "Vorgegebene Antworten sind schreibgeschützt",
    "input-assistance": "Zahleneingabe mit Bildschirmtastatur",
    textarea: "Begründung mit Wortzähler",
    selection: "Auswahl markieren und wieder aufheben",
    likert: "Skala mit vorgegebener und freier Antwort",
    table: "Tabelle mit feststehender Kopfzeile",
    cloze: "Lückentext ausfüllen",
    "drag-drop": "Begriffe zuordnen",
    math: "Formel über die Mathematiktastatur eingeben",
    media: "Audio mit begrenzter Wiedergabe",
    geometry: "Punkt bewegen und zurücksetzen",
    tetfolio: "Interaktives Flaschenexperiment",
    hotspot: "Gedrehtes Dreieck auswählen",
    visibility: "Zwei Bedingungen steuern die Sichtbarkeit",
  };
  const add = (kind, source, controls, configure = () => {}) => {
    const original = structuredClone(readUnit(source));
    const definition = original.definition;
    if (source.startsWith("aspect-m3-") && !source.includes("-ui-"))
      definition.pages = [definition.pages[0]];
    configure(definition.pages[0].sections[0].elements[0], definition);
    tasks.push({
      id: `aspect-m3-acceptance-${kind}`,
      name: `ASPECT-Abnahme: ${names[kind]}`,
      definition,
      acceptance: { kind, source, controls },
    });
  };
  add(
    "input-limits",
    "aspect-m3-text-field",
    ["required", "minLength", "maxLength", "isLimitedToMaxLength", "pattern"],
    (e) => {
      Object.assign(e, {
        label: "Verkehrsmittel",
        value: "",
        required: true,
        minLength: 3,
        maxLength: 5,
        isLimitedToMaxLength: true,
        pattern: "^[A-Za-zÄÖÜäöüß]+$",
      });
    },
  );
  add(
    "read-only",
    "aspect-m3-text-field",
    ["readOnly", "clearable"],
    (e, definition) => {
      Object.assign(e, {
        label: "Vorgegebene Antwort",
        value: "Fahrrad",
        readOnly: true,
        clearable: true,
      });
      const section = definition.pages[0].sections[0];
      for (const [index, type] of ["checkbox", "dropdown"].entries()) {
        const next = structuredClone(
          readUnit(`aspect-m3-${type}`).definition.pages[0].sections[0]
            .elements[0],
        );
        Object.assign(next, {
          id: `locked_${type}`,
          alias: `LOCKED_${type.toUpperCase()}`,
          label:
            type === "checkbox"
              ? "Vorgegebenes Kontrollkästchen"
              : "Vorgegebenes Ziel",
          readOnly: true,
          value: type === "checkbox" ? true : 1,
        });
        next.position.gridRow = index + 3;
        next.options?.forEach((option, n) => {
          option.id = `locked_option_${n}`;
        });
        section.elements.push(next);
      }
    },
  );
  add(
    "input-assistance",
    "aspect-m3-text-field",
    [
      "inputAssistancePreset",
      "restrictedToInputAssistanceChars",
      "showSoftwareKeyboard",
    ],
    (e) => {
      Object.assign(e, {
        label: "Anzahl Flaschen",
        value: "",
        inputAssistancePreset: "numbers",
        restrictedToInputAssistanceChars: true,
        showSoftwareKeyboard: true,
      });
    },
  );
  add(
    "textarea",
    "aspect-m3-text-area",
    ["rowCount", "hasDynamicRowCount", "showWordCount", "resizeEnabled"],
    (e) => {
      Object.assign(e, {
        label: "Begründung",
        value: "",
        hasDynamicRowCount: false,
        rowCount: 4,
        showWordCount: true,
        resizeEnabled: false,
      });
    },
  );
  add(
    "selection",
    "aspect-m3-radio",
    ["alignment", "strikeOtherOptions", "required", "allowUnset"],
    (e, definition) => {
      Object.assign(e, {
        label: "Ausflugsziel",
        alignment: "column",
        strikeOtherOptions: true,
        required: true,
      });
      const select = structuredClone(
        readUnit("aspect-m3-dropdown").definition.pages[0].sections[0]
          .elements[0],
      );
      Object.assign(select, {
        id: "acceptance_dropdown",
        alias: "ACCEPTANCE_DROPDOWN",
        label: "Ausflugsziel auswählen",
        allowUnset: true,
        required: true,
      });
      select.position.gridRow = 3;
      select.options.forEach((option, index) => {
        option.id = `acceptance_option_${index}`;
      });
      definition.pages[0].sections[0].elements.push(select);
    },
  );
  add(
    "likert",
    "aspect-m3-likert",
    ["stickyHeader", "styling.lineColoring", "rows[].readOnly"],
    (e) => {
      e.stickyHeader = true;
      e.styling.lineColoring = true;
      const locked = structuredClone(e.rows[0]);
      Object.assign(locked, {
        id: "locked_scale",
        alias: "LOCKED_SCALE",
        readOnly: true,
        value: 0,
      });
      e.rows.unshift(locked);
    },
  );
  add(
    "table",
    "aspect-m3-table",
    ["headerEnabled", "headerRows", "stickyHeader", "tableEdgesEnabled"],
    (e) => {
      Object.assign(e, {
        headerEnabled: true,
        headerRows: [[{ text: "Gegenstand" }, { text: "Anzahl" }]],
        stickyHeader: true,
        tableEdgesEnabled: true,
      });
      const cell = structuredClone(e.elements[0]);
      e.gridRowSizes = Array.from({ length: 20 }, () => ({
        value: 72,
        unit: "px",
      }));
      e.elements = Array.from({ length: 20 }, (_, index) => {
        const next = structuredClone(cell);
        next.id = `table_cell_${index}`;
        next.alias = `TABLE_CELL_${index}`;
        next.position.gridRow = index + 1;
        next.position.gridColumn = 1;
        return next;
      });
    },
  );
  add(
    "cloze",
    "aspect-m3-cloze",
    ["document", "columnCount", "embedded inputs"],
    (e) => {
      e.columnCount = 1;
    },
  );
  add("drag-drop", "aspect-m3-ui-drag-0-0", [
    "idList",
    "connectedTo",
    "allowReplacement",
    "allowCopies",
  ]);
  add(
    "math",
    "aspect-m3-math-field",
    ["mathKeyboardPresets", "enableModeSwitch"],
    (e) => {
      e.mathKeyboardPresets = ["math", "physics"];
      e.enableModeSwitch = false;
    },
  );
  add(
    "media",
    "aspect-m3-audio",
    [
      "player.maxRuns",
      "player.defaultVolume",
      "player.minVolume",
      "player.pauseControl",
      "player.showRestRuns",
    ],
    (e) => {
      const wave = Buffer.from(e.src.split(",")[1], "base64");
      const samples = Buffer.concat(
        Array.from({ length: 40 }, () => wave.subarray(44)),
      );
      const header = Buffer.from(wave.subarray(0, 44));
      header.writeUInt32LE(36 + samples.length, 4);
      header.writeUInt32LE(samples.length, 40);
      e.src =
        "data:audio/wav;base64," +
        Buffer.concat([header, samples]).toString("base64");
      Object.assign(e.player, {
        maxRuns: 1,
        minRuns: 1,
        defaultVolume: 0.6,
        minVolume: 0.4,
        pauseControl: true,
        showRestRuns: true,
        hintDelay: 0,
      });
    },
  );
  add("geometry", "aspect-m3-geometry", [
    "appDefinition",
    "trackedVariables",
    "showResetIcon",
    "enableUndoRedo",
  ]);
  add("tetfolio", "aspect-m3-tetfolio", ["htmlContent", "state bridge"]);
  add("hotspot", "aspect-m3-linked-hotspot-triangle-45", [
    "shape",
    "rotation",
    "value",
  ]);
  add("visibility", "aspect-m3-linked-two-rules-conjunction", [
    "visibilityRules",
    "logicalConnectiveOfRules",
    "enableReHide",
  ]);
  return tasks;
}
