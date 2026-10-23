import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import {
  ItemExplorerImportService,
  ItemExplorerImportResult,
} from './item-explorer-import.service';

const success = { updated: 1, failed: [], successes: [{ fields: ['est'], value: 0.5 }] };
const warning = {
  ...success,
  requiresConfirmation: true,
  warnings: [{ code: 'BOOKLET_OCCURRENCES_SKIPPED' as const, message: 'Booklet fehlt.' }],
};
const context = { acpId: 'a', baseVersion: 7 };

describe('ItemExplorerImportService', () => {
  let api: { uploadItemParameters: ReturnType<typeof vi.fn> };
  let service: ItemExplorerImportService;
  let file: File;
  beforeEach(() => {
    api = { uploadItemParameters: vi.fn(() => of(success)) };
    service = new ItemExplorerImportService(api as any);
    file = new File(['item;est\ni;0.5'], 'items.csv');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    service.ngOnDestroy();
    vi.restoreAllMocks();
  });

  async function prepareWarning(): Promise<ItemExplorerImportResult> {
    api.uploadItemParameters.mockReturnValueOnce(of(warning));
    const result = await service.upload(file, context);
    service.openWarnings();
    service.finishOperation(result);
    return result;
  }

  it('keeps the warned file and uses the current version for explicit confirmation', async () => {
    expect(await prepareWarning()).toMatchObject({ kind: 'warning' });
    expect(service.uploadWarningMessages).toEqual(['Booklet fehlt.']);
    expect(service.showUploadReport).toBe(false);
    const imported = await service.confirmWarnings({ ...context, baseVersion: 9 });
    expect(imported).toMatchObject({ kind: 'imported', result: success });
    expect(api.uploadItemParameters).toHaveBeenLastCalledWith('a', file, {
      draft: true,
      baseVersion: 9,
      confirmWarnings: true,
    });
    expect(service.showUploadWarningDialog).toBe(false);
    expect(service.showUploadReport).toBe(true);
    service.finishOperation(imported);
    expect(await service.confirmWarnings(context)).toEqual({ kind: 'cancelled' });
  });

  it('drops the file when warnings are cancelled', async () => {
    await prepareWarning();
    expect(service.cancelWarnings()).toBe(true);
    expect(service.showUploadWarningDialog).toBe(false);
    expect(await service.confirmWarnings(context)).toEqual({ kind: 'cancelled' });
    expect(api.uploadItemParameters).toHaveBeenCalledOnce();
  });

  it('rejects overlapping uploads until result coordination completes', async () => {
    const response = new Subject<any>();
    api.uploadItemParameters.mockReturnValueOnce(response);
    const pending = service.upload(file, context);
    expect(await service.upload(new File(['other'], 'other.csv'), context)).toEqual({
      kind: 'cancelled',
    });
    response.next(success);
    const result = await pending;
    expect(await service.upload(file, context)).toEqual({ kind: 'cancelled' });
    service.finishOperation(result);
    expect((await service.upload(file, context)).kind).toBe('imported');
    expect(api.uploadItemParameters).toHaveBeenCalledTimes(2);
  });

  it('keeps confirmation locked during a conflict reload and preserves the file for retry', async () => {
    await prepareWarning();
    api.uploadItemParameters.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    const conflict = await service.confirmWarnings(context);
    expect(conflict).toMatchObject({ kind: 'conflict', confirmed: true });
    expect(service.uploadWarningBusy).toBe(true);
    expect(service.cancelWarnings()).toBe(false);
    expect(await service.confirmWarnings(context)).toEqual({ kind: 'cancelled' });
    service.finishConflict(conflict, true);
    service.finishOperation(conflict);
    expect(service.uploadWarningBusy).toBe(false);
    expect(service.uploadWarningError).toContain('Bitte bestätige');
    const retried = await service.confirmWarnings({ ...context, baseVersion: 10 });
    expect(retried.kind).toBe('imported');
    expect(api.uploadItemParameters).toHaveBeenLastCalledWith('a', file, {
      draft: true,
      baseVersion: 10,
      confirmWarnings: true,
    });
  });

  it('abandons confirmation when reloading fails and ignores an obsolete reload result', async () => {
    await prepareWarning();
    api.uploadItemParameters.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    const conflict = await service.confirmWarnings(context);
    service.finishConflict(conflict, false);
    service.finishOperation(conflict);
    expect(service.showUploadWarningDialog).toBe(false);
    expect(service.errorMessage).toContain('Bitte lade die Seite neu');
    expect(await service.confirmWarnings(context)).toEqual({ kind: 'cancelled' });
    await prepareWarning();
    service.finishConflict(conflict, true);
    expect(service.uploadWarningError).toBe('');
    expect(service.showUploadWarningDialog).toBe(true);
  });

  it('keeps the confirmation retryable after a server error or another warning response', async () => {
    await prepareWarning();
    api.uploadItemParameters.mockReturnValueOnce(
      throwError(() => ({ status: 500, error: { message: 'Serverfehler' } })),
    );
    const failed = await service.confirmWarnings(context);
    expect(failed.kind).toBe('failed');
    expect(service.uploadWarningError).toBe('Serverfehler');
    expect(service.uploadWarningBusy).toBe(false);
    service.finishOperation(failed);
    api.uploadItemParameters.mockReturnValueOnce(of(warning));
    const rejected = await service.confirmWarnings(context);
    expect(rejected.kind).toBe('failed');
    expect(service.uploadWarningError).toContain('nicht akzeptiert');
    expect(service.showUploadReport).toBe(false);
    service.finishOperation(rejected);
    expect((await service.confirmWarnings(context)).kind).toBe('imported');
  });

  it('reports an initial upload error and supports a new attempt', async () => {
    api.uploadItemParameters.mockReturnValueOnce(throwError(() => ({ status: 400 })));
    const result = await service.upload(file, context);
    expect(result.kind).toBe('failed');
    expect(service.showErrorDialog).toBe(true);
    expect(service.errorMessage).toContain('CSV-Datei');
    service.closeError();
    service.finishOperation(result);
    expect((await service.upload(file, context)).kind).toBe('imported');
    service.closeReport();
    expect(service.showUploadReport).toBe(false);
  });

  it('cancels the request on destruction and ignores late results', async () => {
    const response = new Subject<any>();
    api.uploadItemParameters.mockReturnValueOnce(response);
    const pending = service.upload(file, context);
    expect(response.observed).toBe(true);
    service.ngOnDestroy();
    service.ngOnDestroy();
    response.next(warning);
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(response.observed).toBe(false);
    expect(service.showUploadWarningDialog).toBe(false);
    expect(service.showUploadReport).toBe(false);
    expect(service.isUploading).toBe(false);
    expect(await service.upload(file, context)).toEqual({ kind: 'cancelled' });
    expect(api.uploadItemParameters).toHaveBeenCalledOnce();
  });

  it('does not reopen dialogs when destruction happens during conflict coordination', async () => {
    await prepareWarning();
    api.uploadItemParameters.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    const conflict = await service.confirmWarnings(context);
    service.ngOnDestroy();
    service.finishConflict(conflict, false);
    service.finishOperation(conflict);
    expect(service.showErrorDialog).toBe(false);
    expect(service.uploadWarningError).toBe('');
    expect(service.uploadWarningBusy).toBe(false);
  });
});
