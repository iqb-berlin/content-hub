import { ItemExplorerImportService } from './item-explorer-import.service';
import { ItemExplorerTableService } from './item-explorer-table.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { ItemExplorerPlayerService } from './item-explorer-player.service';
import { Component, inject, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';
import { ItemExplorerCommentsService } from './item-explorer-comments.service';
import { ItemExplorerPersonalDataService } from './item-explorer-personal-data.service';
import { ItemExplorerCollectionsService } from './item-explorer-collections.service';
import { ItemExplorerDraftService } from './item-explorer-draft.service';

@Component({
  standalone: true,
  template: '',
  providers: [
    ItemExplorerBrowser,
    ItemExplorerCommentsService,
    ItemExplorerPersonalDataService,
    ItemExplorerCollectionsService,
    ItemExplorerDraftService,
    ItemExplorerCodingService,
    ItemExplorerPlayerService,
    ItemExplorerTableService,
    ItemExplorerImportService,
  ],
})
class ExplorerServicesHarness {
  readonly comments = inject(ItemExplorerCommentsService);
  readonly personal = inject(ItemExplorerPersonalDataService);
  readonly collections = inject(ItemExplorerCollectionsService);
  readonly draft = inject(ItemExplorerDraftService);
  readonly coding = inject(ItemExplorerCodingService);
  readonly player = inject(ItemExplorerPlayerService);
  readonly table = inject(ItemExplorerTableService);
  readonly imports = inject(ItemExplorerImportService);
}

describe('Explorer service provider lifecycle', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('isolates component instances and lets Angular dispose their work', async () => {
    vi.useFakeTimers();
    const response = new Subject<any>();
    const getCounts = vi.fn(() => of({ counts: [] }));
    await TestBed.configureTestingModule({
      imports: [ExplorerServicesHarness],
      providers: [
        provideZonelessChangeDetection(),
        PendingPersonalSessionStorageService,
        {
          provide: ApiService,
          useValue: {
            getItemCommentCounts: getCounts,
            patchItemExplorerDraft: () => response,
          },
        },
      ],
    }).compileComponents();
    const first = TestBed.createComponent(ExplorerServicesHarness);
    const second = TestBed.createComponent(ExplorerServicesHarness);
    const a = first.componentInstance,
      b = second.componentInstance;
    expect(a.comments).not.toBe(b.comments);
    expect(a.personal).not.toBe(b.personal);
    expect(a.collections).not.toBe(b.collections);
    expect(a.draft).not.toBe(b.draft);
    expect(a.coding).not.toBe(b.coding);
    expect(a.player).not.toBe(b.player);
    expect(a.table).not.toBe(b.table);
    expect(a.imports).not.toBe(b.imports);
    a.table.filterText = 'instance A';
    a.table.metadataSettings.widths['test'] = 300;
    expect(b.table.filterText).toBe('');
    expect(b.table.metadataSettings.widths).toEqual({});
    a.coding.codingSearchText = 'instance A';
    expect(b.coding.codingSearchText).toBe('');
    a.player.applyAssets({ unit: { id: 'u' }, srcDoc: 'frame A', definition: '{}' });
    a.player.onPagingModeChange();
    b.player.applyAssets({ unit: { id: 'u' }, srcDoc: 'frame B', definition: '{}' });
    a.comments.configure({ acpId: 'a', identity: 'user-a', loggedIn: true, canExport: false });
    a.comments.itemCommentsEnabled = true;
    a.comments.syncItemCommentCountSession();
    a.draft.configure({ acpId: 'a', canEdit: true, canPublish: true });
    a.draft.queueDraftPatch('UI_UPDATE', { ui: {} });
    const flushed = a.draft.flushDraftPatch();
    const completed = vi.fn();
    a.comments.countsChanged$.subscribe({ complete: completed });
    first.destroy();
    expect(a.player.playerSrcDoc).toBeNull();
    expect(b.player.playerSrcDoc).toBe('frame B');
    expect(await flushed).toEqual({ kind: 'cancelled' });
    expect(response.observed).toBe(false);
    expect(completed).toHaveBeenCalledOnce();
    const callsBefore = getCounts.mock.calls.length;
    vi.advanceTimersByTime(15000);
    expect(getCounts).toHaveBeenCalledTimes(callsBefore);
    b.comments.updateItemCommentCount({ unitId: 'u', itemId: 'i', count: 3 });
    expect(b.comments.getItemCommentCount({ unitId: 'u', itemId: 'i' } as any)).toBe(3);
    second.destroy();
  });
});
