import { VoudService } from './voud.service';
import { describe, it, expect } from 'vitest';
import {
  preparePreviewDefinition,
  resolveStaticPreviewState,
  PreviewStart,
} from './preview-visibility';

const resolvePreviewVisibility = (content: string, target: string, manual?: PreviewStart) => {
  const setup = preparePreviewDefinition(content, target, manual);
  if (setup.kind === 'unavailable') return setup;
  const codes = resolveStaticPreviewState(setup, manual);
  return codes ? { kind: 'ready', page: setup.page, codes } : { kind: 'unavailable' };
};

const variable = { id: 'v', alias: 'State', value: '0' };
const rule = (value: string) => ({ id: 'v', operator: '=', value });
const target = { alias: 'target' };
const trigger = (value: string) => ({
  type: 'trigger',
  action: 'stateVariableChange',
  actionParam: { id: 'v', alias: 'wrong', value },
});
const resolve = (sections: object[], manual?: { page?: number; values: Record<string, string> }) =>
  resolvePreviewVisibility(
    JSON.stringify({ stateVariables: [variable], pages: [{ sections }] }),
    'target',
    manual,
  );

describe('preview visibility', () => {
  it('does not seed responses when no visibility state is required', () => {
    expect(resolve([{ elements: [target] }])).toEqual({ kind: 'ready', page: 0, codes: [] });
  });
  it('uses canonical trigger IDs and emits player aliases', () => {
    expect(resolve([{ visibilityRules: [rule('2')], elements: [target, trigger('2')] }])).toEqual({
      kind: 'ready',
      page: 0,
      codes: [{ id: 'State', status: 'VALUE_CHANGED', value: '2' }],
    });
  });
  it('rejects conflicting stable writes', () => {
    expect(resolve([{ visibilityRules: [rule('2')], elements: [target, trigger('1')] }]).kind).toBe(
      'unavailable',
    );
  });
  it('detects ambiguity and accepts a manual constraint', () => {
    const sections = [
      {
        logicalConnectiveOfRules: 'disjunction',
        visibilityRules: [rule('1'), rule('2')],
        elements: [target],
      },
    ];
    expect(resolve(sections).kind).toBe('unavailable');
    expect(resolve(sections, { values: { v: '2' } }).kind).toBe('ready');
  });
  it('rejects incompatible AND rules', () => {
    expect(resolve([{ visibilityRules: [rule('1'), rule('2')], elements: [target] }]).kind).toBe(
      'unavailable',
    );
  });
  it('does not invent audio or time responses', () => {
    for (const r of [
      { id: 'audio', operator: '=', value: '1' },
      { id: 'v', operator: '>', value: '10' },
    ]) {
      expect(resolve([{ visibilityRules: [r], elements: [target] }]).kind).toBe('unavailable');
    }
  });
  it('validates manual pages and declared variables', () => {
    expect(resolve([{ elements: [target] }], { values: { unknown: '1' } }).kind).toBe(
      'unavailable',
    );
  });
  it('ignores a manual page for a regular item target', () => {
    const content = JSON.stringify({
      pages: [
        { sections: [{ elements: [target] }] },
        { sections: [{ elements: [{ alias: 'other' }] }] },
      ],
    });
    expect(resolvePreviewVisibility(content, 'target', { page: 1, values: {} })).toEqual({
      kind: 'ready',
      page: 0,
      codes: [],
    });
  });
  it('uses global aliases before IDs and counts only navigable pages', () => {
    const content = JSON.stringify({
      pages: [
        { alwaysVisible: true, sections: [{ elements: [{ id: 'target' }] }] },
        { sections: [{ elements: [target] }] },
      ],
    });
    expect(resolvePreviewVisibility(content, 'target')).toEqual({
      kind: 'ready',
      page: 0,
      codes: [],
    });
  });
  it('requires a navigable context for a conditional always-visible target', () => {
    const content = JSON.stringify({
      stateVariables: [variable],
      pages: [
        { alwaysVisible: true, sections: [{ visibilityRules: [rule('2')], elements: [target] }] },
        { sections: [{ elements: [trigger('2')] }] },
      ],
    });
    expect(resolvePreviewVisibility(content, 'target').kind).toBe('unavailable');
    expect(resolvePreviewVisibility(content, 'target', { page: 0, values: {} }).kind).toBe('ready');
  });
  it('rejects duplicate aliases and missing targets', () => {
    const content = JSON.stringify({ pages: [{ sections: [{ elements: [target, target] }] }] });
    expect(resolvePreviewVisibility(content, 'target').kind).toBe('unavailable');
    expect(resolvePreviewVisibility(content, 'absent').kind).toBe('unavailable');
  });
});

describe('compound player targets', () => {
  const embedded = { id: 'child-id', alias: 'child-target' };
  for (const element of [
    { type: 'likert', rows: [embedded] },
    {
      type: 'cloze',
      document: { type: 'doc', content: [{ type: 'textField', attrs: { model: embedded } }] },
    },
  ]) {
    it(`resolves ${element.type} children and retains their section conditions`, () => {
      for (const visibilityRules of [[], [rule('2')]]) {
        const content = JSON.stringify({
          stateVariables: [variable],
          pages: [{ sections: [{ visibilityRules, elements: [element] }] }],
        });
        expect(
          new VoudService().resolvePlayerTargetLocation(content, 'child-target')?.scrollPageIndex,
        ).toBe(0);
        const result = resolvePreviewVisibility(content, 'child-target');
        expect(result).toEqual({
          kind: 'ready',
          page: 0,
          codes: visibilityRules.length
            ? [{ id: 'State', status: 'VALUE_CHANGED', value: '2' }]
            : [],
        });
      }
    });
  }
});
