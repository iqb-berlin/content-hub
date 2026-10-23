import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { ItemExplorerCommentsService } from './item-explorer-comments.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';

describe('ItemExplorerCommentsService', () => {
  let service: ItemExplorerCommentsService;
  let api: {
    getItemCommentCounts: ReturnType<typeof vi.fn>;
    exportMyReviewCommentsCsv: ReturnType<typeof vi.fn>;
  };
  let browser: ItemExplorerBrowser;
  let stop: ReturnType<typeof vi.fn<() => void>>;
  const context = { acpId: 'a', identity: 'user-a', loggedIn: true, canExport: true };
  beforeEach(() => {
    vi.useFakeTimers();
    stop = vi.fn();
    browser = {
      isVisible: vi.fn(() => true),
      watchVisibility: vi.fn(() => stop),
      download: vi.fn(),
    };
    api = {
      getItemCommentCounts: vi.fn().mockReturnValue(of({ counts: [] })),
      exportMyReviewCommentsCsv: vi.fn(),
    };
    service = new ItemExplorerCommentsService(api as any, browser);
    service.configure(context);
    service.itemCommentsEnabled = true;
  });
  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
  });

  it('polls only visible sessions and releases its listener and timer exactly once', () => {
    service.syncItemCommentCountSession();
    service.syncItemCommentCountSession();
    vi.advanceTimersByTime(5000);
    expect(api.getItemCommentCounts).toHaveBeenCalledTimes(2);
    vi.mocked(browser.isVisible).mockReturnValue(false);
    vi.advanceTimersByTime(10000);
    expect(api.getItemCommentCounts).toHaveBeenCalledTimes(2);
    service.ngOnDestroy();
    service.ngOnDestroy();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a newer local count when an older batch completes', () => {
    const response = new Subject<any>();
    api.getItemCommentCounts.mockReturnValue(response);
    service.syncItemCommentCountSession();
    service.updateItemCommentCount({ unitId: 'u', itemId: 'i', count: 4 });
    response.next({ counts: [{ unitId: 'u', itemId: 'i', count: 1 }] });
    expect(service.getItemCommentCount({ unitId: 'u', itemId: 'i' } as any)).toBe(4);
  });

  it('ignores batch and export results from an earlier identity', () => {
    const counts = new Subject<any>();
    const exported = new Subject<Blob>();
    api.getItemCommentCounts.mockReturnValueOnce(counts);
    api.exportMyReviewCommentsCsv.mockReturnValue(exported);
    service.syncItemCommentCountSession();
    service.exportMyCommentsCsv();
    service.configure({ ...context, identity: 'user-b' });
    service.syncItemCommentCountSession();
    counts.next({ counts: [{ unitId: 'u', itemId: 'i', count: 7 }] });
    exported.next(new Blob(['old user']));
    expect(service.itemCommentCounts).toEqual({});
    expect(browser.download).not.toHaveBeenCalled();
    expect(service.commentExportInProgress).toBe(false);
  });

  it('keeps independent explorer instances isolated', () => {
    const other = new ItemExplorerCommentsService(api as any, browser);
    service.updateItemCommentCount({ unitId: 'u', itemId: 'i', count: 4 });
    expect(other.itemCommentCounts).toEqual({});
    other.ngOnDestroy();
  });
});
