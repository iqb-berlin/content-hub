/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

const productionSources = import.meta.glob(['../**/*.html', '../**/*.ts', '!../**/*.spec.ts'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

interface ButtonSource {
  block: string;
  file: string;
  line: number;
}

function getButtons(): ButtonSource[] {
  return Object.entries(productionSources).flatMap(([file, source]) =>
    Array.from(source.matchAll(/<button\b[\s\S]*?<\/button>/g), (match) => ({
      block: match[0],
      file,
      line: source.slice(0, match.index).split('\n').length,
    })),
  );
}

function location(button: ButtonSource): string {
  return `${button.file}:${button.line}`;
}

describe('stateful button audit', () => {
  const buttons = getButtons();

  it('couples every shared state style to semantic state', () => {
    const stateButtons = buttons.filter(({ block }) => /class="[^"]*\bbtn-state\b/.test(block));
    const invalid = stateButtons.filter(
      ({ block }) => !/\[attr\.aria-(pressed|expanded)\]=/.test(block),
    );

    expect(stateButtons.length).toBeGreaterThanOrEqual(18);
    expect(invalid.map(location)).toEqual([]);
    expect(Object.values(productionSources).join('\n')).not.toContain('btn-state-indicator');
  });

  it('does not combine the primary and outline variants', () => {
    const conflicting = buttons.filter(({ block }) => {
      const hasPrimary =
        /class="[^"]*\bbtn-primary\b/.test(block) || /\[class\.btn-primary\]=/.test(block);
      const hasOutline =
        /class="[^"]*\bbtn-outline\b/.test(block) || /\[class\.btn-outline\]=/.test(block);
      return hasPrimary && hasOutline;
    });

    expect(conflicting.map(location)).toEqual([]);
  });

  it('marks direct boolean disclosures as expanded state buttons', () => {
    const disclosures = buttons.filter(({ block }) => /\(click\)="[^"]*=\s*!/.test(block));
    const invalid = disclosures.filter(
      ({ block }) =>
        !/class="[^"]*\bbtn-state\b/.test(block) || !/\[attr\.aria-expanded\]=/.test(block),
    );

    // Native disclosures (such as the AP index details) need no state button.
    expect(disclosures.length).toBeGreaterThan(0);
    expect(invalid.map(location)).toEqual([]);
  });

  it('gives custom active selections pressed, selected or current-item semantics', () => {
    const activeSelections = buttons.filter(({ block }) => /\[class\.active\]=/.test(block));
    const invalid = activeSelections.filter(
      ({ block }) => !/\[attr\.aria-(pressed|selected|current)\]=/.test(block),
    );

    expect(activeSelections.length).toBeGreaterThanOrEqual(7);
    expect(invalid.map(location)).toEqual([]);
  });

  it.each([
    ['../ap-manager/files/file-preview-panel.component.ts', 'Vorschauformat', 3],
    ['../views/unit-view/unit-view.component.ts', 'Zusatzdaten', 5],
  ])('keeps %s as a native button group with exclusive pressed state', (file, label, count) => {
    const source = productionSources[file];
    expect(source).toContain(`role="group" aria-label="${label}"`);
    expect(source).not.toMatch(/role="tab(list)?"/);
    const selections = buttons.filter(
      (button) => button.file === file && /\[class\.active\]=/.test(button.block),
    );
    expect(selections).toHaveLength(count);
    for (const { block } of selections) {
      expect(block).toContain('type="button"');
      expect(block).toMatch(/\[attr\.aria-pressed\]="activeTab === '/);
      expect(block).not.toContain('aria-selected');
      expect(block).not.toContain('tabindex');
    }
  });
});
