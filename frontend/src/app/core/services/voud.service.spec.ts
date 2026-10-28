import { describe, expect, it } from 'vitest';
import { VoudService } from './voud.service';

describe('VoudService.getStartPage', () => {
  const service = new VoudService();

  it('returns the matching page index for an exact variable id', () => {
    const definition = JSON.stringify({
      pages: [{ widgets: [{ id: 'DHB00101' }] }, { widgets: [{ id: 'DHB00102' }] }],
    });

    expect(service.getStartPage(definition, 'DHB00102')).toBe(1);
  });

  it('matches variable ids robustly with trim and case-insensitive fallback', () => {
    const definition = JSON.stringify({
      pages: [{ widgets: [{ id: 'DHB00101' }] }, { widgets: [{ id: '  DHB00103  ' }] }],
    });

    expect(service.getStartPage(definition, 'dhb00103')).toBe(1);
  });

  it('keeps the absolute page index when the first page already contains item aliases', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [{ elements: [{ alias: 'A1', id: 'page-a-0' }] }],
        },
        {
          sections: [{ elements: [{ alias: 'B1', id: 'page-b-0' }] }],
        },
      ],
    });

    expect(service.getStartPage(definition, 'b1')).toBe(1);
  });

  it('maps alias-based targets into the scroll-page index space', () => {
    const definition = JSON.stringify({
      pages: [
        {
          alwaysVisible: true,
          sections: [{ elements: [{ id: 'cover-text' }, { id: 'cover-image' }] }],
        },
        {
          sections: [{ elements: [{ alias: 'A1', id: 'page-a-1' }] }],
        },
        {
          sections: [{ elements: [{ alias: 'B2', id: 'page-b-2' }] }],
        },
      ],
    });

    expect(service.getStartPage(definition, 'b2')).toBe(1);
  });

  it('maps id-based targets into the scroll-page index space too', () => {
    const definition = JSON.stringify({
      pages: [
        {
          alwaysVisible: true,
          sections: [{ elements: [{ id: 'cover-text' }, { id: 'cover-image' }] }],
        },
        {
          sections: [{ elements: [{ alias: 'A1', id: 'field-a-1' }] }],
        },
        {
          sections: [{ elements: [{ alias: 'B2', id: 'field-b-2' }] }],
        },
      ],
    });

    expect(service.getStartPage(definition, 'field-b-2')).toBe(1);
  });

  it('prefers a matching alias over an earlier unrelated element id', () => {
    const definition = JSON.stringify({
      pages: [
        { sections: [{ elements: [{ id: '07', alias: '04' }] }] },
        { sections: [{ elements: [{ id: '11', alias: '07' }] }] },
      ],
    });

    expect(service.resolvePlayerTargetLocation(definition, '07')).toEqual({
      absolutePageIndex: 1,
      scrollPageIndex: 1,
      isAlwaysVisiblePage: false,
    });
  });

  it('returns undefined for targets on always-visible pages', () => {
    const definition = JSON.stringify({
      pages: [
        {
          alwaysVisible: true,
          sections: [{ elements: [{ alias: 'INTRO', id: 'cover-text' }] }],
        },
        {
          sections: [{ elements: [{ alias: 'A1', id: 'page-a-1' }] }],
        },
      ],
    });

    expect(service.resolvePlayerTargetLocation(definition, 'INTRO')).toEqual({
      absolutePageIndex: 0,
      scrollPageIndex: undefined,
      isAlwaysVisiblePage: true,
    });
    expect(service.getStartPage(definition, 'INTRO')).toBeUndefined();
  });
});

describe('VoudService.getFocusIdentifiers', () => {
  const service = new VoudService();

  it('returns both alias and id for a matching element', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [{ elements: [{ alias: 'A1', id: 'text-field-1' }] }],
        },
      ],
    });

    expect(service.getFocusIdentifiers(definition, 'A1')).toEqual(['A1', 'text-field-1']);
  });

  it('maps a stored element id back to the alias of the same node', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [
            {
              elements: [{ alias: '02a', id: 'text_1764855140992_1' }],
            },
          ],
        },
      ],
    });

    expect(service.getFocusIdentifiers(definition, 'text_1764855140992_1')).toEqual([
      'text_1764855140992_1',
      '02a',
    ]);
  });

  it('keeps equivalent identifiers on the alias-matched node during id collisions', () => {
    const definition = JSON.stringify({
      pages: [
        { sections: [{ elements: [{ id: '07', alias: '04' }] }] },
        { sections: [{ elements: [{ id: '11', alias: '07' }] }] },
      ],
    });

    expect(service.getFocusIdentifiers(definition, '07')).toEqual(['07', '11']);
  });

  it('matches identifiers case-insensitively and trims values', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [{ elements: [{ alias: '  DhB00102  ', id: 'text-field-2' }] }],
        },
      ],
    });

    expect(service.getFocusIdentifiers(definition, 'dhb00102')).toEqual(
      expect.arrayContaining(['dhb00102', 'DhB00102', 'text-field-2']),
    );
  });

  it('ignores visibility rule references when resolving identifiers', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [
            {
              visibilityRules: [{ id: 'RULE_TARGET' }],
              elements: [{ alias: 'visible-target', id: 'text-field-3' }],
            },
          ],
        },
      ],
    });

    expect(service.getFocusIdentifiers(definition, 'RULE_TARGET')).toEqual(['RULE_TARGET']);
    expect(service.getFocusIdentifiers(definition, 'visible-target')).toEqual([
      'visible-target',
      'text-field-3',
    ]);
  });
});

