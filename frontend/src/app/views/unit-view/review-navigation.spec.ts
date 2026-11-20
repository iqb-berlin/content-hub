import { describe, expect, it, vi } from 'vitest';
import { PlayerTargetIdentifierKind, VoudService } from '../../core/services/voud.service';
import { ReviewNavigationResolver } from './review-navigation';

describe('Review navigation targets', () => {
  const definition = JSON.stringify({
    pages: [{ elements: [{ alias: 'FIRST' }] }, { elements: [{ alias: 'SECOND' }] }],
  });
  const voud = new VoudService();
  const locate = (id: string, kind?: PlayerTargetIdentifierKind) =>
    voud.resolvePlayerTargetLocation(definition, id, kind);

  it.each(['variableId', 'sourceVariable'] as const)(
    'prefers an exact internal ID over a colliding alias for legacy %s references',
    (reference) => {
      const resolver = new ReviewNavigationResolver(
        [
          { id: 'a', alias: 'FIRST', sourceType: 'BASE' },
          { id: 'b', alias: 'a', sourceType: 'BASE' },
        ],
        ['FIRST', 'a'],
        locate,
      );
      expect(resolver.forItem({ [reference]: 'a' }, ['I1'])).toMatchObject({
        codingId: 'FIRST',
        locations: [{ scrollPageIndex: 0 }],
      });
      expect(resolver.forItem({ [reference]: 'FIRST' }, ['I1'])?.codingId).toBe('FIRST');
    },
  );

  it.each([undefined, 'stale'])(
    'prefers sourceVariable to a conflicting variableId with internal ID %s',
    (variableReadOnlyId) => {
      const resolver = new ReviewNavigationResolver(
        [
          { id: 'a', alias: 'FIRST' },
          { id: 'b', alias: 'SECOND' },
        ],
        ['FIRST', 'SECOND'],
        locate,
      );
      expect(
        resolver.forItem({ variableReadOnlyId, sourceVariable: 'b', variableId: 'a' }, ['I1']),
      ).toMatchObject({ codingId: 'SECOND', locations: [{ scrollPageIndex: 1 }] });
    },
  );

  it('keeps a nested aggregate active on every source page and deduplicates repeated sources', () => {
    const resolver = new ReviewNavigationResolver(
      [
        { id: 'a', alias: 'FIRST', sourceType: 'BASE' },
        { id: 'b', alias: 'SECOND', sourceType: 'BASE' },
        { id: 'inner', sourceType: 'SUM_SCORE', deriveSources: ['a', 'b'] },
        { id: 'outer', alias: 'TOTAL', sourceType: 'SUM_SCORE', deriveSources: ['inner', 'a'] },
      ],
      ['FIRST', 'SECOND', 'inner', 'TOTAL'],
      locate,
    );
    const target = resolver.forItem({ variableReadOnlyId: 'outer' }, ['I1']);
    expect(target?.codingId).toBe('TOTAL');
    expect(target?.locations.map((location) => location.scrollPageIndex)).toEqual([0, 1]);
  });

  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('uses the exact source ID for inheritance with sources %s, %s', (first, second) => {
    const resolver = new ReviewNavigationResolver(
      [
        { id: 'a', alias: 'FIRST' },
        { id: 'b', alias: 'a' },
        { id: 'sum', sourceType: 'SUM_SCORE', deriveSources: [first, second] },
      ],
      ['FIRST', 'a', 'sum'],
      locate,
    );
    expect(resolver.forItem({ variableReadOnlyId: 'sum', sourceVariable: 'a' }, [])).toMatchObject({
      codingId: 'sum',
      sourceCodingId: 'FIRST',
    });
  });

  it('inherits only from a unique alias among the sources of the selected aggregate', () => {
    const resolver = new ReviewNavigationResolver(
      [
        { id: 'a', alias: 'FIRST' },
        { id: 'b', alias: 'FIRST' },
        { id: 'FIRST', alias: 'SECOND' },
        { id: 'sum', sourceType: 'SUM_SCORE', deriveSources: ['a', 'b'] },
        { id: 'single', sourceType: 'COPY_VALUE', deriveSources: ['b', 'b'] },
      ],
      ['a', 'b', 'SECOND', 'sum', 'single'],
      locate,
    );
    expect(
      resolver.forItem({ variableReadOnlyId: 'sum', sourceVariable: 'FIRST' }, [])?.sourceCodingId,
    ).toBeUndefined();
    expect(
      resolver.forItem({ variableReadOnlyId: 'single', sourceVariable: 'FIRST' }, [])
        ?.sourceCodingId,
    ).toBe('b');
  });

  it('resolves deriveSources as internal IDs before colliding public aliases', () => {
    const resolver = new ReviewNavigationResolver(
      [
        { id: 'a', alias: 'FIRST', sourceType: 'BASE' },
        { id: 'b', alias: 'a', sourceType: 'BASE' },
        { id: 'sum', sourceType: 'SUM_SCORE', deriveSources: ['a'] },
      ],
      ['FIRST', 'a', 'sum'],
      locate,
    );
    expect(resolver.forVariable(2)?.locations[0].scrollPageIndex).toBe(0);
  });

  it('does not reinterpret a missing strict internal ID as a public alias or item ID', () => {
    const resolver = new ReviewNavigationResolver(
      [{ id: 'a', alias: 'FIRST', sourceType: 'BASE' }],
      ['FIRST'],
      locate,
    );
    expect(resolver.forItem({ variableReadOnlyId: 'FIRST' }, ['FIRST'])).toBeUndefined();
  });

  it('uses the strict internal ID even when the legacy variable reference points elsewhere', () => {
    const resolver = new ReviewNavigationResolver(
      [
        { id: 'a', alias: 'FIRST', sourceType: 'BASE' },
        { id: 'b', alias: 'SECOND', sourceType: 'BASE' },
      ],
      ['FIRST', 'SECOND'],
      locate,
    );
    expect(
      resolver.forItem({ variableReadOnlyId: 'b', variableId: 'FIRST' }, ['I1']),
    ).toMatchObject({ codingId: 'SECOND', locations: [{ scrollPageIndex: 1 }] });
  });

  it.each(['variableId', 'sourceVariable'] as const)(
    'locates an explicit %s before its coding scheme is available without guessing a coding',
    (reference) => {
      const resolver = new ReviewNavigationResolver([], [], locate);
      const target = resolver.forItem(
        { variableReadOnlyId: 'internal-second', [reference]: 'SECOND' },
        ['I2'],
      );
      expect(target?.locations.map((location) => location.scrollPageIndex)).toEqual([1]);
      expect(target?.codingId).toBeUndefined();
    },
  );

  it('recovers a stale internal ID through an unambiguous legacy reference', () => {
    const resolver = new ReviewNavigationResolver(
      [{ id: 'b', alias: 'SECOND', sourceType: 'BASE' }],
      ['SECOND'],
      locate,
    );
    expect(
      resolver.forItem({ variableReadOnlyId: 'stale', variableId: 'SECOND' }, ['I2']),
    ).toMatchObject({ codingId: 'SECOND', locations: [{ scrollPageIndex: 1 }] });
  });

  it.each(['variableId', 'sourceVariable'] as const)(
    'keeps the player location without a coding when %s matches one ID and another alias',
    (reference) => {
      const resolver = new ReviewNavigationResolver(
        [
          { id: 'FIRST', alias: 'SECOND', sourceType: 'BASE' },
          { id: 'b', alias: 'FIRST', sourceType: 'BASE' },
        ],
        ['SECOND', 'FIRST'],
        locate,
      );
      const target = resolver.forItem({ variableReadOnlyId: 'stale', [reference]: 'FIRST' }, [
        'I1',
      ]);
      expect(target).toMatchObject({
        locations: [{ scrollPageIndex: 0 }],
        directLocation: { scrollPageIndex: 0 },
      });
      expect(target?.codingId).toBeUndefined();
    },
  );

  it('resolves shared sources once across nested aggregates', () => {
    const lookup = vi.fn(locate);
    const variables = [
      { id: 'FIRST', sourceType: 'BASE', deriveSources: [] },
      { id: 'SECOND', sourceType: 'BASE', deriveSources: [] },
    ];
    let sources = ['FIRST', 'SECOND'];
    for (let level = 1; level <= 6; level++) {
      const ids = [`left-${level}`, `right-${level}`];
      variables.push(...ids.map((id) => ({ id, sourceType: 'SUM_SCORE', deriveSources: sources })));
      sources = ids;
    }
    variables.push({ id: 'total', sourceType: 'SUM_SCORE', deriveSources: sources });
    const resolver = new ReviewNavigationResolver(
      variables,
      variables.map((v) => v.id),
      lookup,
    );
    for (let index = variables.length - 1; index >= 2; index--) {
      expect(
        resolver
          .forVariable(index)
          ?.locations.map((page) => page.scrollPageIndex)
          .sort(),
      ).toEqual([0, 1]);
    }
    expect(lookup.mock.calls).toEqual([
      ['FIRST', 'id'],
      ['FIRST', 'alias'],
      ['SECOND', 'id'],
      ['SECOND', 'alias'],
    ]);
  });

  it('terminates cyclic derivations and preserves independently reachable source pages', () => {
    const resolver = new ReviewNavigationResolver(
      [
        { id: 'a', alias: 'FIRST', sourceType: 'BASE' },
        { id: 'x', sourceType: 'SUM_SCORE', deriveSources: ['y', 'a'] },
        { id: 'y', sourceType: 'SUM_SCORE', deriveSources: ['x'] },
        { id: 'self', sourceType: 'SUM_SCORE', deriveSources: ['self'] },
      ],
      ['FIRST', 'x', 'y', 'self'],
      locate,
    );
    expect(resolver.forVariable(3)).toBeUndefined();
    expect(resolver.forVariable(1)?.locations).toHaveLength(1);
    expect(resolver.forVariable(2)?.locations).toHaveLength(1);
    expect(
      resolver.forItem({ variableReadOnlyId: 'y', sourceVariable: 'FIRST' }, []),
    ).toMatchObject({
      codingId: 'y',
      sourceCodingId: 'FIRST',
      directLocation: { scrollPageIndex: 0 },
    });
    expect(
      resolver.forItem({ variableReadOnlyId: 'self', sourceVariable: 'self' }, [])?.sourceCodingId,
    ).toBeUndefined();
  });
});
