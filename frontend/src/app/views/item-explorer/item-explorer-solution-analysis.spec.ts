import { describe, expect, it } from 'vitest';
import { deriveSolutionAnalysis } from './item-explorer-solution-analysis';

const residualCode = {
  id: 0,
  type: 'RESIDUAL',
  score: 0,
  ruleSets: [],
};

describe('deriveSolutionAnalysis', () => {
  it('derives and validates one exact FULL_CREDIT answer without a player definition', () => {
    const variable = {
      id: 'internal-a',
      alias: 'A1',
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          score: 1,
          ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Musterantwort'] }] }],
        },
        residualCode,
      ],
    };

    expect(deriveSolutionAnalysis(variable, [variable])).toMatchObject({
      status: 'exact',
      selectedCodeId: '1',
      answers: [{ variable, value: 'Musterantwort', codeIds: ['1'] }],
    });
  });

  it('keeps distinct FULL_CREDIT answers as alternatives', () => {
    const variable = {
      id: 'A1',
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['eins'] }] }],
        },
        {
          id: 2,
          type: 'FULL_CREDIT',
          ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['zwei'] }] }],
        },
      ],
    };

    expect(deriveSolutionAnalysis(variable, [variable])).toEqual({
      status: 'multiple',
      answers: [],
      message: 'Die Kodierung enthält mehrere gültige FULL_CREDIT-Antworten.',
    });
  });

  it('falls back to rules for non-invertible coding methods', () => {
    const variable = {
      id: 'A1',
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          ruleSets: [{ rules: [{ method: 'MATCH_REGEX', parameters: ['[ab]'] }] }],
        },
      ],
    };

    expect(deriveSolutionAnalysis(variable, [variable])).toMatchObject({
      status: 'rules',
      answers: [],
    });
  });

  it('reports unavailable information when neither FULL_CREDIT nor rules exist', () => {
    const variable = { id: 'A1', sourceType: 'BASE', codes: [] };

    expect(deriveSolutionAnalysis(variable, [variable])).toEqual({
      status: 'unavailable',
      answers: [],
      message: 'Die Kodiervariable enthält keinen ausdrücklich markierten FULL_CREDIT-Code.',
    });
  });

  it('derives all checkbox contributions for a validated SUM_SCORE result', () => {
    const optionA = {
      id: 'option-a',
      alias: 'A',
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          score: 1,
          ruleSets: [{ rules: [{ method: 'IS_TRUE' }] }],
        },
        residualCode,
      ],
    };
    const optionB = {
      id: 'option-b',
      alias: 'B',
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          score: 1,
          ruleSets: [{ rules: [{ method: 'IS_FALSE' }] }],
        },
        residualCode,
      ],
    };
    const aggregate = {
      id: 'aggregate',
      alias: 'MC',
      sourceType: 'SUM_SCORE',
      deriveSources: ['option-a', 'option-b'],
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          score: 1,
          ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH', parameters: ['2'] }] }],
        },
        residualCode,
      ],
    };

    expect(deriveSolutionAnalysis(aggregate, [optionA, optionB, aggregate])).toMatchObject({
      status: 'exact',
      answers: [
        { variable: optionA, value: true },
        { variable: optionB, value: false },
      ],
    });
  });
});