describe('VoudService.resolvePlayerResponseTarget', () => {
  const service = new VoudService();

  it('returns the alias used by Aspect response states and the element type', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [
            {
              elements: [
                {
                  id: 'radio_1',
                  alias: 'A1',
                  type: 'radio',
                  label: [{ lang: 'de', value: '<strong>Lieblingsfarbe</strong>' }],
                  options: [{ text: 'Rot' }, { text: '<em>Blau</em>' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(service.resolvePlayerResponseTarget(definition, 'radio_1')).toEqual({
      responseId: 'A1',
      elementType: 'radio',
      identifiers: ['radio_1', 'A1'],
      optionCount: 2,
      label: 'Lieblingsfarbe',
      options: [
        { position: 1, label: 'Rot' },
        { position: 2, label: 'Blau' },
      ],
    });
  });

  it('uses safe ordinal labels when options contain no readable text', () => {
    const definition = JSON.stringify({
      pages: [
        {
          elements: [
            {
              id: 'images',
              type: 'radio-group-images',
              options: [{ image: 'a.png' }, { image: 'b.png' }],
            },
          ],
        },
      ],
    });

    expect(service.resolvePlayerResponseTarget(definition, 'images')?.options).toEqual([
      { position: 1, label: 'Option 1' },
      { position: 2, label: 'Option 2' },
    ]);
  });

  it('falls back to the internal id when the element has no alias', () => {
    const definition = JSON.stringify({
      pages: [{ elements: [{ id: 'checkbox_1', type: 'checkbox' }] }],
    });

    expect(service.resolvePlayerResponseTarget(definition, 'checkbox_1')).toEqual({
      responseId: 'checkbox_1',
      elementType: 'checkbox',
      identifiers: ['checkbox_1'],
    });
  });

  it('does not treat references in visibility rules as response targets', () => {
    const definition = JSON.stringify({
      pages: [
        {
          visibilityRules: [{ id: 'RULE_ONLY' }],
          elements: [{ id: 'field_1', alias: 'A1', type: 'text-field' }],
        },
      ],
    });

    expect(service.resolvePlayerResponseTarget(definition, 'RULE_ONLY')).toBeUndefined();
  });
});

describe('VoudService.stripConditionalVisibility', () => {
  const service = new VoudService();

  it('removes section-level visibility controls for preview rendering', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [
            {
              activeAfterID: 'legacy-trigger',
              activeAfterIdDelay: 250,
              visibilityRules: [{ id: 'RULE_TARGET', operator: '=', value: '1' }],
              visibilityDelay: 500,
              animatedVisibility: true,
              enableReHide: true,
              logicalConnectiveOfRules: 'conjunction',
              elements: [{ alias: 'A1', id: 'field-1' }],
            },
          ],
        },
      ],
    });

    const sanitized = JSON.parse(service.stripConditionalVisibility(definition));
    const section = sanitized.pages[0].sections[0];

    expect(section).toMatchObject({
      activeAfterID: '',
      activeAfterIdDelay: 0,
      visibilityRules: [],
      visibilityDelay: 0,
      animatedVisibility: false,
      enableReHide: false,
      logicalConnectiveOfRules: 'disjunction',
    });
    expect(section.elements[0]).toMatchObject({ alias: 'A1', id: 'field-1' });
  });

  it('removes legacy media dependencies but keeps unrelated player settings', () => {
    const definition = JSON.stringify({
      pages: [
        {
          sections: [
            {
              elements: [
                {
                  alias: 'AUDIO_1',
                  id: 'audio-1',
                  player: {
                    activeAfter: 'legacy-audio',
                    activeAfterID: 'audio-0',
                    startControl: true,
                    showRestRuns: true,
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const sanitized = JSON.parse(service.stripConditionalVisibility(definition));
    const player = sanitized.pages[0].sections[0].elements[0].player;

    expect(player).toMatchObject({
      activeAfter: '',
      activeAfterID: '',
      startControl: true,
      showRestRuns: true,
    });
  });
});

describe('VoudService compound response targets', () => {
  const service = new VoudService();
  it('uses the containing Likert table options and the row text', () => {
    const definition = JSON.stringify({
      pages: [
        {
          elements: [
            {
              type: 'likert',
              options: [{ text: 'stimmt' }, { text: '<p>stimmt nicht</p>' }],
              rows: [
                {
                  type: 'likert-row',
                  id: 'internal',
                  alias: 'A',
                  label: 'Beschriftung',
                  rowLabel: { text: '<span>Buchdruck</span>' },
                  columnCount: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(service.resolvePlayerResponseTarget(definition, 'A')).toMatchObject({
      responseId: 'A',
      elementType: 'likert-row',
      label: 'Buchdruck',
      optionCount: 2,
      options: [
        { position: 1, label: 'stimmt' },
        { position: 2, label: 'stimmt nicht' },
      ],
    });
  });
  it('does not guess columns for orphaned or inconsistent Likert rows', () => {
    const row = { type: 'likert-row', id: 'A', columnCount: 3 };
    for (const elements of [[row], [{ type: 'likert', options: ['yes', 'no'], rows: [row] }]]) {
      const target = service.resolvePlayerResponseTarget(
        JSON.stringify({ pages: [{ elements }] }),
        'A',
      );
      expect(target).toMatchObject({ responseId: 'A', elementType: 'likert-row' });
      expect(target?.optionCount).toBeUndefined();
    }
  });
});
