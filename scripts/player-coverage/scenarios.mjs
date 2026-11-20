/** Valid connected examples for UI controls whose values reference other elements. */
export function connectedScenarios(snapshot, presets) {
  const copy = structuredClone;
  let serial = 0;
  const element = (type, fields = {}) => {
    const id = `linked_${++serial}`;
    return {
      ...copy(snapshot.types[type].defaults),
      id,
      alias: id.toUpperCase(),
      ...copy(fields),
    };
  };
  const section = (elements, fields = {}) => ({
    ...copy(snapshot.base.pages[0].sections[0]),
    elements,
    height: 500,
    ...fields,
  });
  const unit = (sections) => ({
    ...copy(snapshot.base),
    pages: [{ ...copy(snapshot.base.pages[0]), sections }],
  });
  const tasks = [];
  const add = (id, name, definition, probe, controls) =>
    tasks.push({
      id: `aspect-m3-linked-${id}`,
      name,
      definition,
      probe,
      controls,
    });
  const comparisons = [
    ["=", "Fahrrad", "Boot", "Fahrrad"],
    ["≠", "Boot", "Boot", "Fahrrad"],
    ["<", "5", "8", "3"],
    ["≤", "5", "8", "5"],
    [">", "5", "3", "8"],
    ["≥", "5", "3", "5"],
    ["contains", "rad", "Boot", "Fahrrad"],
    ["pattern", "Fahr.*", "Boot", "Fahrrad"],
    ["minLength", "5", "See", "Fahrrad"],
    ["maxLength", "5", "Fahrrad", "See"],
  ];
  for (const [
    index,
    [operator, value, hidden, visible],
  ] of comparisons.entries())
    for (const connective of ["conjunction", "disjunction"]) {
      const input = element("text-field", { label: "Prüfwert", value: "" });
      const result = element("text", {
        text: "<p>Treffer: Die Sichtbarkeitsregel ist erfüllt.</p>",
      });
      const definition = unit([
        section([input]),
        section([result], {
          visibilityRules: [{ id: input.id, operator, value }],
          logicalConnectiveOfRules: connective,
          enableReHide: true,
          animatedVisibility: index % 2 === 0,
          visibilityDelay: index % 2 === 0 ? 50 : 0,
        }),
      ]);
      add(
        `visibility-${index}-${connective}`,
        `Sichtbarkeit ${operator}, ${connective}`,
        definition,
        { kind: "visibility", hidden, visible },
        [
          "visibilityRules",
          "logicalConnectiveOfRules",
          "enableReHide",
          "animatedVisibility",
          "visibilityDelay",
        ],
      );
    }
  // Two real rules distinguish AND from OR; a single rule cannot exercise their difference.
  for (const connective of ["conjunction", "disjunction"]) {
    const a = element("checkbox", { label: "Wasser", value: false }),
      b = element("checkbox", { label: "Brot", value: false });
    const result = element("text", {
      text: "<p>Treffer: Die Packliste ist bereit.</p>",
    });
    add(
      `two-rules-${connective}`,
      `Zwei Regeln: ${connective}`,
      unit([
        section([a, b]),
        section([result], {
          logicalConnectiveOfRules: connective,
          enableReHide: true,
          visibilityRules: [a, b].map((e) => ({
            id: e.id,
            operator: "=",
            value: "true",
          })),
        }),
      ]),
      { kind: "two-rules", connective },
      ["visibilityRules", "logicalConnectiveOfRules"],
    );
  }
  for (const type of ["button"])
    for (const param of ["previous", "next", "first", "last", "end"]) {
      const control = element(type, {
        ...(type === "button" ? { label: `Navigation: ${param}` } : {}),
        action: "unitNav",
        actionParam: param,
      });
      add(
        `${type}-nav-${param}`,
        `${type}: Aufgabe ${param}`,
        unit([section([control])]),
        { kind: "unit-nav", param, type },
        ["action", "actionParam"],
      );
    }
  const button = element("button", {
    label: "Weiter zur Packliste",
    action: "pageNav",
    actionParam: 1,
  });
  const pages = unit([section([button])]);
  pages.pages.push({
    ...copy(snapshot.base.pages[0]),
    sections: [
      section([element("text", { text: "<p>Zielseite: Packliste</p>" })]),
    ],
  });
  add(
    "page-nav",
    "Schaltfläche zur zweiten Seite",
    pages,
    { kind: "page-nav" },
    ["action", "actionParam"],
  );
  const anchor = element("text", {
    text: '<p>Wir fahren zum <aspect-anchor data-anchor-id="see" data-anchor-color="#fff4d6">See</aspect-anchor>.</p>',
  });
  const highlight = element("button", {
    label: "See hervorheben",
    action: "highlightText",
    actionParam: "see",
  });
  add(
    "highlight",
    "Schaltfläche mit gültigem Textanker",
    unit([section([anchor, highlight])]),
    { kind: "highlight" },
    ["action", "actionParam"],
  );
  const state = unit([
    section([
      element("button", {
        label: "Packliste freigeben",
        action: "stateVariableChange",
        actionParam: { id: "state", value: "bereit" },
      }),
    ]),
    section(
      [
        element("text", {
          text: "<p>Treffer: Die Packliste wurde freigegeben.</p>",
        }),
      ],
      {
        visibilityRules: [{ id: "state", operator: "=", value: "bereit" }],
        enableReHide: true,
      },
    ),
  ]);
  state.stateVariables = [{ id: "state", alias: "PACKLISTE", value: "offen" }];
  add(
    "state",
    "Zustandsvariable per Schaltfläche ändern",
    state,
    { kind: "state" },
    ["stateVariables", "action", "actionParam", "visibilityRules"],
  );
  for (const markingMode of ["word", "range", "selection"]) {
    const panel = element("marking-panel", { ...presets["marking-panel"] });
    panel.id = `mark_${markingMode}`;
    panel.alias = `MARK_${markingMode.toUpperCase()}`;
    const text = element("text", {
      text: "<p>Wasser Brot Sand</p>",
      markingMode,
      markingPanels: [panel.id],
      highlightableOrange: true,
      highlightableTurquoise: true,
      highlightableYellow: true,
      hasSelectionPopup: true,
    });
    add(
      `mark-${markingMode}`,
      `Markieren: ${markingMode}`,
      unit([section([text, panel])]),
      { kind: "marking" },
      ["markingMode", "markingPanels", "hasSelectionPopup"],
    );
  }
  const triggerState = copy(state);
  triggerState.pages[0].sections[0].elements = [
    element("trigger", {
      action: "stateVariableChange",
      actionParam: { id: "state", value: "bereit" },
    }),
  ];
  add(
    "trigger-state",
    "Auslöser setzt Zustandsvariable",
    triggerState,
    { kind: "trigger-state" },
    ["action", "actionParam"],
  );
  const anchorElement = element("text", {
    text: '<p>Wir fahren zum <aspect-anchor data-anchor-id="see" data-anchor-color="#fff4d6">See</aspect-anchor>.</p>',
  });
  add(
    "trigger-highlight",
    "Auslöser hebt einen Textanker hervor",
    unit([
      section([
        anchorElement,
        element("trigger", { action: "highlightText", actionParam: "see" }),
      ]),
    ]),
    { kind: "trigger-highlight" },
    ["action", "actionParam"],
  );
  const release = element("checkbox", {
    label: "Hervorhebung entfernen",
    value: false,
  });
  add(
    "trigger-remove",
    "Auslöser entfernt eine bestehende Hervorhebung",
    unit([
      section([copy(anchorElement), copy(highlight), release]),
      section(
        [element("trigger", { action: "removeHighlights", actionParam: null })],
        { visibilityRules: [{ id: release.id, operator: "=", value: "true" }] },
      ),
    ]),
    { kind: "trigger-remove" },
    ["action", "actionParam", "visibilityRules"],
  );
  if (presets.audio && presets.image)
    for (const maxRuns of [1, 2, null]) {
      const first = element("audio", {
          src: presets.audio.src,
          fileName: "hinweis.wav",
        }),
        second = element("audio", {
          src: presets.audio.src,
          fileName: "hoertext.wav",
        });
      first.player.maxRuns = 1;
      second.player = {
        ...second.player,
        activeAfterID: first.id,
        maxRuns,
        minRuns: 1,
        pauseControl: true,
        showRestRuns: true,
        imgSrc: presets.image.src,
        imgFileName: "ausflug.svg",
      };
      add(
        `audio-chain-${maxRuns}`,
        "Zwei verknüpfte Audios: " + String(maxRuns ?? "unbegrenzt"),
        unit([section([first, second])]),
        { kind: "media-chain" },
        [
          "player.activeAfterID",
          "player.minRuns",
          "player.maxRuns",
          "player.imgSrc",
        ],
      );
    }
  if (presets["hotspot-image"])
    for (const shape of ["rectangle", "ellipse", "triangle"])
      for (const rotation of [-45, 0, 45]) {
        const input = element("hotspot-image", {
          src: presets["hotspot-image"].src,
          value: [
            {
              top: 20,
              left: 20,
              width: 70,
              height: 60,
              shape,
              rotation,
              borderWidth: 2,
              borderColor: "#166b8c",
              backgroundColor: "#e19c30",
              value: rotation === 45,
              readOnly: rotation === 0,
            },
          ],
        });
        add(
          `hotspot-${shape}-${rotation}`,
          "Hotspot: " + shape + ", " + rotation,
          unit([section([input])]),
          { kind: "hotspot", readOnly: rotation === 0, value: rotation === 45 },
          ["value", "top", "shape", "rotation"],
        );
      }
  return tasks;
}
