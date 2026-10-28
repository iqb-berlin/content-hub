import { describe, expect, it } from 'vitest';
import { resolveDropListTarget } from './voud-drop-lists';

function definition() {
  return [
    {
      type: 'drop-list',
      id: 'pool',
      alias: 'POOL',
      onlyOneItem: false,
      copyOnDrop: false,
      isSortList: false,
      connectedTo: ['slot'],
      value: [{ id: 'internal-token', alias: 'TOKEN', text: 'Text' }],
    },
    {
      type: 'drop-list',
      id: 'slot',
      alias: 'SLOT',
      onlyOneItem: true,
      copyOnDrop: false,
      isSortList: false,
      connectedTo: ['pool'],
      value: [],
    },
  ];
}

describe('resolveDropListTarget', () => {
  it('resolves connected source aliases, including objects embedded in a cloze model', () => {
    const nodes = definition();
    const pages = [
      { doc: { content: [{ attrs: { model: nodes[0] } }, { attrs: { model: nodes[1] } }] } },
    ];
    const result = resolveDropListTarget(pages, nodes[1], String);
    expect(result?.valueOptions).toEqual([{ value: 'TOKEN', label: 'Text' }]);
    expect(result?.dropLists.map((list) => list.responseId)).toEqual(['POOL', 'SLOT']);
  });
  it.each([
    'missing-connection',
    'duplicate-token',
    'duplicate-id',
    'duplicate-alias',
    'sorting',
    'multiple',
    'prepopulated',
    'whitespace-id',
    'whitespace-alias',
    'whitespace-token',
  ])('rejects unsafe %s configurations', (kind) => {
    const nodes = definition();
    if (kind === 'missing-connection') nodes[0].connectedTo = ['missing'];
    if (kind === 'duplicate-token') nodes[0].value.push({ ...nodes[0].value[0] });
    if (kind === 'duplicate-id') nodes[1].id = nodes[0].id;
    if (kind === 'duplicate-alias') nodes[1].alias = nodes[0].alias;
    if (kind === 'sorting') nodes[1].isSortList = true;
    if (kind === 'multiple') nodes[1].onlyOneItem = false;
    if (kind === 'prepopulated') nodes[1].value = [{ ...nodes[0].value[0], alias: 'OTHER' }];
    if (kind === 'whitespace-id') nodes[1].id = ' slot ';
    if (kind === 'whitespace-alias') nodes[1].alias = ' SLOT ';
    if (kind === 'whitespace-token') nodes[0].value[0].alias = ' TOKEN ';
    expect(resolveDropListTarget(nodes, nodes[1], String)).toBeUndefined();
  });
  it('does not use a token from a palette that cannot reach the target', () => {
    const nodes = definition();
    nodes[0].connectedTo = [];
    expect(resolveDropListTarget(nodes, nodes[1], String)).toBeUndefined();
  });
  it('ignores references inside visibility rules and excludes unrelated groups', () => {
    const nodes = definition();
    const pages = [
      { elements: nodes, visibilityRules: [{ type: 'drop-list', id: 'bad' }] },
      {
        elements: [
          {
            ...nodes[0],
            id: 'elsewhere',
            alias: 'ELSE',
            connectedTo: [],
            value: [{ alias: 'OTHER' }],
          },
        ],
      },
    ];
    expect(resolveDropListTarget(pages, nodes[1], String)?.dropLists).toHaveLength(2);
  });
});
