import { describe, expect, it } from 'vitest';
import { readReviewTaskNumbers, type ReviewTaskVariable } from './review-task-numbers';
import { buildReviewCodingLabels } from './review-coding-labels';
import { dhv004ReviewFixture } from './fixtures/dhv004-review.fixture';

const answer = { id: 'response', alias: '05', sourceType: 'BASE' };
const element = { id: 'response', alias: '05', type: 'radio' };

function numbered(elements: unknown[], ignoreNumbering = false, visibilityRules: unknown[] = []) {
  return { elements, ignoreNumbering, visibilityRules };
}

function unit(sections = [numbered([element])]) {
  return {
    type: 'aspect-unit-definition',
    version: '4.11.0',
    enableSectionNumbering: true,
    pages: [{ alwaysVisible: false, sections }],
  };
}

function audioTask() {
  return unit([
    numbered([{ id: 'audio', type: 'audio' }]),
    numbered([element], true, [{ id: 'audio', operator: '>', value: '0' }]),
  ]);
}

describe('readReviewTaskNumbers', () => {
  it('resolves original #290 data to 4. despite null VOMD descriptions and blank coding labels', () => {
    const { definition, variables, indexItems, metadataItems } = dhv004ReviewFixture;
    const raw = JSON.stringify(definition);
    const before = JSON.stringify(dhv004ReviewFixture);
    const numbers = readReviewTaskNumbers(raw, variables);
    expect(numbers.get('05')).toBe('4.');
    expect(numbers.get('03')).toBe('2.');
    expect(numbers.get('11a')).toBe('8.');
    expect(numbers.get('11')).toBe('8.');
    expect(
      buildReviewCodingLabels(variables, indexItems, metadataItems, numbers).get('05'),
    ).toEqual({ title: '4.', subtitle: '' });
    expect(JSON.stringify(dhv004ReviewFixture)).toBe(before);
    expect(raw).toBe(JSON.stringify(definition));
  });

  it.each(['4.6.0', '4.7.0', '4.8.0', '4.9.0', '4.10.0', '4.11.0', '4.12.0'])(
    'supports the automatic counter of definition %s (ASPECT 2.5–2.12 and 3.0)',
    (version) => {
      const definition = { ...audioTask(), version };
      const variable: ReviewTaskVariable = version === '4.6.0' ? { id: element.id } : answer;
      expect(
        readReviewTaskNumbers(JSON.stringify(definition), [variable]).get(
          variable.alias || variable.id,
        ),
      ).toBe('1.');
    },
  );

  it.each(['4.4.0', '4.5.0', '4.13.0', '5.0.0', '4.11', '4.11.1', ''])(
    'does not extrapolate format %s',
    (version) => {
      expect(
        readReviewTaskNumbers(JSON.stringify({ ...audioTask(), version }), [answer]).size,
      ).toBe(0);
    },
  );

  it('counts hidden numbered sections and skips fixed stimulus pages and excluded sections', () => {
    const definition = unit();
    definition.pages.unshift({
      alwaysVisible: true,
      sections: [numbered([{ id: 'fixed', type: 'text' }])],
    });
    definition.pages[1].sections.unshift(
      numbered([], true),
      numbered([], false, [{ id: 'never', operator: '=', value: '0' }]),
    );
    expect(readReviewTaskNumbers(JSON.stringify(definition), [answer]).get('05')).toBe('2.');
  });

  it.each(['4.6.0', '4.7.0', '4.8.0', '4.9.0', '4.10.0', '4.11.0', '4.12.0'])(
    'counts fixed sections in document order only in print mode (%s)',
    (version) => {
      const response = (id: string) => ({
        id,
        alias: id,
        type: 'radio',
        isRelevantForPresentationComplete: true,
      });
      const definition = {
        ...unit(),
        version,
        pages: [
          { sections: [numbered([response('first')])] },
          {
            alwaysVisible: true,
            sections: [numbered([], true), numbered([response('fixed')])],
          },
          { sections: [numbered([response('last')])] },
        ],
      };
      const variables = [
        { id: 'first' },
        { id: 'fixed' },
        { id: 'last' },
        { id: 'derived', sourceType: 'COPY_VALUE', deriveSources: ['last'] },
      ];
      const raw = JSON.stringify(definition);
      expect([...readReviewTaskNumbers(raw, variables)]).toEqual([
        ['first', '1.'],
        ['last', '2.'],
        ['derived', '2.'],
      ]);
      expect([...readReviewTaskNumbers(raw, variables, true)]).toEqual([
        ['first', '1.'],
        ['fixed', '2.'],
        ['last', '3.'],
        ['derived', '3.'],
      ]);
      expect(JSON.stringify(definition)).toBe(raw);
    },
  );

  it.each(['4.7.0', '4.11.0', '4.12.0'])(
    'rejects state-variable alias and canonical-ID conflicts, including derived codings (%s)',
    (version) => {
      for (const state of [
        { id: 'state', alias: '05', value: '0' },
        { id: 'response', alias: 'STATE', value: '0' },
        { id: '05', value: '0' },
      ]) {
        const definition = { ...unit(), version, stateVariables: [state] };
        const variables = [
          answer,
          { id: 'derived', sourceType: 'COPY_VALUE', deriveSources: ['response'] },
        ];
        for (const printMode of [false, true]) {
          expect(readReviewTaskNumbers(JSON.stringify(definition), variables, printMode).size).toBe(
            0,
          );
        }
      }
    },
  );

  it.each(['4.6.0', '4.7.0', '4.11.0', '4.12.0'])(
    'keeps state aliases version-specific and never assigns state variables a section (%s)',
    (version) => {
      const definition = {
        ...unit([numbered([{ ...element, id: '05', isRelevantForPresentationComplete: true }])]),
        version,
        stateVariables: [{ id: 'state', alias: '', value: '0' }],
      };
      expect([
        ...readReviewTaskNumbers(JSON.stringify(definition), [{ id: '05' }, { id: 'state' }]),
      ]).toEqual([['05', '1.']]);
      definition.stateVariables[0].alias = '05';
      expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: '05' }]).get('05')).toBe(
        version === '4.6.0' ? '1.' : undefined,
      );
      definition.stateVariables = [{ id: '05', alias: 'STATE', value: '0' }];
      expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: '05' }]).size).toBe(0);
    },
  );

  it.each([
    {
      name: 'only adjacency',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections[1].visibilityRules = [];
      },
    },
    {
      name: 'another numbered section',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections.push(numbered([]));
      },
    },
    {
      name: 'unknown visibility reference',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections[1].visibilityRules = [{ id: 'other', operator: '>', value: '0' }];
      },
    },
    {
      name: 'multiple visibility rules',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections[1].visibilityRules.push({ id: 'audio', operator: '>', value: '0' });
      },
    },
    {
      name: 'a textual header',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections[0].elements = [{ id: 'audio', type: 'text', text: '4.' }];
      },
    },
    {
      name: 'an unidentifiable text element in the header',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections[0].elements.push({ type: 'text', text: 'Another question' });
      },
    },
    {
      name: 'a non-adjacent header',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections.splice(1, 0, numbered([], true));
      },
    },
    {
      name: 'duplicate audio IDs',
      edit: (value: ReturnType<typeof audioTask>) => {
        value.pages[0].sections[0].elements.push({ id: 'audio', type: 'audio' });
      },
    },
  ])('does not infer a number from $name', ({ edit }) => {
    const definition = audioTask();
    edit(definition);
    expect(readReviewTaskNumbers(JSON.stringify(definition), [answer]).size).toBe(0);
  });

  it('does not carry a number from another page or parse rich text headings', () => {
    const definition = audioTask();
    const target = definition.pages[0].sections.pop()!;
    definition.pages.push({ alwaysVisible: false, sections: [target] });
    expect(readReviewTaskNumbers(JSON.stringify(definition), [answer]).size).toBe(0);
    expect(
      readReviewTaskNumbers(
        JSON.stringify(unit([numbered([{ type: 'text', text: '<b>4.</b>' }, element], true)])),
        [answer],
      ).size,
    ).toBe(0);
  });

  it('keeps canonical-ID and alias namespaces distinct, and refuses duplicate targets', () => {
    const definition = unit([
      numbered([element]),
      numbered([{ id: 'other', alias: 'response', type: 'radio' }]),
    ]);
    const variables = [answer, { id: 'other', alias: 'response', sourceType: 'BASE' }];
    expect([...readReviewTaskNumbers(JSON.stringify(definition), variables)]).toEqual([
      ['05', '1.'],
      ['response', '2.'],
    ]);
    definition.pages[0].sections[1].elements = [element];
    expect(readReviewTaskNumbers(JSON.stringify(definition), [answer]).size).toBe(0);
  });

  it('supports legacy alias references and nested Likert rows without treating visibility rules as targets', () => {
    const definition = unit([numbered([{ id: 'parent', type: 'likert', rows: [element] }])]);
    expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: '05' }]).get('05')).toBe('1.');
    expect(readReviewTaskNumbers(JSON.stringify(audioTask()), [{ id: 'not-a-target' }]).size).toBe(
      0,
    );
  });

  it('does not replace a stale canonical ID with an alias or publish duplicate output aliases', () => {
    const definition = JSON.stringify(unit());
    expect(readReviewTaskNumbers(definition, [{ ...answer, id: 'missing' }]).size).toBe(0);
    expect(readReviewTaskNumbers(definition, [answer, { ...answer, id: 'other' }]).size).toBe(0);
  });

  it('rejects conflicting canonical IDs and public aliases, including dependent codings', () => {
    const definition = unit([
      numbered([{ id: 'A', alias: 'X', type: 'radio' }]),
      numbered([{ id: 'B', alias: 'Y', type: 'radio' }]),
    ]);
    const variables = [
      { id: 'A', alias: 'Y', sourceType: 'BASE' },
      { id: 'sum', sourceType: 'COPY_VALUE', deriveSources: ['A'] },
    ];
    expect(readReviewTaskNumbers(JSON.stringify(definition), variables).size).toBe(0);
    // An alias that is not present in the VOUD cannot confirm the canonical target either.
    expect(
      readReviewTaskNumbers(JSON.stringify(definition), [
        { id: 'A', alias: 'missing', sourceType: 'BASE' },
      ]).size,
    ).toBe(0);
  });

  it.each([true, false])(
    'rejects duplicate VOUD aliases even with unique IDs (same section: %s)',
    (sameSection) => {
      const first = { id: 'A', alias: 'X', type: 'radio' };
      const second = { id: 'B', alias: 'X', type: 'radio' };
      const definition = unit(
        sameSection ? [numbered([first, second])] : [numbered([first]), numbered([second])],
      );
      const variables = [
        { id: 'A', alias: 'X', sourceType: 'BASE' },
        { id: 'derived', sourceType: 'COPY_VALUE', deriveSources: ['A'] },
      ];
      expect(readReviewTaskNumbers(JSON.stringify(definition), variables).size).toBe(0);
      expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: 'X' }]).size).toBe(0);
    },
  );

  it('does not let derived codings bypass duplicate coding aliases or canonical IDs', () => {
    const definition = JSON.stringify(unit([numbered([{ id: 'A', alias: 'X', type: 'radio' }])]));
    for (const duplicate of [
      { id: 'B', alias: 'X', sourceType: 'BASE' },
      { id: 'A', alias: 'Y', sourceType: 'BASE' },
    ]) {
      const variables = [
        { id: 'A', alias: 'X', sourceType: 'BASE' },
        duplicate,
        { id: 'derived', sourceType: 'COPY_VALUE', deriveSources: ['A'] },
      ];
      expect(readReviewTaskNumbers(definition, variables).size).toBe(0);
    }
  });

  it('keeps the default ID-as-alias and the unique legacy public-ID lookup', () => {
    const definition = unit([
      numbered([{ id: 'A', type: 'radio', isRelevantForPresentationComplete: true }]),
      numbered([element]),
    ]);
    expect([
      ...readReviewTaskNumbers(JSON.stringify(definition), [{ id: 'A' }, { id: '05' }]),
    ]).toEqual([
      ['A', '1.'],
      ['05', '2.'],
    ]);
    definition.pages[0].sections.push(numbered([{ id: 'B', alias: 'A', type: 'radio' }]));
    expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: 'A' }]).size).toBe(0);
  });

  const formats = ['4.6.0', '4.7.0', '4.8.0', '4.9.0', '4.10.0', '4.11.0', '4.12.0'];

  it.each(formats)('includes implicitly typed Likert rows in conflict checks (%s)', (version) => {
    const legacy = version === '4.6.0';
    const first = { ...element, id: legacy ? '05' : 'response' };
    const row = { id: legacy ? '05' : 'row', alias: '05' };
    const definition = {
      ...unit([
        numbered([first]),
        numbered([{ id: 'table', type: 'table', elements: [{ type: 'likert', rows: [row] }] }]),
      ]),
      version,
    };
    const variables = [
      { ...answer, id: first.id },
      { id: 'derived', sourceType: 'COPY_VALUE', deriveSources: [first.id] },
    ];
    const before = JSON.stringify(definition);
    expect(readReviewTaskNumbers(before, variables).size).toBe(0);
    expect(JSON.stringify(definition)).toBe(before);
    definition.pages[0].sections.shift();
    expect(
      readReviewTaskNumbers(JSON.stringify(definition), [{ id: row.id, alias: '05' }]).get('05'),
    ).toBe('1.');
  });

  it.each(['4.7.0', '4.8.0', '4.9.0', '4.10.0', '4.11.0'])(
    'checks the effective alias of complete ASPECT 2.x models (%s)',
    (version) => {
      const fallback = {
        id: '05',
        alias: '',
        type: 'radio',
        isRelevantForPresentationComplete: true,
      };
      const definition = { ...unit([numbered([element]), numbered([fallback])]), version };
      expect(readReviewTaskNumbers(JSON.stringify(definition), [answer]).size).toBe(0);
      definition.pages[0].sections.shift();
      expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: '05' }]).get('05')).toBe(
        '1.',
      );
    },
  );

  it('distinguishes legacy IDs, incomplete 2.x models and 3.x empty aliases', () => {
    const fallback = { id: '05', alias: '', type: 'radio' };
    for (const version of ['4.11.0', '4.12.0']) {
      const definition = { ...unit([numbered([fallback])]), version };
      expect(readReviewTaskNumbers(JSON.stringify(definition), [{ id: '05' }]).size).toBe(0);
    }
    const modern = {
      ...unit([numbered([{ ...fallback, isRelevantForPresentationComplete: true }])]),
      version: '4.12.0',
    };
    expect(readReviewTaskNumbers(JSON.stringify(modern), [{ id: '05' }]).size).toBe(0);
    const incomplete = unit([numbered([{ id: '05', type: 'radio' }])]);
    expect(readReviewTaskNumbers(JSON.stringify(incomplete), [{ id: '05' }]).size).toBe(0);
    incomplete.version = '4.12.0';
    expect(readReviewTaskNumbers(JSON.stringify(incomplete), [{ id: '05' }]).get('05')).toBe('1.');
    const legacy = { ...unit([numbered([element])]), version: '4.6.0' };
    expect(readReviewTaskNumbers(JSON.stringify(legacy), [answer]).size).toBe(0);
    expect(
      readReviewTaskNumbers(JSON.stringify(legacy), [{ id: element.id }]).get(element.id),
    ).toBe('1.');
  });

  it.each(formats)('includes generated geometry responses and their conflicts (%s)', (version) => {
    const legacy = version === '4.6.0';
    const objectVariables = ['4.10.0', '4.11.0', '4.12.0'].includes(version);
    const geometry = {
      id: 'g',
      alias: 'G',
      type: 'geometry',
      trackedVariables: objectVariables ? [{ id: 'x', value: '' }] : ['x'],
      trackedExpectedVariables: objectVariables
        ? [
            { id: 'x', value: '' },
            { id: 'y', value: '' },
          ]
        : [],
    };
    const key = legacy ? 'g_x' : 'G_x';
    const other = { ...element, id: legacy ? key : 'response', alias: key };
    const definition = {
      ...unit([
        numbered([other]),
        numbered([{ id: 'table', type: 'table', elements: [geometry] }]),
      ]),
      version,
    };
    const variables = [
      { id: other.id, alias: key, sourceType: 'BASE' },
      { id: 'derived', sourceType: 'COPY_VALUE', deriveSources: [other.id] },
    ];
    expect(readReviewTaskNumbers(JSON.stringify(definition), variables).size).toBe(0);
    definition.pages[0].sections.shift();
    const numbers = readReviewTaskNumbers(JSON.stringify(definition), [
      { id: 'g_x', alias: key },
      { id: 'g_y', alias: legacy ? 'g_y' : 'G_y' },
    ]);
    expect(numbers.get(key)).toBe('1.');
    expect(numbers.get(legacy ? 'g_y' : 'G_y')).toBe(objectVariables ? '1.' : undefined);
  });

  it('detects generated geometry ID collisions as well as aliases', () => {
    const definition = unit([
      numbered([{ id: 'g_x', alias: '05', type: 'radio' }]),
      numbered([
        { id: 'g', alias: 'G', type: 'geometry', trackedVariables: [{ id: 'x', value: '' }] },
      ]),
    ]);
    expect(
      readReviewTaskNumbers(JSON.stringify(definition), [{ id: 'g_x', alias: '05' }]).size,
    ).toBe(0);
  });

  it('accepts legacy tracked-variable strings since 2.11, but never guesses malformed geometry identities', () => {
    const geometry = { id: 'g', alias: 'G', type: 'geometry', trackedVariables: ['x', 'x'] };
    const definition = unit([numbered([geometry])]);
    expect(
      readReviewTaskNumbers(JSON.stringify(definition), [{ id: 'g_x', alias: 'G_x' }]).get('G_x'),
    ).toBe('1.');
    for (const trackedVariables of [[{ unexpected: 'x' }], ['x', { id: 'y' }], 'x']) {
      const malformed = unit([numbered([element, { ...geometry, trackedVariables }])]);
      expect(readReviewTaskNumbers(JSON.stringify(malformed), [answer]).size).toBe(0);
    }
    const old = {
      ...unit([numbered([element, { ...geometry, trackedVariables: [{ id: 'x' }] }])]),
      version: '4.9.0',
    };
    expect(readReviewTaskNumbers(JSON.stringify(old), [answer]).size).toBe(0);
  });

  function clozeField(kind: string, model: { id: string; alias: string; type: string }) {
    return {
      id: 'cloze',
      type: 'cloze',
      document: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: kind, attrs: { model } }] }],
      },
    };
  }

  it.each(['4.6.0', '4.7.0', '4.8.0', '4.9.0', '4.10.0', '4.11.0', '4.12.0'])(
    'recognizes the actual Checkbox model in definition %s',
    (version) => {
      const checkbox = { id: 'check', alias: '05', type: 'checkbox' };
      const definition = { ...unit([numbered([clozeField('Checkbox', checkbox)])]), version };
      const variable =
        version === '4.6.0' ? { id: 'check' } : { id: 'check', alias: '05', sourceType: 'BASE' };
      expect(
        readReviewTaskNumbers(JSON.stringify(definition), [variable]).get(
          variable.alias || variable.id,
        ),
      ).toBe('1.');
    },
  );

  it.each(['4.6.0', '4.11.0'])(
    'includes 2.x Checkbox fields when checking alias ambiguity (%s)',
    (version) => {
      const legacy = version === '4.6.0';
      const definition = {
        ...unit([
          numbered([{ ...element, id: legacy ? '05' : element.id }]),
          numbered([
            clozeField('Checkbox', { id: legacy ? '05' : 'check', alias: '05', type: 'checkbox' }),
          ]),
        ]),
        version,
      };
      expect(
        readReviewTaskNumbers(JSON.stringify(definition), [legacy ? { id: '05' } : answer]).size,
      ).toBe(0);
    },
  );

  it.each(['deep document', 'missing parent ID', 'missing child ID', 'custom node children'])(
    'does not hide an alias collision in %s',
    (shape) => {
      const child = {
        type: 'Checkbox',
        attrs: {
          model: {
            id: shape === 'missing child ID' ? undefined : 'check',
            alias: '05',
            type: 'checkbox',
          },
        },
      };
      let content: unknown[] = [child];
      if (shape === 'deep document') {
        for (let i = 0; i < 110; i++) content = [{ type: 'blockquote', content }];
      } else if (shape === 'custom node children') {
        content = [
          {
            type: 'Button',
            attrs: { model: { id: 'button', alias: 'button', type: 'button' } },
            content,
          },
        ];
      }
      const cloze = {
        id: shape === 'missing parent ID' ? undefined : 'cloze',
        type: 'cloze',
        document: { type: 'doc', content },
      };
      const definition = unit([numbered([element]), numbered([cloze])]);
      expect(readReviewTaskNumbers(JSON.stringify(definition), [answer]).size).toBe(0);
    },
  );

  it.each(['4.6.0', '4.7.0', '4.8.0', '4.9.0', '4.10.0', '4.11.0', '4.12.0'])(
    'applies the version-specific Dropdown node boundary for %s',
    (version) => {
      const dropdown = { id: 'select', alias: '05', type: 'dropdown' };
      const definition = { ...unit([numbered([clozeField('Dropdown', dropdown)])]), version };
      const numbers = readReviewTaskNumbers(JSON.stringify(definition), [
        { id: 'select', alias: '05', sourceType: 'BASE' },
      ]);
      expect(numbers.get('05')).toBe(version === '4.12.0' ? '1.' : undefined);
    },
  );

  it('reads actual table/cloze models but ignores matching IDs in options and arbitrary metadata', () => {
    const cloze = {
      id: 'cloze',
      type: 'cloze',
      document: {
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'TextField', attrs: { model: { ...element, type: 'text-field-simple' } } },
            ],
          },
        ],
      },
    };
    const actual = unit([numbered([{ id: 'table', type: 'table', elements: [cloze] }])]);
    expect(readReviewTaskNumbers(JSON.stringify(actual), [answer]).get('05')).toBe('1.');
    const unrelated = unit([
      numbered([{ id: 'text', type: 'text', metadata: element, options: [element] }]),
    ]);
    expect(readReviewTaskNumbers(JSON.stringify(unrelated), [answer]).size).toBe(0);
  });

  it('resolves derived variables only when every source has the same unambiguous number', () => {
    const definition = unit([
      numbered([element, { ...element, id: 'second', alias: 'B' }]),
      numbered([{ ...element, id: 'third', alias: 'C' }]),
    ]);
    const variables: ReviewTaskVariable[] = [
      answer,
      { id: 'second', alias: 'B', sourceType: 'BASE' },
      { id: 'third', alias: 'C', sourceType: 'BASE' },
      { id: 'sum', sourceType: 'SUM_SCORE', deriveSources: ['response', 'second'] },
      { id: 'mixed', sourceType: 'SUM_SCORE', deriveSources: ['response', 'third'] },
      { id: 'missing', sourceType: 'SUM_SCORE', deriveSources: ['response', 'unknown'] },
      { id: 'cycle', sourceType: 'COPY_VALUE', deriveSources: ['cycle'] },
    ];
    const numbers = readReviewTaskNumbers(JSON.stringify(definition), variables);
    expect(numbers.get('sum')).toBe('1.');
    expect(numbers.has('mixed')).toBe(false);
    expect(numbers.has('missing')).toBe(false);
    expect(numbers.has('cycle')).toBe(false);
  });

  it.each([
    null,
    'invalid',
    '{}',
    JSON.stringify({ ...unit(), type: 'other' }),
    JSON.stringify({ ...unit(), enableSectionNumbering: false }),
    JSON.stringify({ ...unit(), pages: [{ sections: [{}] }] }),
    JSON.stringify({ ...unit(), pages: [{ alwaysVisible: 'false', sections: [] }] }),
  ])('ignores disabled, foreign or malformed definitions: %s', (definition) => {
    expect(readReviewTaskNumbers(definition, [answer]).size).toBe(0);
  });
});
