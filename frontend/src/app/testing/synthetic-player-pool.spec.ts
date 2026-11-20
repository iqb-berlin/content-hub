import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = resolve(__dirname, '../../../../test-fixtures/synthetic-players');
const read = (file: string) => JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
const pool = read('pool.json');
const catalogue = read('catalogue.json');
interface Entry {
  id: string;
  file: string;
  player: string;
  formats: string[];
  probe: string;
}
const units = pool.units as Entry[];

function elementTypes(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(elementTypes);
  const object = value as Record<string, unknown>;
  return [
    ...(typeof object['id'] === 'string' && typeof object['type'] === 'string'
      ? [object['type']]
      : []),
    ...Object.values(object).flatMap(elementTypes),
  ];
}

describe('versioned synthetic format coverage', () => {
  it('covers every registered ASPECT element including nested cells, cloze fields and Likert rows', () => {
    const actual = new Set(
      units
        .filter((unit) => unit.player === 'aspect')
        .flatMap((unit) => elementTypes(read(unit.file).definition)),
    );
    expect([...actual].sort()).toEqual([...catalogue.aspect.types].sort());
    expect(actual.size).toBe(30);
  });

  it('represents all released IQB player families and the experimental ItemBuilder wrapper', () => {
    expect([...new Set(units.map((unit) => unit.player))].sort()).toEqual([
      'abi',
      'aspect',
      'ib',
      'simple',
      'speed-mono',
      'speed-multi',
    ]);
    expect(pool.players.map((player: { id: string }) => player.id).sort()).toEqual(
      [...catalogue.families].sort(),
    );
    expect(new Set(units.map((unit) => unit.id)).size).toBe(units.length);
    for (const unit of units) expect(unit.probe).toBeTruthy();
  });

  it('covers every ABI input directive plus conditional and repeated form blocks', () => {
    const actual = new Set(
      units.filter((unit) => unit.player === 'abi').flatMap((unit) => unit.formats),
    );
    expect([...actual].sort()).toEqual([...catalogue.abi.formats].sort());
  });

  it('covers every Speedtest Multi stimulus and answer type', () => {
    const actual = units
      .filter((unit) => unit.player === 'speed-multi')
      .map((unit) => read(unit.file).definition);
    expect([...new Set(actual.map((unit) => unit.questionType))].sort()).toEqual(
      [...catalogue.speedMulti.questionTypes].sort(),
    );
    expect([...new Set(actual.map((unit) => unit.answerType))].sort()).toEqual(
      [...catalogue.speedMulti.answerTypes].sort(),
    );
    expect(actual.some((unit) => unit.multipleSelection)).toBe(true);
    expect(new Set(actual.map((unit) => unit.layout))).toEqual(new Set(['column', 'row']));
  });

  it('verifies the original player bytes independently of the seed', () => {
    for (const player of pool.players) {
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(directory, player.file)))
          .digest('hex'),
      ).toBe(player.sha256);
      expect(new URL(player.source).protocol).toBe('https:');
    }
  });
});
