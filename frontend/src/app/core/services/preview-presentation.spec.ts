import { describe, expect, it } from 'vitest';
import {
  preparePreviewPresentation,
  previewDefinitionKey,
  readPreviewContext,
} from './preview-presentation';

const rule = (id: string, value: string, operator = '=') => ({ id, value, operator });
const trigger = (value: string) => ({
  type: 'trigger',
  action: 'stateVariableChange',
  actionParam: { id: 'task', value },
});
const input = { type: 'radio', alias: 'item' };
const content = (pages: object[], stateVariables: object[] = []) =>
  JSON.stringify({ pages, stateVariables });

describe('reference presentation', () => {
  it('uses canonical media IDs when they collide with another media alias', () => {
    const definition = content([
      { sections: [{ elements: [{ type: 'video', id: 'video', alias: 'video' }] }] },
      {
        sections: [
          {
            enableReHide: true,
            visibilityRules: [rule('video', '0.99', '≥')],
            elements: [{ type: 'audio', id: 'audio2', alias: 'audio1' }],
          },
          { enableReHide: true, visibilityRules: [rule('audio2', '0', '>')], elements: [input] },
        ],
      },
      { sections: [{ elements: [{ type: 'audio', id: 'audio3', alias: 'audio2' }] }] },
    ]);
    const result = preparePreviewPresentation(definition, 'item');
    if (result.kind !== 'ready') throw Error('expected presentation');
    expect(JSON.parse(result.dataParts['elementCodes'])).toEqual(
      expect.arrayContaining([
        { id: 'video', status: 'VALUE_CHANGED', value: 0.99 },
        { id: 'audio1', status: 'VALUE_CHANGED', value: 0.001 },
      ]),
    );
    expect(JSON.parse(result.dataParts['elementCodes'])).toHaveLength(2);
  });
  it('prepares only media progression, retaining all original visibility predicates', () => {
    const definition = content([
      { sections: [{ elements: [{ id: 'intro', alias: 'intro-audio', type: 'audio' }] }] },
      {
        sections: [
          {
            enableReHide: true,
            visibilityRules: [rule('intro-audio', '0.99', '≥')],
            elements: [{ id: 'prompt', alias: 'prompt-audio', type: 'audio' }],
          },
          {
            enableReHide: true,
            visibilityRules: [rule('prompt-audio', '0', '>')],
            elements: [input],
          },
        ],
      },
    ]);
    const result = preparePreviewPresentation(definition, 'item');
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.navigate).toEqual([1]);
    expect(JSON.parse(result.dataParts['elementCodes'])).toEqual(
      expect.arrayContaining([
        { id: 'intro-audio', status: 'VALUE_CHANGED', value: 0.99 },
        { id: 'prompt-audio', status: 'VALUE_CHANGED', value: 0.001 },
      ]),
    );
    expect(JSON.parse(result.dataParts['elementCodes'])).toHaveLength(2);
    expect(result.dataParts['stateVariableCodes']).toBeUndefined();
    expect(JSON.parse(definition).pages[1].sections[0].visibilityRules).toEqual([
      rule('intro-audio', '0.99', '≥'),
    ]);
  });

  it.each(['audio', 'video'])('leaves persistent %s histories to the original flow', (type) => {
    for (const enableReHide of [false, undefined]) {
      const definition = content([
        {
          sections: [
            { elements: [{ type, id: 'media', alias: 'Media' }] },
            {
              enableReHide,
              visibilityRules: [rule('media', '0')],
              elements: [{ type: 'text', alias: 'persistent' }],
            },
            {
              enableReHide: true,
              visibilityRules: [rule('media', '0.5', '≥')],
              elements: [input],
            },
          ],
        },
      ]);
      expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
        kind: 'ready',
        interactive: true,
        page: 0,
        dataParts: {},
      });
    }
  });

  it('keeps manual state inputs when media history requires the original flow', () => {
    const definition = content(
      [
        {
          sections: [
            { elements: [{ type: 'audio', id: 'media' }] },
            { visibilityRules: [rule('media', '0.5', '≥')], elements: [input] },
          ],
        },
      ],
      [{ id: 'view', alias: 'View', value: '0' }],
    );
    expect(preparePreviewPresentation(definition, 'item', { values: { view: '1' } })).toMatchObject(
      {
        interactive: true,
        dataParts: {
          stateVariableCodes: JSON.stringify([{ id: 'View', status: 'VALUE_CHANGED', value: '1' }]),
        },
      },
    );
  });

  it('replays ordered triggers rather than demanding that an earlier trigger write the final value', () => {
    const definition = content(
      [
        { alwaysVisible: true, sections: [{ elements: [trigger('1')] }] },
        { sections: [{ elements: [{ type: 'text', alias: 'intro' }] }] },
        {
          sections: [
            { visibilityRules: [rule('task', '1')], elements: [trigger('2')] },
            { visibilityRules: [rule('task', '2')], elements: [input] },
          ],
        },
      ],
      [{ id: 'task', alias: 'Task', value: '0' }],
    );
    const result = preparePreviewPresentation(definition, 'item');
    expect(result).toMatchObject({
      kind: 'ready',
      page: 0,
      navigate: [1],
      interactive: false,
      dataParts: {},
    });
    if (result.kind === 'ready')
      expect(JSON.parse(result.printDataParts!['stateVariableCodes'])).toEqual([
        { id: 'Task', status: 'VALUE_CHANGED', value: '2' },
      ]);
  });

  it('preserves the entry history for a stimulus that does not re-hide', () => {
    const definition = content(
      [
        {
          alwaysVisible: true,
          sections: [
            {
              enableReHide: false,
              visibilityRules: [rule('task', '0')],
              elements: [trigger('1'), { type: 'text', alias: 'persistent' }],
            },
          ],
        },
        { sections: [{ elements: [{ alias: 'intro' }] }] },
        {
          sections: [
            { visibilityRules: [rule('task', '1')], elements: [trigger('2')] },
            { visibilityRules: [rule('task', '2')], elements: [input] },
          ],
        },
      ],
      [{ id: 'task', value: '0' }],
    );
    expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
      kind: 'ready',
      page: 0,
      navigate: [1],
      dataParts: {},
    });
  });

  it('replays normal pages to retain stimulus visibility before the target state', () => {
    const definition = content(
      [
        {
          sections: [
            {
              enableReHide: false,
              visibilityRules: [rule('task', '0')],
              elements: [{ type: 'text', alias: 'persistent' }],
            },
            { elements: [{ ...trigger('1'), id: 'advance' }] },
            { enableReHide: true, visibilityRules: [rule('task', '1')], elements: [input] },
          ],
        },
      ],
      [{ id: 'task', value: '0' }],
    );
    expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
      kind: 'ready',
      page: 0,
      navigate: [],
      triggerIds: ['advance'],
      dataParts: {},
      interactive: false,
    });
  });

  it('still derives a unique static context when no trigger history is involved', () => {
    const definition = content(
      [{ sections: [{ visibilityRules: [rule('task', '2')], elements: [input] }] }],
      [{ id: 'task', value: '0' }],
    );
    expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
      kind: 'ready',
      page: 0,
      dataParts: {
        stateVariableCodes: JSON.stringify([{ id: 'task', status: 'VALUE_CHANGED', value: '2' }]),
      },
    });
  });

  it('retains a target revealed at an intermediate trigger state on a regular page', () => {
    const definition = content(
      [
        {
          sections: [
            { elements: [{ ...trigger('1'), id: 'initial' }] },
            { enableReHide: false, visibilityRules: [rule('task', '1')], elements: [input] },
            {
              visibilityRules: [rule('task', '1')],
              elements: [{ ...trigger('2'), id: 'advance' }],
            },
          ],
        },
      ],
      [{ id: 'task', value: '0' }],
    );
    expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
      kind: 'ready',
      page: 0,
      dataParts: {},
      navigate: [],
      triggerIds: ['initial', 'advance'],
      interactive: false,
    });
  });

  it('uses the authored default for freely selectable views and supports inequality', () => {
    const definition = content(
      [
        {
          alwaysVisible: true,
          sections: [
            { visibilityRules: [rule('view', '0')], elements: [{ alias: 'overview' }] },
            { visibilityRules: [rule('view', '1')], elements: [{ alias: 'detail' }] },
          ],
        },
        { sections: [{ visibilityRules: [rule('source', '1', '≠')], elements: [input] }] },
      ],
      [
        { id: 'view', value: '0' },
        { id: 'source', value: '0' },
      ],
    );
    expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
      kind: 'ready',
      interactive: false,
      page: 0,
      dataParts: {},
    });
  });

  it('finds the first reachable context for an always-visible target', () => {
    const definition = content(
      [
        {
          alwaysVisible: true,
          sections: [{ visibilityRules: [rule('task', '2')], elements: [input] }],
        },
        { sections: [{ elements: [trigger('1')] }] },
        { sections: [{ elements: [trigger('2')] }] },
      ],
      [{ id: 'task', value: '0' }],
    );
    expect(preparePreviewPresentation(definition, 'item')).toMatchObject({
      kind: 'ready',
      page: 0,
      navigate: [1],
      interactive: false,
    });
  });

  it('keeps unknown answer and timer histories interactive without fabricating answers', () => {
    for (const section of [
      { visibilityRules: [rule('answer', '1')], elements: [input] },
      { visibilityDelay: 10000, visibilityRules: [rule('task', '1')], elements: [input] },
    ]) {
      const result = preparePreviewPresentation(content([{ sections: [section] }]), 'item');
      expect(result).toMatchObject({ kind: 'ready', page: 0, interactive: true, dataParts: {} });
    }
  });

  it('rejects missing or ambiguous targets and invalid state declarations', () => {
    expect(preparePreviewPresentation('{}', 'item').kind).toBe('unavailable');
    expect(
      preparePreviewPresentation(content([{ sections: [{ elements: [input, input] }] }]), 'item')
        .kind,
    ).toBe('unavailable');
    const definition = content(
      [{ sections: [{ elements: [input] }] }],
      [{ id: 'task' }, { id: 'task' }],
    );
    expect(preparePreviewPresentation(definition, 'item').kind).toBe('unavailable');
  });

  it('binds explicitly captured contexts to the exact definition, target and page', () => {
    const definition = content([{ sections: [{ elements: [input] }] }]);
    const context = {
      definitionKey: previewDefinitionKey(definition),
      target: 'item',
      page: 0,
      dataParts: { stateVariableCodes: '[]', elementCodes: '[{"id":"answer","value":1}]' },
    };
    expect(preparePreviewPresentation(definition, 'item', { values: {}, context })).toMatchObject({
      kind: 'ready',
      dataParts: context.dataParts,
    });
    for (const wrong of [
      { ...context, definitionKey: '1-0-0' },
      { ...context, target: 'other' },
      { ...context, page: 1 },
    ]) {
      expect(
        preparePreviewPresentation(definition, 'item', { values: {}, context: wrong }).kind,
      ).toBe('unavailable');
    }
  });

  it('limits context payloads to supported serialized state arrays', () => {
    const base = {
      definitionKey: '10-abc-def',
      target: 'item',
      page: 0,
      dataParts: { elementCodes: '[]' },
    };
    expect(readPreviewContext(base)).toEqual(base);
    for (const value of [
      null,
      [],
      { ...base, page: -1 },
      { ...base, dataParts: { script: '[]' } },
      { ...base, dataParts: { elementCodes: '{}' } },
      { ...base, dataParts: { elementCodes: '[' } },
      { ...base, dataParts: { elementCodes: ' '.repeat(524289) } },
    ])
      expect(readPreviewContext(value)).toBeNull();
    expect(previewDefinitionKey('a')).not.toBe(previewDefinitionKey('b'));
  });
});
