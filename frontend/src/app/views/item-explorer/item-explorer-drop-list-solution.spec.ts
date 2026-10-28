import { describe, expect, it } from 'vitest';
import { PlayerDropList } from '../../core/services/voud-drop-lists';
import { mergePlayerSolutionIntoDataParts } from './item-explorer-solution-prefill';
import { validateDropListAssignments } from './item-explorer-drop-list-solution';

const lists = (copyOnDrop = false): PlayerDropList[] => [
  {
    id: 'pool',
    responseId: 'POOL',
    connectedTo: ['a', 'b'],
    onlyOneItem: false,
    copyOnDrop,
    items: [
      { value: 'X', label: 'First' },
      { value: 'Y', label: 'Second' },
      { value: 'Z', label: 'Third' },
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
const solution = (id: string, value: string) => ({
  id,
  value: [value],
  status: 'VALUE_CHANGED' as const,
});

describe('drag-and-drop solution state', () => {
  it('moves the solution token from its source while preserving unrelated data parts', () => {
    const data = {
      elementCodes: JSON.stringify([{ id: 'OTHER', value: 'untouched' }]),
      stateVariableCodes: 'state',
    };
    const result = mergePlayerSolutionIntoDataParts(data, [solution('A', 'X')], lists());
    expect(JSON.parse(result['elementCodes'])).toEqual([
      { id: 'OTHER', value: 'untouched' },
      { id: 'POOL', value: ['Y', 'Z'], status: 'VALUE_CHANGED' },
      solution('A', 'X'),
      { id: 'B', value: [], status: 'VALUE_CHANGED' },
    ]);
    expect(result['stateVariableCodes']).toBe('state');
    expect(data.elementCodes).toBe(JSON.stringify([{ id: 'OTHER', value: 'untouched' }]));
  });
  it('returns displaced objects and removes a reserved token from a previous target', () => {
    const data = { elementCodes: JSON.stringify([solution('A', 'Y'), solution('B', 'X')]) };
    const result = JSON.parse(
      mergePlayerSolutionIntoDataParts(data, [solution('A', 'X')], lists())['elementCodes'],
    );
    expect(result.find((r: { id: string }) => r.id === 'POOL').value).toEqual(['Y', 'Z']);
    expect(result.find((r: { id: string }) => r.id === 'B').value).toEqual([]);
  });
  it('keeps another valid placement in the same group', () => {
    const result = JSON.parse(
      mergePlayerSolutionIntoDataParts(
        { elementCodes: JSON.stringify([solution('B', 'Y')]) },
        [solution('A', 'X')],
        lists(),
      )['elementCodes'],
    );
    expect(result.find((r: { id: string }) => r.id === 'B').value).toEqual(['Y']);
    expect(result.find((r: { id: string }) => r.id === 'POOL').value).toEqual(['Z']);
  });
  it('keeps copyable objects in the palette and permits their reuse', () => {
    expect(validateDropListAssignments(lists(true), [solution('A', 'X'), solution('B', 'X')])).toBe(
      true,
    );
    const result = JSON.parse(
      mergePlayerSolutionIntoDataParts(null, [solution('A', 'X'), solution('B', 'X')], lists(true))[
        'elementCodes'
      ],
    );
    expect(result.find((r: { id: string }) => r.id === 'POOL').value).toEqual(['X', 'Y', 'Z']);
  });
  it.each([
    [solution('A', 'X'), solution('B', 'X')],
    [solution('A', 'unknown')],
    [{ id: 'A', value: ['X', 'Y'] }],
    [{ id: 'A', value: 'X' }],
  ])('rejects unknown, duplicate or non-singleton assignments %#', (...responses) => {
    expect(validateDropListAssignments(lists(), responses)).toBe(false);
  });
  it('does not import invalid existing values into the preview group', () => {
    const result = JSON.parse(
      mergePlayerSolutionIntoDataParts(
        { elementCodes: JSON.stringify([{ id: 'B', value: ['unknown'] }]) },
        [solution('A', 'X')],
        lists(),
      )['elementCodes'],
    );
    expect(result.find((r: { id: string }) => r.id === 'B').value).toEqual([]);
  });
});
