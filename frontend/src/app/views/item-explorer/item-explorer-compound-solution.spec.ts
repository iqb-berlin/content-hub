import { describe, expect, it, vi } from 'vitest';
import { ItemExplorerPlayerService } from './item-explorer-player.service';
import { CodingSchemeFactory } from '@iqb/responses';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import { VoudService } from '../../core/services/voud.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { mergePlayerSolutionIntoDataParts } from './item-explorer-solution-prefill';

const base = (id: string, alias: string, value: string) => ({
  id,
  alias,
  sourceType: 'BASE',
  codes: [
    {
      id: 1,
      type: 'FULL_CREDIT',
      score: 1,
      ruleSets: [{ rules: [{ method: 'MATCH', parameters: [value] }] }],
    },
    { id: 0, type: 'RESIDUAL_AUTO', score: 0, ruleSets: [] },
  ],
});
const aggregate = {
  id: 'sum',
  alias: 'RESULT',
  sourceType: 'SUM_SCORE',
  deriveSources: ['internal-a', 'internal-b'],
  codes: [
    {
      id: 1,
      type: 'FULL_CREDIT',
      score: 2,
      ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH', parameters: ['2'] }] }],
    },
  ],
};
const item = {
  itemId: '01',
  unitId: 'UNIT',
  unitLabel: 'Unit',
  metadata: {},
  variableReadOnlyId: 'sum',
};
function serviceFor(first: string, second: string) {
  const variables = [base('internal-a', 'A', first), base('internal-b', 'B', second), aggregate];
  const service = new ItemExplorerCodingService(new VoudService());
  service.setScheme({ version: '3.0', variableCodings: variables });
  return { service, variables };
}
function likert() {
  return JSON.stringify({
    pages: [
      {
        elements: [
          {
            type: 'likert',
            id: 'table',
            options: [{ text: 'stimmt' }, { text: '<p>stimmt nicht</p>' }],
            rows: [
              {
                type: 'likert-row',
                id: 'row-a',
                alias: 'A',
                rowLabel: { text: 'Buchdruck' },
                columnCount: 2,
              },
              {
                type: 'likert-row',
                id: 'row-b',
                alias: 'B',
                rowLabel: { text: 'Telefon' },
                columnCount: 2,
              },
            ],
          },
        ],
      },
    ],
  });
}
function drag(copyOnDrop = false) {
  return JSON.stringify({
    pages: [
      {
        elements: [
          {
            type: 'drop-list',
            id: 'pool',
            alias: 'POOL',
            onlyOneItem: false,
            isSortList: false,
            copyOnDrop,
            connectedTo: ['target-a', 'target-b'],
            value: [
              { alias: 'X', text: 'Arbeitsschritt 7' },
              { alias: 'Y', text: 'Arbeitsschritt 5' },
            ],
          },
          ...['a', 'b'].map((id) => ({
            type: 'drop-list',
            id: 'target-' + id,
            alias: id.toUpperCase(),
            onlyOneItem: true,
            isSortList: false,
            copyOnDrop: false,
            connectedTo: ['pool'],
            value: [],
          })),
        ],
      },
    ],
  });
}

describe('compound solutions from structured player definitions', () => {
  it('shows Likert row/column text and validates the complete SUM_SCORE', () => {
    const { service, variables } = serviceFor('1', '2');
    service.refreshCorrectSolutionPrefill(item, likert());
    expect(service.codingInformation).toMatchObject({
      status: 'exact',
      answers: [
        { responseId: 'A', label: 'Buchdruck', valueLabel: 'stimmt' },
        { responseId: 'B', label: 'Telefon', valueLabel: 'stimmt nicht' },
      ],
    });
    expect(service.correctSolutionPrefill.responses.map((response) => response.value)).toEqual([
      1, 2,
    ]);
    expect(
      CodingSchemeFactory.code(
        service.correctSolutionPrefill.responses,
        variables as VariableCodingData[],
      ).find((response) => response.id === 'RESULT'),
    ).toMatchObject({ status: 'CODING_COMPLETE', code: 1, score: 2 });
  });
  it('keeps out-of-range Likert values as rules', () => {
    const { service } = serviceFor('3', '2');
    service.refreshCorrectSolutionPrefill(item, likert());
    expect(service.correctSolutionPrefill.status).toBe('unavailable');
    expect(service.codingInformation).toMatchObject({ status: 'rules', answers: [] });
  });
  it('does not present malformed Likert rows as unvalidated raw answers', () => {
    const { service } = serviceFor('1', '2');
    const definition = JSON.parse(likert());
    definition.pages[0].elements[0].rows[0].columnCount = 3;
    service.refreshCorrectSolutionPrefill(item, JSON.stringify(definition));
    expect(service.correctSolutionPrefill.status).toBe('unavailable');
    expect(service.codingInformation).toMatchObject({ status: 'rules', answers: [] });
  });
  it('uses drag object alias arrays, readable text and a balanced palette', () => {
    const { service, variables } = serviceFor('X', 'Y');
    service.refreshCorrectSolutionPrefill(item, drag());
    const solution = service.correctSolutionPrefill;
    if (solution.status !== 'available') throw new Error(solution.message);
    expect(solution.responses.map((response) => response.value)).toEqual([['X'], ['Y']]);
    expect(service.codingInformation).toMatchObject({
      status: 'exact',
      answers: [{ valueLabel: 'Arbeitsschritt 7' }, { valueLabel: 'Arbeitsschritt 5' }],
    });
    const responses = JSON.parse(
      mergePlayerSolutionIntoDataParts(null, solution.responses, solution.dropLists)[
        'elementCodes'
      ],
    );
    expect(responses.find((response: { id: string }) => response.id === 'POOL').value).toEqual([]);
    expect(
      CodingSchemeFactory.code(responses, variables as VariableCodingData[]).find(
        (response) => response.id === 'RESULT',
      ),
    ).toMatchObject({ status: 'CODING_COMPLETE', code: 1, score: 2 });
  });
  it.each(['missing-object', 'X'])('rejects impossible object allocation %s', (second) => {
    const { service } = serviceFor('X', second);
    service.refreshCorrectSolutionPrefill(item, drag());
    expect(service.correctSolutionPrefill.status).toBe('unavailable');
    expect(service.codingInformation).toMatchObject({ status: 'rules', answers: [] });
  });
  it('allows duplicate objects only with explicit copy-on-drop', () => {
    const { service } = serviceFor('X', 'X');
    service.refreshCorrectSolutionPrefill(item, drag(true));
    expect(service.correctSolutionPrefill.status).toBe('available');
  });
});

