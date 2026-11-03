import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ItemViewComponent } from './item-view.component';

function createComponent(options?: { startPageData?: Record<string, unknown> }) {
  const route = {
    snapshot: {
      paramMap: {
        get: (key: string) => (key === 'acpId' ? 'acp-1' : 'item-1'),
      },
    },
  };
  const api = {
    getAcpStartPage: vi.fn().mockReturnValue(of(options?.startPageData || { featureConfig: {} })),
    getViewItems: vi.fn().mockReturnValue(of([])),
    getViewUnit: vi.fn().mockReturnValue(of(null)),
    createComment: vi.fn().mockReturnValue(of({})),
    getResponseStateWithFallback: vi.fn().mockReturnValue(of({})),
    appendAuthToken: vi.fn((value: string) => value),
  };
  const sanitizer = { bypassSecurityTrustHtml: (html: string) => html };
  const getStartPage = vi.fn();
  const voudService = {
    getStartPage,
    resolvePlayerTargetLocation: vi.fn((definition: string, variableId: string) => {
      const startPage = getStartPage(definition, variableId);
      return startPage === undefined
        ? undefined
        : {
            absolutePageIndex: startPage,
            scrollPageIndex: startPage,
            isAlwaysVisiblePage: false,
          };
    }),
    getFocusIdentifiers: vi.fn((_definition: string, variableId: string) => [variableId]),
  };

  return new ItemViewComponent(route as any, api as any, sanitizer as any, voudService as any);
}

describe('ItemViewComponent', () => {
  it('keeps player highlighting disabled when the ACP flag is missing', () => {
    const component = createComponent();

    component.ngOnInit();

    expect(component.playerFocusHighlightEnabled).toBe(false);
  });

  it('disables player highlighting when the ACP flag is set to false', () => {
    const component = createComponent({
      startPageData: {
        featureConfig: {
          enablePlayerFocusHighlight: false,
        },
      },
    });

    component.ngOnInit();

    expect(component.playerFocusHighlightEnabled).toBe(false);
  });

  it('adds the player highlight class when highlighting is enabled', () => {
    const component = createComponent();
    component.playerFocusHighlightEnabled = true;
    const doc = document.implementation.createHTMLDocument('Item View');
    const target = doc.createElement('button');
    Object.defineProperty(target, 'scrollIntoView', { value: vi.fn(), writable: true });
    Object.defineProperty(target, 'focus', { value: vi.fn(), writable: true });
    doc.body.appendChild(target);

    (component as any).applyFocus(doc, target);

    expect(target.classList.contains('ch-item-focus-highlight')).toBe(true);
    expect(component.highlightApplied).toBe(true);
  });

  it('keeps focus behavior without adding the highlight class when highlighting is disabled', () => {
    const component = createComponent();
    component.playerFocusHighlightEnabled = false;
    const doc = document.implementation.createHTMLDocument('Item View');
    const target = doc.createElement('button');
    Object.defineProperty(target, 'scrollIntoView', { value: vi.fn(), writable: true });
    Object.defineProperty(target, 'focus', { value: vi.fn(), writable: true });
    doc.body.appendChild(target);

    (component as any).applyFocus(doc, target);

    expect(target.classList.contains('ch-item-focus-highlight')).toBe(false);
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(target.focus).toHaveBeenCalled();
    expect(component.highlightApplied).toBe(true);
  });
});
