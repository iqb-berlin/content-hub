import { buildReviewCodingLabels, unnamedReviewCoding } from './review-coding-labels';

describe('buildReviewCodingLabels', () => {
  const variable = { id: 'internal-05', alias: '05', label: 'Antwort' };

  it('uses a verified definition number and retains additional authored descriptions', () => {
    const labels = buildReviewCodingLabels(
      [variable],
      [],
      [{ sourceVariable: '05', description: 'Haltestelle' }],
      new Map([['05', '4.']]),
    );
    expect(labels.get('05')).toEqual({ title: '4.', subtitle: 'Haltestelle – Antwort' });
  });

  it('uses an explicit VOMD description through the public variable reference', () => {
    const labels = buildReviewCodingLabels(
      [variable],
      [],
      [{ id: 'item-4', sourceVariable: '05', description: '4.' }],
    );
    expect(labels.get('05')).toEqual({ title: '4.', subtitle: 'Antwort' });
  });

  it('prefers file metadata over an index copy', () => {
    const labels = buildReviewCodingLabels(
      [variable],
      [{ id: 'item-4', sourceVariable: '05', name: 'Veraltete Bezeichnung' }],
      [{ id: 'item-4', variableReadOnlyId: 'internal-05', description: 'Teilaufgabe 4' }],
    );
    expect(labels.get('05')?.title).toBe('Teilaufgabe 4');
  });

  it('uses an existing index item name when no file item matches', () => {
    const labels = buildReviewCodingLabels(
      [variable],
      [{ id: 'item-4', variableId: '05', name: '4. Haltestelle' }],
    );
    expect(labels.get('05')?.title).toBe('4. Haltestelle');
  });

  it('keeps descriptions as authored rather than extracting or calculating numbers', () => {
    const labels = buildReviewCodingLabels(
      [variable],
      [],
      [{ sourceVariable: '05', description: 'IV – Haltestelle' }],
    );
    expect(labels.get('05')?.title).toBe('IV – Haltestelle');
  });

  it('preserves an explicit description even when it equals the item ID', () => {
    const labels = buildReviewCodingLabels(
      [variable],
      [],
      [{ id: '4.', variableId: '05', description: '4.' }],
    );
    expect(labels.get('05')?.title).toBe('4.');
  });

  it.each(
    [
      [],
      [{ id: '05', description: '4.' }],
      [{ variableId: 'other', description: '4.' }],
      [{ sourceVariable: '05', subIdDisplay: '4', rowNumber: 4, metadata: { number: '4' } }],
      [null, '4.', { sourceVariable: 5, description: '4.' }],
    ].map((items) => ({ items })),
  )(
    'does not invent a title from identifiers, positions or unrelated metadata ($items)',
    ({ items }) => {
      expect(buildReviewCodingLabels([variable], [], items).get('05')).toEqual({
        title: 'Antwort',
        subtitle: '',
      });
    },
  );

  it('uses a neutral fallback for missing names and labels equal to identifiers', () => {
    expect(
      buildReviewCodingLabels(
        [{ ...variable, label: '05' }],
        [{ id: 'item-4', sourceVariable: '05', name: 'item-4' }],
      ).get('05'),
    ).toEqual({ title: unnamedReviewCoding, subtitle: '' });
  });

  it('resolves canonical internal IDs separately from legacy aliases', () => {
    const variables = [
      { id: 'raw', alias: 'VALUE', label: 'Basis' },
      { id: 'derived', alias: 'raw', label: 'Abgeleitet' },
    ];
    const labels = buildReviewCodingLabels(
      variables,
      [],
      [
        { variableReadOnlyId: 'raw', sourceVariable: 'raw', description: '4.' },
        { sourceVariable: 'raw', description: '7.' },
      ],
    );
    expect(labels.get('VALUE')).toEqual({ title: '4.', subtitle: 'Basis' });
    expect(labels.get('raw')).toEqual({ title: '7.', subtitle: 'Abgeleitet' });
  });

  it('does not replace an unmatched canonical ID with a different aliased variable', () => {
    expect(
      buildReviewCodingLabels(
        [variable],
        [],
        [{ variableReadOnlyId: 'missing', sourceVariable: '05', description: '4.' }],
      ).get('05')?.title,
    ).toBe('Antwort');
  });

  it.each(
    [
      [
        { sourceVariable: '05', description: '4.' },
        { sourceVariable: '05', description: '7.' },
      ],
      [
        { sourceVariable: '05', description: '4.' },
        { sourceVariable: '05', description: '' },
      ],
    ].map((items) => ({ items })),
  )('falls back on conflicting or incomplete file item descriptions ($items)', ({ items }) => {
    const labels = buildReviewCodingLabels(
      [variable],
      [{ sourceVariable: '05', name: 'Veraltete Bezeichnung' }],
      items,
    );
    expect(labels.get('05')).toEqual({ title: 'Antwort', subtitle: '' });
  });

  it('collapses identical descriptions from repeated item rows', () => {
    expect(
      buildReviewCodingLabels(
        [variable],
        [],
        [
          { sourceVariable: '05', description: ' 4. Haltestelle ' },
          { variableId: '05', description: '4.\nHaltestelle' },
        ],
      ).get('05')?.title,
    ).toBe('4. Haltestelle');
  });

  it('does not confuse duplicate internal IDs with a unique variable', () => {
    const labels = buildReviewCodingLabels(
      [
        { id: 'duplicate', alias: 'A', label: 'Alpha' },
        { id: 'duplicate', alias: 'B', label: 'Beta' },
      ],
      [],
      [{ variableReadOnlyId: 'duplicate', description: '4.' }],
    );
    expect([...labels.values()].map((label) => label.title)).toEqual(['Alpha', 'Beta']);
  });

  it('normalizes lookup references without rewriting keys or inputs', () => {
    const variables = Object.freeze([
      Object.freeze({ id: 'Internal', alias: ' Alias ', label: 'Antwort' }),
    ]);
    const items = Object.freeze([Object.freeze({ sourceVariable: 'alias', description: '4.' })]);
    const before = JSON.stringify({ variables, items });
    expect(buildReviewCodingLabels(variables, [], items).get(' Alias ')?.title).toBe('4.');
    expect(JSON.stringify({ variables, items })).toBe(before);
  });
});