describe('compound solutions with conditional preview sessions', () => {
  it.each(['likert', 'drop-list'])('preserves visibility and answer isolation for %s', (type) => {
    vi.useFakeTimers();
    const voud = new VoudService();
    const player = new ItemExplorerPlayerService(voud);
    const postMessage = vi.fn();
    player.registerPlayerDom({
      hasFrame: () => true,
      postMessage,
      focus: () => true,
      setPrintLabelOverrides: () => {},
      startAutoResize: () => {},
      stopAutoResize: () => {},
    });
    try {
      const { service } = serviceFor(type === 'likert' ? '1' : 'X', type === 'likert' ? '2' : 'Y');
      const definition = JSON.parse(type === 'likert' ? likert() : drag());
      definition.stateVariables = [{ id: 'context', alias: 'CONTEXT', value: '0' }];
      definition.pages[0] = {
        sections: [
          {
            visibilityRules: [{ id: 'context', operator: '=', value: '2' }],
            elements: definition.pages[0].elements,
          },
        ],
      };
      const content = JSON.stringify(definition);
      service.refreshCorrectSolutionPrefill(item, content);
      const solution = service.correctSolutionPrefill;
      expect(solution.status).toBe('available');
      player.applyAssets({ unit: { id: 'UNIT' }, srcDoc: '', definition: content });
      player.itemExplorerConditionalVisibilityEnabled = true;
      player.onPlayerLoaded();
      const request = { item, rowKey: 'row', target: 'A', printLabels: {}, solution: null };
      expect(player.start({ ...request, solution })).toEqual({ kind: 'started' });
      const start = postMessage.mock.calls.at(-1)![0];
      expect(start.unitDefinition).toBe(content);
      expect(JSON.parse(start.unitState.dataParts.stateVariableCodes)).toEqual([
        { id: 'CONTEXT', status: 'VALUE_CHANGED', value: '2' },
      ]);
      const responses = JSON.parse(start.unitState.dataParts.elementCodes);
      expect(responses.find((response: { id: string }) => response.id === 'A').value).toEqual(
        type === 'likert' ? 1 : ['X'],
      );
      if (type === 'drop-list') {
        expect(responses.find((response: { id: string }) => response.id === 'POOL').value).toEqual(
          [],
        );
      }
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId: start.sessionId,
          unitState: { dataParts: start.unitState.dataParts },
        },
        { ready: true, solutionActive: false },
      );
      expect(player.isAnswerSession).toBe(false);
      expect(player.currentResponseData).toBeNull();
      expect(player.hasResponseState).toBe(false);

      player.start(request);
      const restored = postMessage.mock.calls.at(-1)![0];
      expect(restored.unitState.dataParts.elementCodes).toBeUndefined();
      expect(restored.unitState.dataParts.stateVariableCodes).toBe(
        start.unitState.dataParts.stateVariableCodes,
      );
      expect(player.syntheticPreviewState).toBe(true);
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId: start.sessionId,
          unitState: { dataParts: start.unitState.dataParts },
        },
        { ready: true, solutionActive: false },
      );
      expect(player.currentResponseData).toBeNull();

      const ownAnswers = {
        stateVariableCodes: restored.unitState.dataParts.stateVariableCodes,
        elementCodes: JSON.stringify([
          { id: 'A', value: type === 'likert' ? 2 : ['Y'], status: 'VALUE_CHANGED' },
        ]),
      };
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId: restored.sessionId,
          unitState: { dataParts: ownAnswers },
        },
        { ready: true, solutionActive: false },
      );
      player.captureAnswersForSolution();
      player.start({ ...request, solution });
      player.start(request);
      expect(postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(ownAnswers);
      expect(player.syntheticPreviewState).toBe(true);
      expect(player.isAnswerSession).toBe(false);
      expect(player.hasResponseState).toBe(false);

      const reloaded = { ...ownAnswers, elementCodes: JSON.stringify([]) };
      player.applyResponseState(reloaded);
      player.start(request);
      expect(postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({
        stateVariableCodes: restored.unitState.dataParts.stateVariableCodes,
      });
      expect(player.syntheticPreviewState).toBe(true);
      player.changePreviewMode('answers');
      player.start(request);
      expect(postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(reloaded);
      expect(player.isAnswerSession).toBe(true);
    } finally {
      player.ngOnDestroy();
      vi.useRealTimers();
    }
  });
});
