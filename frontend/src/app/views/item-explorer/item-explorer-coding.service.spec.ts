import { describe, expect, it } from 'vitest';
import { VoudService } from '../../core/services/voud.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { ReadonlyExplorerItem } from './item-explorer.models';

describe('ItemExplorerCodingService', () => {
  it('keeps general variable hints and manual code instructions when the coding uses an alias', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    const codings = service.createCodingSchemeAsText([
      {
        id: 'INTERNAL_ID',
        alias: 'VISIBLE_ALIAS',
        label: 'Visible result',
        sourceType: 'BASE',
        manualInstruction: '<p>Text <img src="figure.png"></p>',
        codes: [
          {
            id: 1,
            score: 1,
            label: 'Correct',
            manualInstruction: '<p>Inspect figure</p>',
            ruleSets: [],
          },
        ],
      },
    ]);

    expect(codings[0].id).toBe('VISIBLE_ALIAS');
    expect(codings[0].generalInstructionText).toContain('<img');
    expect(codings[0].codes[0].manualInstructionText).toContain('Inspect figure');
  });

  it('sanitizes general variable hints and manual code instructions while preserving graphics', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    const codings = service.createCodingSchemeAsText([
      {
        id: 'INTERNAL_ID',
        alias: 'VISIBLE_ALIAS',
        sourceType: 'BASE',
        manualInstruction:
          '<p>Text <img src="figure.png" onerror="alert(1)"></p><script>alert(2)</script>',
        codes: [
          {
            id: 1,
            score: 1,
            label: 'Correct',
            manualInstruction:
              '<a href="javascript:alert(3)" onclick="alert(4)">Inspect figure</a>',
            ruleSets: [],
          },
        ],
      },
    ]);

    expect(codings[0].generalInstructionText).toContain('<img src="figure.png">');
    expect(codings[0].generalInstructionText).not.toContain('onerror');
    expect(codings[0].generalInstructionText).not.toContain('<script');
    expect(codings[0].codes[0].manualInstructionText).toContain('Inspect figure');
    expect(codings[0].codes[0].manualInstructionText).not.toContain('javascript:');
    expect(codings[0].codes[0].manualInstructionText).not.toContain('onclick');
  });

  it('keeps general instructions paired by position for a valid alias shadow', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    const codings = service.createCodingSchemeAsText([
      {
        id: 'BASE_A',
        sourceType: 'BASE',
        manualInstruction: '<p>Base instruction</p>',
        codes: [],
      },
      {
        id: 'TOTAL',
        alias: 'BASE_A',
        sourceType: 'SUM_SCORE',
        deriveSources: ['BASE_A'],
        manualInstruction: '<p>Aggregate instruction</p>',
        codes: [],
      },
    ]);

    expect(codings.map((coding: any) => coding.generalInstructionText)).toEqual([
      '<p>Base instruction</p>',
      '<p>Aggregate instruction</p>',
    ]);
  });

  it('treats semantically empty instruction HTML as absent', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    const codings = service.createCodingSchemeAsText([
      {
        id: '01',
        sourceType: 'BASE',
        manualInstruction: '<p>&nbsp;</p>',
        codes: [
          {
            id: 1,
            score: 1,
            manualInstruction: '<div><br></div>',
            ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['3'] }] }],
          },
        ],
      },
    ]);

    expect(codings[0].generalInstructionText).toBeNull();
    expect(codings[0].codes[0].manualInstructionText).toBeNull();
    service.preferManualCodingInstructions = true;
    expect(service.shouldShowAutomaticCodingRules(codings[0].codes[0])).toBe(true);
  });
});

describe('Coding target resolution', () => {
  const item = (values: Partial<ReadonlyExplorerItem> = {}): ReadonlyExplorerItem => ({
    uuid: 'uuid',
    rowKey: 'row',
    itemId: 'i',
    unitId: 'u',
    unitLabel: 'U',
    description: '',
    variableId: 'v',
    metadata: {},
    ...values,
  });

  it('resolves each passed selection independently and does not retain a previous selection', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    service.setScheme([
      { id: 'A', alias: 'visible', sourceType: 'BASE', codes: [] },
      { id: 'TOTAL', sourceType: 'SUM_SCORE', deriveSources: ['A'], codes: [] },
    ]);
    service.codingSearchText = 'not found';
    expect(service.codingVariableFocus(item({ variableReadOnlyId: 'TOTAL' }), null)).toMatchObject({
      status: 'unique',
      internalId: 'TOTAL',
      isDerived: true,
    });
    expect(service.codingVariableFocus(item({ variableReadOnlyId: 'A' }), null)).toMatchObject({
      status: 'unique',
      internalId: 'A',
      playerTargetId: 'v',
      isDerived: false,
    });
    expect(
      service.filteredCodingSchemeAsText(item({ variableReadOnlyId: 'A' }), null),
    ).toHaveLength(1);
    service.setScheme(null);
    expect(service.filteredCodingSchemeAsText(item(), null)).toEqual([]);
  });

  it('blocks automatic targets for ambiguous aliases and missing strict references', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    service.setScheme([
      { id: 'A', alias: 'duplicate', sourceType: 'BASE', codes: [] },
      { id: 'B', alias: 'duplicate', sourceType: 'BASE', codes: [] },
    ]);
    service.syncPreviewTargetResolution(null, item({ variableId: 'duplicate' }));
    expect(service.previewTargetResolution).toMatchObject({
      isAmbiguous: true,
      blocksAutomaticTarget: true,
      defaultTargetId: '',
    });
    service.syncPreviewTargetResolution(
      null,
      item({ variableReadOnlyId: 'missing', variableId: '' }),
    );
    expect(service.previewTargetResolution).toMatchObject({
      blocksAutomaticTarget: true,
      defaultTargetId: '',
    });
  });

  it('terminates cyclic derived target chains and clears a previous solution for an unmapped item', () => {
    const service = new ItemExplorerCodingService(new VoudService());
    service.setScheme([
      { id: 'A', sourceType: 'SUM_SCORE', deriveSources: ['B'], codes: [] },
      { id: 'B', sourceType: 'SUM_SCORE', deriveSources: ['A'], codes: [] },
    ]);
    service.syncPreviewTargetResolution(null, item({ variableReadOnlyId: 'A' }));
    expect(service.previewTargetResolution.isDerived).toBe(true);
    service.correctSolutionPrefill = { status: 'available', responses: [], message: '' };
    service.refreshCorrectSolutionPrefill(item({ variableId: '' }), '{}');
    expect(service.correctSolutionPrefill.status).toBe('unavailable');
  });
});
