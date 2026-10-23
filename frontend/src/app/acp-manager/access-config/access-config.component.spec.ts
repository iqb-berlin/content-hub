import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';
import { AccessConfigComponent } from './access-config.component';

@Component({
  selector: 'app-acp-manager-context',
  standalone: true,
  template: '',
})
class AcpManagerContextStubComponent {}

describe('AccessConfigComponent', () => {
  let api: {
    getAccessConfig: ReturnType<typeof vi.fn>;
    getCredentials: ReturnType<typeof vi.fn>;
    createCredential: ReturnType<typeof vi.fn>;
    updateAccessConfig: ReturnType<typeof vi.fn>;
  };

  const route = {
    parent: {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('acp-1'),
        },
      },
    },
  };

  beforeEach(() => {
    api = {
      getAccessConfig: vi.fn().mockReturnValue(
        of({
          accessModel: 'PUBLIC',
          allowRegistered: false,
          featureConfig: {},
        }),
      ),
      getCredentials: vi.fn().mockReturnValue(of([])),
      createCredential: vi.fn(),
      updateAccessConfig: vi.fn().mockReturnValue(of({})),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('adding credentials', () => {
    async function renderCredentialForm() {
      api.getAccessConfig.mockReturnValue(
        of({ accessModel: 'CREDENTIALS_LIST', featureConfig: {} }),
      );
      await TestBed.configureTestingModule({
        imports: [AccessConfigComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          { provide: ActivatedRoute, useValue: route },
          { provide: ApiService, useValue: api },
        ],
      })
        .overrideComponent(AccessConfigComponent, {
          remove: { imports: [AcpManagerContextComponent] },
          add: { imports: [AcpManagerContextStubComponent] },
        })
        .compileComponents();
      const fixture = TestBed.createComponent(AccessConfigComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      const root: HTMLElement = fixture.nativeElement;
      const form = root.querySelector<HTMLElement>('.manual-add-form')!;
      const username = form.querySelector<HTMLInputElement>('input[type="text"]')!;
      const password = form.querySelector<HTMLInputElement>('input[type="password"]')!;
      const submit = form.querySelector<HTMLButtonElement>('button')!;
      async function fill(value: string, secret: string) {
        username.value = value;
        username.dispatchEvent(new Event('input'));
        password.value = secret;
        password.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      }
      return { fixture, root, form, username, password, submit, fill };
    }

    it('explains password requirements and reports invalid input when adding a credential', async () => {
      const { fixture, form, submit, fill } = await renderCredentialForm();
      await fill('reviewer', 'short');

      expect(submit.disabled).toBe(false);
      submit.click();
      await fixture.whenStable();

      expect(form.querySelector('[role="alert"]')?.textContent).toContain(
        'Kennwort muss mindestens 12 Zeichen lang sein',
      );
      expect(api.createCredential).not.toHaveBeenCalled();
    });

    it('shows progress, prevents duplicate submissions and renders the created credential after an asynchronous response', async () => {
      const response = new Subject<any>();
      api.createCredential.mockReturnValue(response);
      const { fixture, root, form, username, password, submit, fill } =
        await renderCredentialForm();
      await fill(' reviewer ', 'ValidPassword123!');
      form.querySelector<HTMLInputElement>('input[aria-label="Review: teilnehmen"]')!.click();
      await fixture.whenStable();

      submit.click();
      await fixture.whenStable();
      expect(submit.disabled).toBe(true);
      expect(submit.textContent).toContain('Wird hinzugefügt');
      fixture.componentInstance.addCredential();
      expect(api.createCredential).toHaveBeenCalledExactlyOnceWith(
        'acp-1',
        'reviewer',
        'ValidPassword123!',
        ['review:participate'],
      );

      response.next({
        id: 'credential-1',
        username: 'reviewer',
        capabilities: ['review:participate'],
      });
      response.complete();
      await fixture.whenStable();

      expect(root.querySelector('.credentials-table tbody')?.textContent).toContain('reviewer');
      expect(form.querySelector('[role="status"]')?.textContent).toContain('reviewer');
      expect(username.value).toBe('');
      expect(password.value).toBe('');
      expect(submit.disabled).toBe(false);
      expect(fixture.componentInstance.credentialCount).toBe(1);
    });

    it('renders a server error, retains the entered values and allows retry', async () => {
      const response = new Subject<any>();
      api.createCredential.mockReturnValue(response);
      const { fixture, root, form, username, password, submit, fill } =
        await renderCredentialForm();
      await fill('reviewer', 'ValidPassword123!');
      submit.click();
      await fixture.whenStable();

      response.error({ error: { message: 'Zugang konnte nicht angelegt werden.' } });
      await fixture.whenStable();

      expect(form.querySelector('[role="alert"]')?.textContent).toContain(
        'Zugang konnte nicht angelegt werden.',
      );
      expect(form.querySelector('[role="status"]')).toBeNull();
      expect(username.value).toBe('reviewer');
      expect(password.value).toBe('ValidPassword123!');
      expect(submit.disabled).toBe(false);

      api.createCredential.mockReturnValue(of({ id: 'credential-1', username: 'reviewer' }));
      submit.click();
      await fixture.whenStable();
      expect(api.createCredential).toHaveBeenCalledTimes(2);
      expect(root.querySelectorAll('.credentials-table tbody tr')).toHaveLength(1);
      expect(form.querySelector('[role="alert"]')).toBeNull();
      expect(form.querySelector('[role="status"]')?.textContent).toContain('reviewer');
    });
  });

  it('renders and binds all four start-page visibility switches', async () => {
    await TestBed.configureTestingModule({
      imports: [AccessConfigComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
      ],
    })
      .overrideComponent(AccessConfigComponent, {
        remove: { imports: [AcpManagerContextComponent] },
        add: { imports: [AcpManagerContextStubComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AccessConfigComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const sections = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.feature-section'),
    );
    const startPageSection = sections.find((section) =>
      section.querySelector('h3')?.textContent?.includes('Auf dieser Startseite anzeigen'),
    );
    const labels = Array.from(startPageSection?.querySelectorAll('label') || []).map((label) =>
      label.textContent?.trim(),
    );
    const checkboxes = Array.from(
      startPageSection?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') || [],
    );

    expect(labels).toEqual([
      'Item-Explorer',
      'Aufgaben ansehen',
      'Testhefte und Aufgabenfolgen',
      'Paketstruktur (ACP-Index)',
    ]);
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);

    checkboxes[3].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.featureConfig.showIndexOnStartPage).toBe(false);
  });

  it('keeps start-page entries visible by default and preserves an explicit false value', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: { showIndexOnStartPage: false },
      }),
    );
    const component = new AccessConfigComponent(route as any, api as any);

    component.loadConfig();

    expect(component.featureConfig).toEqual(
      expect.objectContaining({
        showItemExplorerOnStartPage: true,
        showUnitListOnStartPage: true,
        showSequencesOnStartPage: true,
        showIndexOnStartPage: false,
      }),
    );
  });

  it('migrates the legacy unit-list visibility into the new start-page setting', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: { enableUnitListNavigation: false },
      }),
    );
    const component = new AccessConfigComponent(route as any, api as any);

    component.loadConfig();

    expect(component.featureConfig.showUnitListOnStartPage).toBe(false);
  });

  it('stores the reduced view directly with access settings and permits a reset', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.loadConfig();
    expect(component.reducedView.enabled).toBe(false);
    component.applyReducedViewProfile('table');
    component.reducedView.headerActions.columnManager = false;
    expect(component.hasUnsavedChanges).toBe(true);
    component.saveFeatures();
    expect(api.updateAccessConfig).toHaveBeenLastCalledWith(
      '',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          itemExplorerReducedView: expect.objectContaining({
            enabled: true,
            showHeader: false,
            showTableToolbarArea: false,
            showExplorerItemPanel: false,
            headerActions: expect.objectContaining({ columnManager: false }),
          }),
        }),
      }),
    );
    expect(component.hasUnsavedChanges).toBe(false);
    component.applyReducedViewProfile('full');
    component.saveFeatures();
    expect(component.reducedView.enabled).toBe(false);
    expect(component.reducedView.showExplorerItemPanel).toBe(true);
  });

  it('defaults Studio comments to off and persists explicit activation and deactivation', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.loadConfig();
    expect(component.featureConfig.showStudioItemComments).toBe(false);
    for (const enabled of [true, false]) {
      component.featureConfig.showStudioItemComments = enabled;
      component.saveFeatures();
      expect(api.updateAccessConfig).toHaveBeenLastCalledWith(
        '',
        expect.objectContaining({
          featureConfig: expect.objectContaining({ showStudioItemComments: enabled }),
        }),
      );
    }
  });

  it('saves access and features together and clears the dirty state after success', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.loadConfig();
    expect(component.hasUnsavedChanges).toBe(false);
    component.accessModel = 'PRIVATE';
    component.featureConfig.enableCommenting = true;
    expect(component.hasUnsavedChanges).toBe(true);
    component.saveFeatures();
    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        accessModel: 'PRIVATE',
        featureConfig: expect.objectContaining({ enableCommenting: true }),
      }),
    );
    expect(component.hasUnsavedChanges).toBe(false);
    expect(component.featuresSaved).toBe(true);
  });

  it('keeps changes made during a pending save dirty and prevents duplicate requests', () => {
    const response = new Subject<any>();
    api.updateAccessConfig.mockReturnValue(response);
    const component = new AccessConfigComponent(route as any, api as any);
    component.loadConfig();
    component.accessModel = 'PRIVATE';
    component.saveFeatures();
    component.saveFeatures();
    expect(api.updateAccessConfig).toHaveBeenCalledTimes(1);
    component.accessModel = 'PUBLIC';
    response.next({});
    expect(component.hasUnsavedChanges).toBe(true);
    expect(component.saving).toBe(false);
  });

  it('retains unsaved changes and allows retry after a failed save', () => {
    api.updateAccessConfig.mockReturnValue(throwError(() => new Error('offline')));
    const component = new AccessConfigComponent(route as any, api as any);
    component.loadConfig();
    component.availableTags.push('Prüfen');
    component.saveFeatures();
    expect(component.hasUnsavedChanges).toBe(true);
    expect(component.saveError).toContain('nicht gespeichert');
    expect(component.saving).toBe(false);
    expect(component.featuresSaved).toBe(false);
  });

  it.each([
    ['', ''],
    ['invalid', 'invalid'],
    ['2026-09-16T10:00', '2026-09-15T10:00'],
    ['2026-09-16T10:00', '2027-01-16T10:00'],
  ])('does not save an invalid credential window %s to %s', (from, until) => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.accessModel = 'CREDENTIALS_LIST';
    component.validFrom = from;
    component.validUntil = until;
    component.saveFeatures();
    expect(api.updateAccessConfig).not.toHaveBeenCalled();
    expect(component.saveError).not.toBe('');
  });

  it.each([undefined, true, false])(
    'renders and saves the effective Explorer setting for %s without blocking shared display controls',
    async (configured) => {
      api.getAccessConfig.mockReturnValue(
        of({
          accessModel: 'PUBLIC',
          featureConfig: configured === undefined ? {} : { enableItemList: configured },
        }),
      );
      await TestBed.configureTestingModule({
        imports: [AccessConfigComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          { provide: ActivatedRoute, useValue: route },
          { provide: ApiService, useValue: api },
        ],
      })
        .overrideComponent(AccessConfigComponent, {
          remove: { imports: [AcpManagerContextComponent] },
          add: { imports: [AcpManagerContextStubComponent] },
        })
        .compileComponents();
      const fixture = TestBed.createComponent(AccessConfigComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      const enabled = configured !== false;
      expect(root.querySelector('.settings-overview')?.textContent).toContain(
        `Item-Explorer ${enabled ? 'aktiviert' : 'deaktiviert'}`,
      );
      const checkbox = (label: string): HTMLInputElement => {
        const element = [...root.querySelectorAll('label')].find((el) =>
          el.textContent?.includes(label),
        );
        return element!.querySelector('input')!;
      };
      expect(checkbox('Item-Explorer aktivieren').checked).toBe(enabled);
      expect(fixture.componentInstance.hasUnsavedChanges).toBe(false);
      const highlight = checkbox('Item im Player hervorheben');
      expect(highlight.matches(':disabled')).toBe(false);
      highlight.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.hasUnsavedChanges).toBe(true);
      fixture.componentInstance.saveFeatures();
      expect(api.updateAccessConfig).toHaveBeenCalledWith(
        'acp-1',
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            enableItemList: enabled,
            enablePlayerFocusHighlight: true,
          }),
        }),
      );
      fixture.destroy();
    },
  );

  it('defaults showAudioVideoCodingVariables to true when flag is missing', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.showAudioVideoCodingVariablesKey]).toBe(true);
  });

  it('starts with PRIVATE as the default base access model', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    expect(component.accessModel).toBe('PRIVATE');
  });

  it('keeps explicit false for showAudioVideoCodingVariables', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: {
          showAudioVideoCodingVariables: false,
        },
      }),
    );

    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.showAudioVideoCodingVariablesKey]).toBe(false);
  });

  it('defaults showItemExplorerPlayerTargetInfo to false when flag is missing', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.showItemExplorerPlayerTargetInfoKey]).toBe(false);
  });

  it('defaults player focus highlight to false when the flag is missing', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.enablePlayerFocusHighlightKey]).toBe(false);
  });

  it('keeps item explorer conditional visibility disabled when the flag is missing', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(
      component.featureConfig[component.enableItemExplorerConditionalVisibilityKey],
    ).toBeUndefined();
  });

  it('keeps explicit true for item explorer conditional visibility', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: {
          enableItemExplorerConditionalVisibility: true,
        },
      }),
    );

    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.enableItemExplorerConditionalVisibilityKey]).toBe(
      true,
    );
  });

  it('keeps explicit false for showItemExplorerPlayerTargetInfo', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: {
          showItemExplorerPlayerTargetInfo: false,
        },
      }),
    );

    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.showItemExplorerPlayerTargetInfoKey]).toBe(false);
  });

  it('keeps explicit false for player focus highlight', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: {
          enablePlayerFocusHighlight: false,
        },
      }),
    );

    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig[component.enablePlayerFocusHighlightKey]).toBe(false);
  });

  it('persists showAudioVideoCodingVariables when saving features', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enableItemList: true,
      showAudioVideoCodingVariables: false,
    };

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          showAudioVideoCodingVariables: false,
        }),
      }),
    );
  });

  it('persists showItemExplorerPlayerTargetInfo when saving features', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enableItemList: true,
      showItemExplorerPlayerTargetInfo: false,
    };

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          showItemExplorerPlayerTargetInfo: false,
        }),
      }),
    );
  });

  it('persists player focus highlight when saving features', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enableItemList: true,
      enablePlayerFocusHighlight: false,
    };

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          enablePlayerFocusHighlight: false,
        }),
      }),
    );
  });

  it('persists item explorer conditional visibility when saving features', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enableItemList: true,
      enableItemExplorerConditionalVisibility: true,
    };

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          enableItemExplorerConditionalVisibility: true,
        }),
      }),
    );
  });

  it('persists the empirical difficulty item filter when saving features', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enableItemList: true,
      showOnlyItemsWithEmpiricalDifficulty: true,
    };

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          showOnlyItemsWithEmpiricalDifficulty: true,
        }),
      }),
    );
  });
  it('persists the configured Sub-ID label and value labels', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = { enableItemList: true, itemSubIdLabel: 'Kategorie' };
    component.itemSubIdLabelEntries = [
      { value: '1', label: 'teilweise richtig' },
      { value: '2', label: 'vollständig richtig' },
    ];

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          itemSubIdLabel: 'Kategorie',
          itemSubIdLabels: {
            '1': 'teilweise richtig',
            '2': 'vollständig richtig',
          },
        }),
      }),
    );
  });

  it('persists personal item categories and colored tags', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enablePersonalItemData: true,
      personalItemCategoryLabel: 'Kompetenzstufe',
      personalItemTagLabel: 'Sichtung',
    };
    component.personalItemCategoryValues = [' I ', 'II', 'I'];
    component.personalItemTags = [
      { label: ' Prüfen ', color: '#ff0000' },
      { label: '', color: '#000000' },
    ];

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          enablePersonalItemData: true,
          personalItemCategoryLabel: 'Kompetenzstufe',
          personalItemCategoryValues: ['I', 'II'],
          personalItemTagLabel: 'Sichtung',
          personalItemTags: [{ label: 'Prüfen', color: '#ff0000' }],
        }),
      }),
    );
  });

  it('includes the existing validity window when saving credential features', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.accessModel = 'CREDENTIALS_LIST';
    component.validFrom = '2026-07-13T10:00';
    component.validUntil = '2026-08-13T10:00';
    component.featureConfig = { enablePersonalItemData: true };

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        accessModel: 'CREDENTIALS_LIST',
        validFrom: new Date(2026, 6, 13, 10, 0).toISOString(),
        validUntil: new Date(2026, 7, 13, 10, 0).toISOString(),
        featureConfig: expect.objectContaining({ enablePersonalItemData: true }),
      }),
    );
  });

  it('defaults existing comment configurations to private visibility', () => {
    api.getAccessConfig.mockReturnValue(
      of({
        accessModel: 'PUBLIC',
        allowRegistered: false,
        featureConfig: { enableCommenting: true, commentTargets: ['ITEM'] },
      }),
    );
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';

    component.loadConfig();

    expect(component.featureConfig['commentVisibilityMode']).toBe('PRIVATE');
  });

  it('persists explicitly shared item comments', () => {
    const component = new AccessConfigComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.featureConfig = {
      enableCommenting: true,
      commentVisibilityMode: 'SHARED',
    };
    component.commentTargets = ['ITEM'];

    component.saveFeatures();

    expect(api.updateAccessConfig).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          enableCommenting: true,
          commentTargets: ['ITEM'],
          commentVisibilityMode: 'SHARED',
        }),
      }),
    );
  });
});
