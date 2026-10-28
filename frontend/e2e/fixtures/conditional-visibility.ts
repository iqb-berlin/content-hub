import { Buffer } from 'node:buffer';

/** Synthetic task content in Aspect VOUD 4.10 format; no production assessment material. */
export function conditionalVisibilityDefinition() {
  const text = (alias: string, content: string) => ({
    type: 'text',
    id: alias,
    alias,
    text: `<p>${content}</p>`,
    isRelevantForPresentationComplete: false,
    dimensions: {
      width: 180,
      height: 98,
      isWidthFixed: false,
      isHeightFixed: false,
      minWidth: 180,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    },
    position: {
      xPosition: 0,
      yPosition: 0,
      gridColumn: 1,
      gridColumnRange: 1,
      gridRow: 1,
      gridRowRange: 1,
      marginLeft: { value: 0, unit: 'px' },
      marginRight: { value: 0, unit: 'px' },
      marginTop: { value: 0, unit: 'px' },
      marginBottom: { value: 10, unit: 'px' },
      zIndex: 0,
    },
    styling: {
      backgroundColor: 'transparent',
      fontColor: '#000000',
      font: 'Roboto',
      fontSize: 20,
      bold: false,
      italic: false,
      underline: false,
      lineHeight: 135,
    },
    markingMode: 'selection',
    markingPanels: [],
    highlightableOrange: false,
    highlightableTurquoise: false,
    highlightableYellow: false,
    hasSelectionPopup: false,
    columnCount: 1,
  });
  const section = (alias: string, content: string, value: string) => ({
    elements: [text(alias, content)],
    height: 200,
    backgroundColor: '#ffffff',
    dynamicPositioning: true,
    autoColumnSize: true,
    autoRowSize: true,
    gridColumnSizes: [{ value: 1, unit: 'fr' }],
    gridRowSizes: [{ value: 1, unit: 'fr' }],
    visibilityDelay: 0,
    animatedVisibility: false,
    enableReHide: true,
    logicalConnectiveOfRules: 'conjunction',
    visibilityRules: [{ id: 'context', operator: '=', value }],
    ignoreNumbering: false,
  });
  const page = (alwaysVisible: boolean, sections: ReturnType<typeof section>[]) => ({
    sections,
    hasMaxWidth: true,
    maxWidth: 750,
    margin: 30,
    backgroundColor: '#ffffff',
    alwaysVisible,
    alwaysVisiblePagePosition: 'left',
    alwaysVisibleAspectRatio: 50,
  });
  return {
    type: 'aspect-unit-definition',
    version: '4.10.0',
    stateVariables: [{ id: 'context', alias: 'Context', value: '0' }],
    enableSectionNumbering: false,
    sectionNumberingPosition: 'left',
    showUnitNavNext: false,
    pages: [
      page(true, [
        section('stimulus-a', 'Stimulus nur für A', '1'),
        section('stimulus-b', 'Stimulus nur für B', '2'),
      ]),
      page(false, [section('V1', 'Aufgabe A', '1')]),
      page(false, [section('V2', 'Aufgabe B', '2')]),
    ],
  };
}

/** Two ordered viewport triggers on the first task page, initially below the fold. */
export function firstPageTriggerDefinition() {
  const definition = conditionalVisibilityDefinition();
  const page = definition.pages[1];
  const section = page.sections[0];
  const element = section.elements[0];
  const trigger = (id: string, value: string, marginTop: number) => ({
    ...element,
    id,
    alias: id,
    type: 'trigger',
    action: 'stateVariableChange',
    actionParam: { id: 'context', value },
    dimensions: { ...element.dimensions, height: 60, isHeightFixed: true },
    position: { ...element.position, marginTop: { value: marginTop, unit: 'px' } },
  });
  definition.pages = [
    {
      ...page,
      sections: [
        { ...section, visibilityRules: [], elements: [trigger('initial', '1', 1600)] },
        { ...section, elements: [trigger('open', '2', 0)] },
        { ...section, visibilityRules: [{ id: 'context', operator: '=', value: '2' }] },
      ],
    },
  ];
  return definition;
}

/** A regular task page reveals a stimulus once, then advances to its item state. */
export function persistentVisibilityDefinition() {
  const definition = conditionalVisibilityDefinition();
  const page = definition.pages[1];
  const section = page.sections[0];
  const element = section.elements[0];
  const rule = (value: string) => [{ id: 'context', operator: '=', value }];
  definition.pages = [
    {
      ...page,
      sections: [
        {
          ...section,
          enableReHide: false,
          visibilityRules: rule('0'),
          elements: [
            {
              ...element,
              id: 'persistent',
              alias: 'persistent',
              text: '<p>Bleibender Stimulus</p>',
            },
          ],
        },
        {
          ...section,
          visibilityRules: [],
          elements: [
            {
              ...element,
              id: 'advance',
              alias: 'advance',
              type: 'trigger',
              action: 'stateVariableChange',
              actionParam: { id: 'context', value: '1' },
              position: { ...element.position, marginTop: { value: 1600, unit: 'px' } },
            },
          ],
        },
        { ...section, visibilityRules: rule('1') },
      ],
    },
    {
      ...definition.pages[2],
      sections: [{ ...definition.pages[2].sections[0], visibilityRules: rule('1') }],
    },
  ];
  return definition;
}

/** Reveals an item immediately after an answer, ahead of the debounced state report. */
export function responseVisibilityDefinition() {
  const definition = conditionalVisibilityDefinition();
  const page = definition.pages[1];
  const section = page.sections[0];
  const text = section.elements[0];
  definition.stateVariables = [];
  definition.pages = [
    {
      ...page,
      sections: [
        {
          ...section,
          visibilityRules: [],
          elements: [
            {
              ...text,
              type: 'text-field',
              id: 'gate',
              alias: 'Gate',
              value: '',
              label: 'Item öffnen',
              showSoftwareKeyboard: false,
              hideNativeKeyboard: false,
            } as typeof text,
          ],
        },
        { ...section, visibilityRules: [{ id: 'gate', operator: '=', value: 'open' }] },
      ],
    },
  ];
  return definition;
}

/** A generated silent WAV and a stimulus that stays visible as playback advances. */
export function persistentMediaVisibilityDefinition() {
  const definition = conditionalVisibilityDefinition();
  const page = definition.pages[1];
  const section = page.sections[0];
  const text = section.elements[0];
  const wav = Buffer.alloc(44 + 32000);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(32000, 40);
  definition.stateVariables = [];
  definition.pages = [
    {
      ...page,
      sections: [
        {
          ...section,
          visibilityRules: [],
          elements: [
            {
              ...text,
              type: 'audio',
              id: 'audio',
              alias: 'Audio',
              src: `data:audio/wav;base64,${wav.toString('base64')}`,
              fileName: 'synthetic.wav',
              player: {
                startControl: true,
                pauseControl: true,
                progressBar: true,
                interactiveProgressbar: true,
                defaultVolume: 0,
                minVolume: 0,
                minRuns: 0,
                maxRuns: null,
                loop: false,
                showHint: false,
              },
            } as typeof text,
          ],
        },
        {
          ...section,
          enableReHide: false,
          visibilityRules: [{ id: 'audio', operator: '=', value: '0' }],
          elements: [
            {
              ...text,
              id: 'persistent',
              alias: 'persistent',
              text: '<p>Bleibender Medienstimulus</p>',
            },
          ],
        },
        { ...section, visibilityRules: [{ id: 'audio', operator: '≥', value: '0.5' }] },
      ],
    },
  ];
  return definition;
}
