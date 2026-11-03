import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = resolve(__dirname, '../../../../test-fixtures/player-generations');
const documents = new Map<string, ReturnType<typeof JSON.parse>>();
const read = (file: string) => {
  if (!documents.has(file))
    documents.set(file, JSON.parse(readFileSync(resolve(directory, file), 'utf8')));
  return documents.get(file);
};
const pool = read('pool.json');
const coverage = read('authoring/coverage.json').coverage;
interface Unit {
  id: string;
  file: string;
  player: string;
  element?: string;
  authoringCases?: { id: string; changes: Record<string, unknown> }[];
}
interface Property {
  type: string;
  values?: unknown[];
  properties?: Record<string, Property>;
}
interface Setting {
  major: number;
  element: string;
  path: string;
  values: unknown[];
  cases: { unit: string; page: number; case: string }[];
}
const units = pool.units as Unit[];
function leaves(
  schema: Record<string, Property>,
  defaults: Record<string, unknown>,
  prefix = '',
): [string, Property][] {
  return Object.entries(schema).flatMap(([key, descriptor]) => {
    if (['id', 'alias', 'type', 'idService'].includes(key) || !Object.hasOwn(defaults, key))
      return [];
    const value = defaults[key];
    return descriptor.properties && value && typeof value === 'object' && !Array.isArray(value)
      ? leaves(descriptor.properties, value as Record<string, unknown>, prefix + key + '.')
      : [[prefix + key, descriptor]];
  });
}
describe('pinned player generations and authoring coverage', () => {
  it('covers the released major versions and explicitly records the missing Simple 3 release', () => {
    const actual = Object.fromEntries(
      ['abi', 'aspect', 'simple', 'speed-mono', 'speed-multi', 'ib'].map((family) => [
        family,
        pool.players
          .filter((p: { family: string }) => p.family === family)
          .map((p: { major: number }) => p.major),
      ]),
    );
    expect(actual).toEqual({
      abi: [1, 2, 3, 4, 5],
      aspect: [0, 1, 2, 3],
      simple: [1, 2, 4, 5, 6],
      'speed-mono': [1],
      'speed-multi': [0, 1, 2, 3],
      ib: [0],
    });
    expect(
      pool.absentMajors.some(
        (p: { family: string; major: number }) => p.family === 'simple' && p.major === 3,
      ),
    ).toBe(true);
    for (const editor of pool.editors)
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(directory, editor.file)))
          .digest('hex'),
      ).toBe(editor.sha256);
    for (const player of pool.players) {
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(directory, player.file)))
          .digest('hex'),
        player.id,
      ).toBe(player.sha256);
      expect(
        units.some((unit) => unit.player === player.id),
        player.id,
      ).toBe(true);
    }
  });
  it('has an ordinary task for every registered ASPECT element in every major', () => {
    for (const major of [0, 1, 2, 3]) {
      const snapshot = read(`authoring/aspect-${major}.json`);
      expect(Object.keys(snapshot.types)).toHaveLength([11, 22, 27, 31][major]);
      expect(
        units
          .filter((unit) => unit.player === `aspect-m${major}` && unit.element)
          .map((unit) => unit.element)
          .sort(),
      ).toEqual(Object.keys(snapshot.types).sort());
    }
  });
  it('represents all declared finite enum values and both boolean states in actual task pages', () => {
    for (const major of [0, 1, 2, 3]) {
      const snapshot = read(`authoring/aspect-${major}.json`);
      for (const [type, model] of Object.entries(snapshot.types) as [
        string,
        { schema: Record<string, Property>; defaults: Record<string, unknown> },
      ][]) {
        for (const [path, property] of leaves(model.schema, model.defaults)) {
          const setting = coverage.find(
            (entry: Setting) =>
              entry.major === major && entry.element === type && entry.path === path,
          ) as Setting;
          expect(setting, `${major}/${type}/${path}`).toBeTruthy();
          if (property.values)
            for (const option of property.values) expect(setting.values).toContainEqual(option);
          if (property.type.includes('boolean')) {
            expect(setting.values).toContain(false);
            expect(setting.values).toContain(true);
          }
          for (const scenario of setting.cases) {
            const task = units.find((unit) => unit.id === scenario.unit)!;
            const first = read(task.file).definition.pages[scenario.page].sections[0].elements[0];
            const target = type === 'likert-row' ? first.rows[0] : first;
            const actual = path.split('.').reduce((value, key) => value?.[key], target);
            expect(actual, `${task.id}/${scenario.case}`).toEqual(
              task.authoringCases![scenario.page].changes[path],
            );
          }
        }
      }
    }
  });
  it('maps every discovered UI property to stored settings or a documented editor control', () => {
    const ui = read('authoring/ui-controls.json'),
      mapping = read('authoring/ui-control-mapping.json');
    expect(Object.keys(ui.panelBaseline)).toHaveLength(62);
    const covered = new Set(
      coverage
        .filter((entry: Setting) => entry.major === 3)
        .map((entry: Setting) => entry.path.split('.').at(-1)),
    );
    for (const name of Object.keys(ui.controls))
      expect(covered.has(name) || name in mapping.groups || name in mapping.editorOnly, name).toBe(
        true,
      );
  });
  it('contains successful exports from every assistant and valid identifiers in every task', () => {
    const authored = read('authoring/ui-created-tasks.json');
    expect(authored.errors).toEqual([]);
    expect(authored.tasks).toHaveLength(66);
    expect([...new Set(authored.tasks.map((t: { wizard: string }) => t.wizard))].sort()).toEqual(
      [
        'Stimulus',
        'MC',
        'CMC',
        'Antwortfeld(er)',
        'Kontrollkästchen',
        'Drag & Drop',
        'Markieren',
        'Rechenkästchen',
        'GeoGebra',
        'Aufgabenidee',
      ].sort(),
    );
    expect(new Set(units.map((unit) => unit.id)).size).toBe(units.length);
    expect(
      readdirSync(resolve(directory, 'units'))
        .filter((file) => file.endsWith('.json'))
        .sort(),
    ).toEqual(units.map((unit) => unit.file.split('/').at(-1)).sort());
    for (const task of units) {
      expect(read(task.file).id).toBe(task.id);
      const ids: string[] = [];
      function visit(value: unknown) {
        if (!value || typeof value !== 'object') return;
        const object = value as Record<string, unknown>;
        if (typeof object['type'] === 'string' && typeof object['id'] === 'string')
          ids.push(object['id']);
        for (const child of Object.values(object)) visit(child);
      }
      visit(read(task.file).definition);
      expect(new Set(ids).size, task.id).toBe(ids.length);
    }
  });
});
