import { describe, expect, it } from 'vitest';
import { CodingVariableLike } from '../item-explorer/item-explorer-solution-prefill';
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
});
