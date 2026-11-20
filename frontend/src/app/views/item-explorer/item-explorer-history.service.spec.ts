import { afterEach, describe, expect, it, vi } from 'vitest';
import { Observable, of, Subject } from 'rxjs';
import type { ItemExplorerChangeLogEntry } from '../../core/models/api.models';
import { ItemExplorerHistoryService } from './item-explorer-history.service';

const services: ItemExplorerHistoryService[] = [];

function entry(id: string, actorUsername = 'Reviewer'): ItemExplorerChangeLogEntry {
  return {
    id,
    apId: 'package',
    changeType: 'TAGS_CHANGED',
    beforeState: {},
    afterState: {},
    diff: {},
    actorUsername,
    createdAt: '2026-11-04T12:34:56.000Z',
  };
}

function createService() {
  const response = new Subject<ItemExplorerChangeLogEntry[]>();
  const api = {
    getItemExplorerChanges: vi.fn(
      (_apId: string, _limit: number): Observable<ItemExplorerChangeLogEntry[]> => response,
    ),
  };
  const browser = { download: vi.fn<(blob: Blob, filename: string) => void>() };
  const service = new ItemExplorerHistoryService(api as any, browser as any);
  services.push(service);
  return { service, response, api, browser };
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  services.splice(0).forEach((service) => service.ngOnDestroy());
  vi.restoreAllMocks();
});

describe('history requests and state', () => {
  it('opens the dialog, loads the existing 300-entry limit and retains filters across refreshes', () => {
    const { service, response, api } = createService();
    service.setHistoryFilter('historyFilterUser', 'review');
    service.showHistory('package');
    expect(api.getItemExplorerChanges).toHaveBeenCalledWith('package', 300);
    expect(service.showHistoryOverlay).toBe(true);
    expect(service.historyLoading).toBe(true);
    response.next([entry('matching'), entry('other', 'Other')]);
    expect(service.historyLoading).toBe(false);
    expect(service.filteredHistoryEntries.map((change) => change.id)).toEqual(['matching']);
    service.showHistory('package');
    expect(service.historyFilterUser).toBe('review');
    expect(service.historyEntries).toHaveLength(2);
  });

  it('shows an error and clears it before a retry', () => {
    const { service, response, api } = createService();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    service.showHistory('package');
    response.error(new Error('offline'));
    expect(service.historyLoading).toBe(false);
    expect(service.historyError).toBe('Änderungsverlauf konnte nicht geladen werden.');
    api.getItemExplorerChanges.mockReturnValueOnce(of([]));
    service.showHistory('package');
    expect(service.historyError).toBe('');
    expect(service.historyLoading).toBe(false);
    expect(service.historyEntries).toEqual([]);
  });

  it('cancels the older request when refreshed so late results cannot replace the latest entries', () => {
    const { service, response, api } = createService();
    const latest = new Subject<ItemExplorerChangeLogEntry[]>();
    service.showHistory('package');
    api.getItemExplorerChanges.mockReturnValueOnce(latest);
    service.showHistory('package');
    expect(response.observed).toBe(false);
    latest.next([entry('new')]);
    response.next([entry('old')]);
    response.error(new Error('stale error'));
    expect(service.historyEntries.map((change) => change.id)).toEqual(['new']);
    expect(service.historyError).toBe('');
  });

  it('clears entries from an earlier package before loading another package', () => {
    const { service, response } = createService();
    service.showHistory('package');
    response.next([entry('old')]);
    service.showHistory('another-package');
    expect(service.historyEntries).toEqual([]);
    expect(service.historyLoading).toBe(true);
  });

  it('normalizes an empty API result and reports whether closing needs focus restoration', () => {
    const { service, response } = createService();
    expect(service.closeHistoryOverlay()).toBe(false);
    service.showHistory('package');
    response.next(null as any);
    expect(service.historyEntries).toEqual([]);
    expect(service.closeHistoryOverlay()).toBe(true);
    expect(service.closeHistoryOverlay()).toBe(false);
    expect(service.showHistoryOverlay).toBe(false);
  });

  it('unsubscribes on destroy and ignores subsequent actions', () => {
    const { service, response, api, browser } = createService();
    service.showHistory('package');
    service.ngOnDestroy();
    service.ngOnDestroy();
    expect(response.observed).toBe(false);
    response.next([entry('late')]);
    expect(service.historyEntries).toEqual([]);
    service.showHistory('package');
    service.setHistoryFilter('historyFilterUser', 'ignored');
    service.exportHistoryCsv();
    expect(api.getItemExplorerChanges).toHaveBeenCalledOnce();
    expect(service.historyFilterUser).toBe('');
    expect(browser.download).not.toHaveBeenCalled();
    expect(service.closeHistoryOverlay()).toBe(false);
  });
});

describe('history downloads', () => {
  it('downloads exactly the filtered entries using the package filename and existing MIME type', async () => {
    const { service, response, browser } = createService();
    service.showHistory('package');
    response.next([entry('matching'), entry('other', 'Other')]);
    service.setHistoryFilter('historyFilterUser', 'review');
    service.exportHistoryCsv();
    expect(browser.download).toHaveBeenCalledOnce();
    const [blob, filename] = browser.download.mock.calls[0];
    expect(filename).toBe('item-explorer-history-package.csv');
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    const content = await readBlob(blob);
    expect(content).toContain('"Reviewer"');
    expect(content).not.toContain('"Other"');
    expect(content.split('\n')).toHaveLength(2);
  });

  it('does not download when there are no filtered entries', () => {
    const { service, response, browser } = createService();
    service.exportHistoryCsv();
    service.showHistory('package');
    response.next([entry('change')]);
    service.setHistoryFilter('historyFilterUser', 'missing');
    service.exportHistoryCsv();
    expect(browser.download).not.toHaveBeenCalled();
  });
});
