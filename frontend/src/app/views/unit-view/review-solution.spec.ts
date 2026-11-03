import { describe, expect, it } from 'vitest';
import type { PlayerDropList } from '../../core/services/voud-drop-lists';
import {
  CodingVariableLike,
  mergePlayerSolutionIntoDataParts,
} from '../item-explorer/item-explorer-solution-prefill';
import { deriveReviewSolution } from './review-solution';

const textVariable = (id: string, answer: string): CodingVariableLike => ({
  id: `internal-${id}`,
  alias: id,
  sourceType: 'BASE',
  codes: [
    {
      id: 1,
      type: 'FULL_CREDIT',
      score: 1,
      ruleSets: [{ rules: [{ method: 'MATCH', parameters: [answer] }] }],
    },
    { id: 0, type: 'RESIDUAL_AUTO', score: 0, ruleSets: [] },
  ],
});

const resolve = (variable: CodingVariableLike) => ({
  responseId: String(variable.alias),
  identifiers: [String(variable.alias)],
  elementType: 'text-field',
});

describe('deriveReviewSolution', () => {
  it('combines multiple independently validated answers', () => {
    const variables = [textVariable('A1', 'eins'), textVariable('A2', 'zwei')];
    const result = deriveReviewSolution(variables, variables, resolve);
    expect(result.prefill.status).toBe('available');
    expect(result.prefill.responses.map(({ id, value }) => [id, value])).toEqual([
      ['A1', 'eins'],
      ['A2', 'zwei'],
    ]);
    expect(result.unavailableVariables).toEqual([]);
  });

  it('explicitly marks partial solutions for open, manually coded formats', () => {
    const variables = [
      textVariable('A1', 'eins'),
      { id: 'essay', sourceType: 'BASE', codeModel: 'MANUAL_ONLY', codes: [] },
    ];
    const result = deriveReviewSolution(variables, variables, resolve);
    expect(result.prefill.status).toBe('available');
    expect(result.prefill.message).toContain('1 von 2');
    expect(result.unavailableVariables).toEqual(['essay']);
    expect(result.prefill.responses).toHaveLength(1);
  });

  it('directs reviewers to the instructions when no player solution exists', () => {
    const variables = [{ id: 'essay', sourceType: 'BASE', codeModel: 'MANUAL_ONLY' }];
    expect(deriveReviewSolution(variables, variables, resolve).prefill).toMatchObject({
      status: 'unavailable',
      responses: [],
      message: expect.stringContaining('Kodieranweisungen'),
    });
  });

  it('does not use variables outside the review selection', () => {
    const variables = [textVariable('A1', 'eins'), textVariable('audio', '2')];
    expect(deriveReviewSolution(variables, [variables[0]], resolve).prefill.responses).toHaveLength(
      1,
    );
  });

  it('rejects incompatible answers mapped to one player target', () => {
    const variables = [textVariable('A1', 'eins'), textVariable('A2', 'zwei')];
    const result = deriveReviewSolution(variables, variables, (variable) => ({
      ...resolve(variable),
      responseId: 'same-target',
    }));
    expect(result.prefill.status).toBe('unavailable');
    expect(result.prefill.message).toContain('widersprechen');
  });

  it('rejects answers whose player mapping fails combined validation', () => {
    const variables = [textVariable('A1', 'eins')];
    const result = deriveReviewSolution(variables, variables, (variable) => ({
      ...resolve(variable),
      responseId: 'unknown-target',
    }));
    expect(result.prefill.status).toBe('unavailable');
    expect(result.prefill.message).toContain('gemeinsam');
  });

  const dragLists = (copyOnDrop = false): PlayerDropList[] => [
    {
      id: 'pool',
      responseId: 'POOL',
      connectedTo: ['a', 'b'],
      onlyOneItem: false,
      copyOnDrop,
      items: [
        { value: 'X', label: 'First object' },
        { value: 'Y', label: 'Second object' },
        { value: 'Z', label: 'Unused object' },
      ],
    },
    ...['a', 'b'].map((id) => ({
      id,
      responseId: id.toUpperCase(),
      connectedTo: ['pool'],
      onlyOneItem: true,
      copyOnDrop: false,
      items: [],
    })),
  ];
  const dragResolver = (lists: PlayerDropList[]) => (variable: CodingVariableLike) => ({
    ...resolve(variable),
    elementType: 'drop-list',
    valueOptions: lists[0].items,
    dropLists: lists,
  });

  it('retains the full drag group and removes a moved object from its palette', () => {
    const variables = [textVariable('A', 'X')];
    const result = deriveReviewSolution(variables, variables, dragResolver(dragLists()));
    expect(result.prefill.status).toBe('available');
    if (result.prefill.status !== 'available') throw new Error(result.prefill.message);
    expect(result.prefill.dropLists).toEqual(dragLists());
    const parts = mergePlayerSolutionIntoDataParts(
      {},
      result.prefill.responses,
      result.prefill.dropLists,
    );
    expect(JSON.parse(parts['elementCodes'])).toEqual([
      { id: 'POOL', status: 'VALUE_CHANGED', value: ['Y', 'Z'] },
      { id: 'A', status: 'VALUE_CHANGED', value: ['X'] },
      { id: 'B', status: 'VALUE_CHANGED', value: [] },
    ]);
  });

  it('deduplicates a shared group while combining independent drag answers', () => {
    const variables = [textVariable('A', 'X'), textVariable('B', 'Y')];
    const result = deriveReviewSolution(variables, variables, dragResolver(dragLists()));
    expect(result.prefill.status).toBe('available');
    if (result.prefill.status !== 'available') throw new Error(result.prefill.message);
    expect(result.prefill.dropLists).toHaveLength(3);
    const responses = JSON.parse(
      mergePlayerSolutionIntoDataParts({}, result.prefill.responses, result.prefill.dropLists)[
        'elementCodes'
      ],
    );
    expect(responses.find((response: { id: string }) => response.id === 'POOL').value).toEqual([
      'Z',
    ]);
  });

  it('rejects independently valid answers that allocate one non-copyable object twice', () => {
    const variables = [textVariable('A', 'X'), textVariable('B', 'X')];
    const result = deriveReviewSolution(variables, variables, dragResolver(dragLists()));
    expect(result.prefill.status).toBe('unavailable');
    expect(result.prefill.responses).toEqual([]);
    expect(result.prefill.message).toContain('Drag-and-drop');
  });

  it('keeps ordinary answers when validating a mixed text and drag solution', () => {
    const variables = [textVariable('A', 'X'), textVariable('TEXT', 'Berlin')];
    const result = deriveReviewSolution(variables, variables, (variable) =>
      variable.alias === 'TEXT' ? resolve(variable) : dragResolver(dragLists())(variable),
    );
    expect(result.prefill.status).toBe('available');
    if (result.prefill.status !== 'available') throw new Error(result.prefill.message);
    const responses = JSON.parse(
      mergePlayerSolutionIntoDataParts({}, result.prefill.responses, result.prefill.dropLists)[
        'elementCodes'
      ],
    );
    expect(responses.find((response: { id: string }) => response.id === 'TEXT').value).toBe(
      'Berlin',
    );
    expect(responses.find((response: { id: string }) => response.id === 'POOL').value).toEqual([
      'Y',
      'Z',
    ]);
  });

  it('rejects different array answers mapped to the same target', () => {
    const variables = [textVariable('A', 'X'), textVariable('B', 'Y')];
    const result = deriveReviewSolution(variables, variables, (variable) => ({
      ...dragResolver(dragLists())(variable),
      responseId: 'A',
    }));
    expect(result.prefill.status).toBe('unavailable');
    expect(result.prefill.message).toContain('widersprechen');
  });

  it('permits explicitly copyable objects in multiple targets and retains their palette', () => {
    const variables = [textVariable('A', 'X'), textVariable('B', 'X')];
    const result = deriveReviewSolution(variables, variables, dragResolver(dragLists(true)));
    expect(result.prefill.status).toBe('available');
    if (result.prefill.status !== 'available') throw new Error(result.prefill.message);
    const responses = JSON.parse(
      mergePlayerSolutionIntoDataParts({}, result.prefill.responses, result.prefill.dropLists)[
        'elementCodes'
      ],
    );
    expect(responses.map((response: { value: string[] }) => response.value)).toEqual([
      ['X', 'Y', 'Z'],
      ['X'],
      ['X'],
    ]);
  });

  it('combines equal array answers from base and aggregate variables without a false conflict', () => {
    const variables: CodingVariableLike[] = [
      textVariable('A', 'X'),
      textVariable('B', 'Y'),
      {
        id: 'sum',
        alias: 'RESULT',
        sourceType: 'SUM_SCORE',
        deriveSources: ['internal-A', 'internal-B'],
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            score: 2,
            ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH', parameters: ['2'] }] }],
          },
        ],
      },
    ];
    const result = deriveReviewSolution(variables, variables, dragResolver(dragLists()));
    expect(result.prefill.status).toBe('available');
    expect(result.prefill.responses.map(({ id, value }) => [id, value])).toEqual([
      ['A', ['X']],
      ['B', ['Y']],
    ]);
  });
});
