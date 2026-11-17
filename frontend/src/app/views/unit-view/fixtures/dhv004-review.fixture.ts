/** Structural projection of the original DHV004 from issue #290 (2026-11-17).
 * ASPECT player 2.12.6, VOUD 4.11.0. Original VOUD SHA-256:
 * b38f874b298a38a50680f56cc471881950c310a00f70bc8455494c4a9fbee406
 * Pages, section order, numbering flags, visibility rules and response identifiers are retained.
 * Assets, story/question texts, manual instructions, styling and unrelated metadata are omitted.
 * Only the original 05 coding rules are retained; all variable references remain.
 * Blank coding labels, null item descriptions and the index names are original, not authored numbers.
 */
export const dhv004ReviewFixture = {
  definition: {
    type: 'aspect-unit-definition',
    version: '4.11.0',
    enableSectionNumbering: true,
    sectionNumberingPosition: 'left',
    pages: [
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [],
            elements: [
              {
                id: 'text_1758798317978_1',
                alias: 'text_3',
                type: 'text',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [],
            elements: [
              {
                id: 'audio_1765967220444_1',
                alias: 'audio_00',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765967220444_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1737113098955_1',
                alias: 'text_1',
                type: 'text',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765967220444_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765281300881_1',
                alias: 'audio_01',
                type: 'audio',
              },
              {
                id: 'button_1777450845510_1',
                alias: 'button_3',
                type: 'button',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281300881_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1737113299071_1',
                alias: 'Item_01',
                type: 'text',
              },
              {
                id: 'audio_1765200899057_1',
                alias: 'audio_01a',
                type: 'audio',
              },
              {
                id: 'radio_1737113299071_1',
                alias: '01',
                type: 'radio',
              },
              {
                id: 'audio_1765200925353_1',
                alias: 'audio_01b',
                type: 'audio',
              },
              {
                id: 'audio_1765200954931_1',
                alias: 'audio_01c',
                type: 'audio',
              },
              {
                id: 'audio_1765200977234_1',
                alias: 'audio_01d',
                type: 'audio',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281300881_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765281488705_1',
                alias: 'audio_03',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281488705_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1758799781718_1',
                alias: 'Item_03',
                type: 'text',
              },
              {
                id: 'audio_1765202148653_1',
                alias: 'audio_03a',
                type: 'audio',
              },
              {
                id: 'radio_1758799781718_1',
                alias: '03',
                type: 'radio',
              },
              {
                id: 'audio_1765202171917_1',
                alias: 'audio_03b',
                type: 'audio',
              },
              {
                id: 'audio_1765202192629_1',
                alias: 'audio_03c',
                type: 'audio',
              },
              {
                id: 'audio_1765202214081_1',
                alias: 'audio_03d',
                type: 'audio',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281488705_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765202271911_1',
                alias: 'audio_04',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765202271911_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1764931842910_1',
                alias: 'text_4',
                type: 'text',
              },
              {
                id: 'radio-group-images_1764931842910_1',
                alias: '04',
                type: 'radio-group-images',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765202271911_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765282658084_1',
                alias: 'audio_05',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765282658084_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1758799896053_1',
                alias: 'Item_05',
                type: 'text',
              },
              {
                id: 'audio_1765202381423_1',
                alias: 'audio_05a',
                type: 'audio',
              },
              {
                id: 'radio_1758799896053_1',
                alias: '05',
                type: 'radio',
              },
              {
                id: 'audio_1765202404807_1',
                alias: 'audio_05b',
                type: 'audio',
              },
              {
                id: 'audio_1765202426392_1',
                alias: 'audio_05c',
                type: 'audio',
              },
              {
                id: 'audio_1765202452269_1',
                alias: 'audio_05d',
                type: 'audio',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765282658084_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765281618458_1',
                alias: 'audio_07',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281618458_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1758799940646_1',
                alias: 'Item_07',
                type: 'text',
              },
              {
                id: 'audio_1765202596301_1',
                alias: 'audio_07a',
                type: 'audio',
              },
              {
                id: 'radio_1758799940646_1',
                alias: '07',
                type: 'radio',
              },
              {
                id: 'audio_1765202626388_1',
                alias: 'audio_07b',
                type: 'audio',
              },
              {
                id: 'audio_1765202649515_1',
                alias: 'audio_07c',
                type: 'audio',
              },
              {
                id: 'audio_1765202677822_1',
                alias: 'audio_07d',
                type: 'audio',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281618458_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765203172281_1',
                alias: 'audio_08',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765203172281_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1758799963533_1',
                alias: 'Item_08',
                type: 'text',
              },
              {
                id: 'text-area_1773221483440_1',
                alias: '08',
                type: 'text-area',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765203172281_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765281711904_1',
                alias: 'audio_10',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281711904_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1758800009349_1',
                alias: 'Item_10',
                type: 'text',
              },
              {
                id: 'audio_1765203454523_1',
                alias: 'audio_10a',
                type: 'audio',
              },
              {
                id: 'radio_1758800009349_1',
                alias: '10',
                type: 'radio',
              },
              {
                id: 'audio_1765203479847_1',
                alias: 'audio_10b',
                type: 'audio',
              },
              {
                id: 'audio_1765203499746_1',
                alias: 'audio_10c',
                type: 'audio',
              },
              {
                id: 'audio_1765203520505_1',
                alias: 'audio_10d',
                type: 'audio',
              },
            ],
          },
        ],
      },
      {
        alwaysVisible: false,
        sections: [
          {
            ignoreNumbering: false,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281711904_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'audio_1765281751027_1',
                alias: 'audio_11',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281751027_1',
                operator: '>',
                value: '0',
              },
            ],
            elements: [
              {
                id: 'text_1765203954265_1',
                alias: 'text_5',
                type: 'text',
              },
              {
                id: 'audio_1765203636656_1',
                alias: 'audio_11a',
                type: 'audio',
              },
              {
                id: 'likert_1758800035302_1',
                alias: '_11',
                type: 'likert',
                rows: [
                  {
                    id: 'likert-row_1758800035302_1',
                    alias: '11a',
                    type: 'likert-row',
                  },
                  {
                    id: 'likert-row_1758800035302_2',
                    alias: '11b',
                    type: 'likert-row',
                  },
                  {
                    id: 'likert-row_1758800035302_4',
                    alias: '11c',
                    type: 'likert-row',
                  },
                  {
                    id: 'likert-row_1758800035302_5',
                    alias: '11d',
                    type: 'likert-row',
                  },
                ],
              },
              {
                id: 'audio_1765203812613_1',
                alias: 'audio_11b',
                type: 'audio',
              },
              {
                id: 'audio_1765203891654_1',
                alias: 'audio_11d',
                type: 'audio',
              },
              {
                id: 'audio_1765204058777_1',
                alias: 'audio_11e',
                type: 'audio',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'disjunction',
            visibilityRules: [
              {
                id: 'audio_1765281751027_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: '_outro01',
                alias: '_outro01',
                type: 'text',
              },
              {
                id: '_button01',
                alias: '_button01',
                type: 'button',
              },
            ],
          },
          {
            ignoreNumbering: true,
            logicalConnectiveOfRules: 'conjunction',
            visibilityRules: [
              {
                id: 'audio_1765281751027_1',
                operator: '≥',
                value: '0.99',
              },
            ],
            elements: [
              {
                id: 'cloze_1773738634734_1',
                alias: 'cloze_1',
                type: 'cloze',
              },
            ],
          },
        ],
      },
    ],
  },
  indexItems: [
    {
      id: '01',
      name: '01',
      variableId: '01',
      variableReadOnlyId: 'radio_1737113299071_1',
    },
    {
      id: '03',
      name: '03',
      variableId: '03',
      variableReadOnlyId: 'radio_1758799781718_1',
    },
    {
      id: '04',
      name: '04',
      variableId: '04',
      variableReadOnlyId: 'radio-group-images_1764931842910_1',
    },
    {
      id: '05',
      name: '05',
      variableId: '05',
      variableReadOnlyId: 'radio_1758799896053_1',
    },
    {
      id: '07',
      name: '07',
      variableId: '07',
      variableReadOnlyId: 'radio_1758799940646_1',
    },
    {
      id: '08',
      name: '08',
      variableId: '08',
      variableReadOnlyId: 'text-area_1773221483440_1',
    },
    {
      id: '10',
      name: '10',
      variableId: '10',
      variableReadOnlyId: 'radio_1758800009349_1',
    },
    {
      id: '11',
      name: '11',
      variableId: '11',
      variableReadOnlyId: 'd_1773221807478',
    },
  ],
  metadataItems: [
    {
      id: '01',
      description: null,
      variableId: '01',
      variableReadOnlyId: 'radio_1737113299071_1',
    },
    {
      id: '03',
      description: null,
      variableId: '03',
      variableReadOnlyId: 'radio_1758799781718_1',
    },
    {
      id: '04',
      description: null,
      variableId: '04',
      variableReadOnlyId: 'radio-group-images_1764931842910_1',
    },
    {
      id: '05',
      description: null,
      variableId: '05',
      variableReadOnlyId: 'radio_1758799896053_1',
    },
    {
      id: '07',
      description: null,
      variableId: '07',
      variableReadOnlyId: 'radio_1758799940646_1',
    },
    {
      id: '08',
      description: null,
      variableId: '08',
      variableReadOnlyId: 'text-area_1773221483440_1',
    },
    {
      id: '10',
      description: null,
      variableId: '10',
      variableReadOnlyId: 'radio_1758800009349_1',
    },
    {
      id: '11',
      description: null,
      variableId: '11',
      variableReadOnlyId: 'd_1773221807478',
    },
  ],
  codingScheme: {
    variableCodings: [
      {
        id: 'radio_1758799896053_1',
        alias: '05',
        label: '',
        sourceType: 'BASE',
        deriveSources: [],
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            label: '',
            score: 1,
            ruleSetOperatorAnd: true,
            ruleSets: [
              {
                ruleOperatorAnd: false,
                rules: [
                  {
                    method: 'MATCH',
                    parameters: ['2'],
                  },
                ],
              },
            ],
          },
          {
            id: 0,
            type: 'RESIDUAL_AUTO',
            label: '',
            score: 0,
            ruleSetOperatorAnd: true,
            ruleSets: [],
          },
        ],
      },
    ],
  },
  variables: [
    {
      id: 'radio_1737113299071_1',
      alias: '01',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'radio_1758799781718_1',
      alias: '03',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'radio_1758799896053_1',
      alias: '05',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'radio_1758799940646_1',
      alias: '07',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'radio_1758800009349_1',
      alias: '10',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'likert-row_1758800035302_1',
      alias: '11a',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'likert-row_1758800035302_2',
      alias: '11b',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'likert-row_1758800035302_4',
      alias: '11c',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'likert-row_1758800035302_5',
      alias: '11d',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'radio-group-images_1764931842910_1',
      alias: '04',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'text-area_1773221483440_1',
      alias: '08',
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
    },
    {
      id: 'd_1773221807478',
      alias: '11',
      label: '',
      sourceType: 'SUM_SCORE',
      deriveSources: [
        'likert-row_1758800035302_1',
        'likert-row_1758800035302_2',
        'likert-row_1758800035302_4',
        'likert-row_1758800035302_5',
      ],
    },
  ],
};
