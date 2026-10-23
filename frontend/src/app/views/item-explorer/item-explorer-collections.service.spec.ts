import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { ItemExplorerCollectionsService } from './item-explorer-collections.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';
import { ItemCollection } from '../../core/models/api.models';
import { ExplorerItem } from './item-explorer.models';

function collection(version = 1): ItemCollection {
  return {
    createdAt: '2026-09-22T12:00:00Z',
    updatedAt: '2026-09-22T12:00:00Z',
    shared: false,
    ownerLabel: 'Ich',
    id: 'c',
    name: 'Selection',
    version,
    rowKeys: ['row'],
    unavailableRowKeys: [],
    ownedByCurrentUser: true,
    summary: {
      rowCount: 1,
      itemCount: 1,
      unitCount: 1,
      itemTimeSeconds: 20,
      stimulusTimeSeconds: 10,
      testTimeSeconds: 30,
      missingItemTimeCount: 0,
      missingStimulusTimeUnitCount: 0,
      complete: true,
    },
  } as ItemCollection;
}
const item = {
  rowKey: 'row',
  uuid: 'i',
  unitId: 'u',
  itemTimeSeconds: 20,
  stimulusTimeSeconds: 10,
} as ExplorerItem;
const context = {
  acpId: 'a',
  identity: 'user-a',
  perspective: 'editor' as const,
  items: [item],
  itemsAvailable: true,
};

describe('ItemExplorerCollectionsService', () => {
  let service: ItemExplorerCollectionsService;
  let api: {
    getItemCollections: ReturnType<typeof vi.fn>;
    mutateItemCollectionRows: ReturnType<typeof vi.fn>;
    updateItemCollection: ReturnType<typeof vi.fn>;
    exportItemCollectionCsv: ReturnType<typeof vi.fn>;
  };
  let browser: ItemExplorerBrowser;
  beforeEach(() => {
    api = {
      getItemCollections: vi
        .fn()
        .mockReturnValue(of({ activeCollectionId: 'c', collections: [collection()] })),
      mutateItemCollectionRows: vi.fn(),
      updateItemCollection: vi.fn(),
      exportItemCollectionCsv: vi.fn(),
    };
    browser = { isVisible: () => true, watchVisibility: () => () => undefined, download: vi.fn() };
    service = new ItemExplorerCollectionsService(api as any, browser);
    service.configure(context);
    service.enableItemCollections = true;
    service.syncItemCollectionSession();
  });
  afterEach(() => service.ngOnDestroy());

  it('rolls optimistic mutations back and preserves a conflict while reloading', async () => {
    const response = new Subject<any>();
    api.mutateItemCollectionRows.mockReturnValue(response);
    const removed = service.removeRowFromActiveCollection('row');
    expect(service.activeItemCollection?.rowKeys).toEqual([]);
    response.error({ status: 409 });
    await removed;
    expect(service.activeItemCollection?.rowKeys).toEqual(['row']);
    expect(service.collectionError).toContain('parallel geändert');
    expect(api.getItemCollections).toHaveBeenCalledTimes(2);
  });

  it('keeps server summaries until the supplied item snapshot is ready', () => {
    service.configure({ ...context, items: [], itemsAvailable: false });
    service.loadItemCollections();
    expect(service.activeItemCollection?.summary.testTimeSeconds).toBe(30);
    service.configure({ ...context, items: [], itemsAvailable: true });
    service.recalculateCollectionSummaries();
    expect(service.activeItemCollection?.unavailableRowKeys).toEqual(['row']);
  });

  it('invalidates cached rows when a new item snapshot arrives', () => {
    const first = service.activeCollectionItems;
    expect(service.activeCollectionItems).toBe(first);
    service.configure({ ...context, items: [{ ...item, itemTimeSeconds: 40 }] });
    expect(service.activeCollectionItems).not.toBe(first);
    expect(service.activeCollectionItems[0].item?.itemTimeSeconds).toBe(40);
  });

  it('ignores an old mutation after switching identity', async () => {
    const response = new Subject<any>();
    api.updateItemCollection.mockReturnValue(response);
    const rename = service.renameActiveCollection('old user');
    service.configure({ ...context, identity: 'user-b' });
    service.syncItemCollectionSession();
    response.next({
      activeCollectionId: 'c',
      collections: [{ ...collection(2), name: 'old user' }],
    });
    await rename;
    expect(service.activeItemCollection?.name).toBe('Selection');
  });

  it('blocks exports after destruction and ignores a late download', async () => {
    const response = new Subject<Blob>();
    api.exportItemCollectionCsv.mockReturnValue(response);
    const exported = service.exportActiveCollection();
    service.ngOnDestroy();
    response.next(new Blob(['private']));
    await exported;
    expect(browser.download).not.toHaveBeenCalled();
  });

  it('does not let a failed rename affect another instance', async () => {
    const other = new ItemExplorerCollectionsService(api as any, browser);
    other.configure(context);
    other.enableItemCollections = true;
    other.syncItemCollectionSession();
    api.updateItemCollection.mockReturnValue(throwError(() => ({ status: 500 })));
    await service.renameActiveCollection('new name');
    expect(other.collectionError).toBe('');
    expect(other.activeItemCollection?.name).toBe('Selection');
    other.ngOnDestroy();
  });
});
