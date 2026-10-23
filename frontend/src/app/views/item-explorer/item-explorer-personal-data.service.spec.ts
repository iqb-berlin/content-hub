import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { ItemExplorerPersonalDataService } from './item-explorer-personal-data.service';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';

const context = {
  acpId: 'a',
  identity: 'user-a',
  perspective: 'editor' as const,
  canExportAll: true,
  perspectiveSwitchBusy: false,
};

describe('ItemExplorerPersonalDataService', () => {
  let service: ItemExplorerPersonalDataService;
  let storage: PendingPersonalSessionStorageService;
  let browser: ItemExplorerBrowser;
  let api: {
    getViewItemPreferences: ReturnType<typeof vi.fn>;
    patchViewItemPreferenceRow: ReturnType<typeof vi.fn>;
    exportViewPersonalItemDataXlsx: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    storage = new PendingPersonalSessionStorageService();
    browser = { isVisible: () => true, watchVisibility: () => () => undefined, download: vi.fn() };
    api = {
      getViewItemPreferences: vi.fn().mockReturnValue(of({ rowData: {} })),
      patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({})),
      exportViewPersonalItemDataXlsx: vi.fn().mockReturnValue(of(new Blob(['export']))),
    };
    service = new ItemExplorerPersonalDataService(api as any, storage, browser);
    service.configure(context);
    service.enablePersonalItemData = true;
    service.syncPersonalItemDataSession();
  });
  afterEach(() => {
    service.ngOnDestroy();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('debounces changes and serializes a newer edit behind an active row save', () => {
    const first = new Subject<unknown>();
    api.patchViewItemPreferenceRow.mockReturnValueOnce(first);
    service.setPersonalItemNote('row', 'first');
    vi.advanceTimersByTime(349);
    expect(api.patchViewItemPreferenceRow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    service.setPersonalItemNote('row', 'second');
    vi.advanceTimersByTime(350);
    expect(api.patchViewItemPreferenceRow).toHaveBeenCalledTimes(1);
    first.next({});
    first.complete();
    expect(api.patchViewItemPreferenceRow).toHaveBeenLastCalledWith(
      'a',
      'row',
      { note: 'second' },
      'editor',
    );
    expect(service.personalDataSaveState).toBe('saved');
  });

  it('waits for pending changes before exporting the explicitly supplied rows', async () => {
    const saved = new Subject<unknown>();
    api.patchViewItemPreferenceRow.mockReturnValue(saved);
    service.setPersonalItemNote('row', 'note');
    const exported = service.exportPersonalItemDataXlsx(['row']);
    expect(api.exportViewPersonalItemDataXlsx).not.toHaveBeenCalled();
    saved.next({});
    saved.complete();
    await exported;
    expect(api.exportViewPersonalItemDataXlsx).toHaveBeenCalledWith('a', ['row'], 'editor');
    expect(browser.download).toHaveBeenCalledTimes(1);
  });

  it('does not download an export from a previous session', async () => {
    const response = new Subject<Blob>();
    api.exportViewPersonalItemDataXlsx.mockReturnValue(response);
    const exported = service.exportPersonalItemDataXlsx(['row']);
    await Promise.resolve();
    service.configure({ ...context, identity: 'user-b' });
    service.syncPersonalItemDataSession();
    response.next(new Blob(['private']));
    await exported;
    expect(browser.download).not.toHaveBeenCalled();
    expect(service.personalExportInProgress).toBe(false);
  });

  it('preserves pending changes on destruction and restores only the owning identity', () => {
    service.setPersonalItemNote('row', 'recover me');
    service.ngOnDestroy();
    const restored = new ItemExplorerPersonalDataService(api as any, storage, browser);
    restored.configure(context);
    restored.enablePersonalItemData = true;
    restored.syncPersonalItemDataSession();
    expect(restored.personalItemData['row']).toEqual({ note: 'recover me' });
    restored.ngOnDestroy();
    const differentUser = new ItemExplorerPersonalDataService(api as any, storage, browser);
    differentUser.configure({ ...context, identity: 'user-b' });
    differentUser.enablePersonalItemData = true;
    differentUser.syncPersonalItemDataSession();
    expect(differentUser.personalItemData).toEqual({});
    differentUser.ngOnDestroy();
  });

  it('resolves waiting saves as unsuccessful and releases requests on destruction', async () => {
    const saved = new Subject<unknown>();
    api.patchViewItemPreferenceRow.mockReturnValue(saved);
    service.setPersonalItemNote('row', 'note');
    const waiting = service.flushPersonalItemDataSaveAndWait();
    service.ngOnDestroy();
    service.ngOnDestroy();
    expect(await waiting).toBe(false);
    expect(saved.observed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
