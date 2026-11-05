import { Component, Input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import { FilesComponent } from './files.component';
import {
  AcpFile,
  FilePreviewResponse,
  UploadValidationSummary,
  ValidateUnitsResponse,
  ValidationResult,
} from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';
import { FilePreviewPanelComponent } from './file-preview-panel.component';

@Component({ selector: 'app-acp-manager-context', standalone: true, template: '' })
class ContextStubComponent {}

@Component({
  selector: 'app-file-preview-panel',
  standalone: true,
  template: '',
})
class PreviewStubComponent {
  @Input() file: AcpFile | null = null;
  @Input() preview: FilePreviewResponse | null = null;
  @Input() inlineUrl: string | null = null;
  @Input() downloadUrl: string | null = null;
  @Input() loading = false;
  @Input() error = '';
}

const timestamp = '2026-11-05T12:00:00.000Z';
const message = 'Booklet besitzt weder XML-Definition noch Module.';
const path = 'assessmentParts[0].instruments[0].testcenterBooklet[0]';
function consistency(severity?: 'error' | 'warning'): ValidationResult {
  return {
    valid: severity !== 'error',
    issues: severity ? [{ severity, message, path }] : [],
    timestamp,
  };
}
function summary(hasError: boolean, totalFiles = 1): UploadValidationSummary {
  const result = consistency(hasError ? 'error' : undefined);
  return {
    totalFiles,
    validFiles: totalFiles,
    invalidFiles: 0,
    semanticValid: result.valid,
    semanticIssueCount: result.issues.length,
    semanticIssues: result.issues,
    timestamp,
  };
}
function file(id: string, name: string): AcpFile {
  return {
    id,
    acpId: 'acp-1',
    originalName: name,
    filePath: name,
    fileSize: 10,
    uploadedAt: timestamp,
    validationResult: { valid: true, issues: [], timestamp },
  };
}
async function refresh(fixture: ComponentFixture<FilesComponent>) {
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  await fixture.whenStable();
}
async function setup(initial: Observable<ValidationResult> = of(consistency('error'))) {
  const task = file('task', 'task.voud');
  const booklet = file('booklet', 'booklet.xml');
  const api = {
    getFiles: vi.fn().mockReturnValue(of([task, booklet])),
    getAcpConsistency: vi.fn().mockReturnValue(initial),
    getFileDownloadUrl: vi.fn().mockReturnValue('/download'),
    validateUnitFiles: vi
      .fn()
      .mockReturnValue(of({ unitResults: [], validationSummary: summary(true) })),
    deleteFile: vi
      .fn()
      .mockReturnValue(of({ message: 'deleted', validationSummary: summary(true) })),
    bulkDeleteFiles: vi
      .fn()
      .mockReturnValue(of({ message: 'deleted', validationSummary: summary(true) })),
    deleteAllFiles: vi
      .fn()
      .mockReturnValue(of({ message: 'deleted', validationSummary: summary(true, 0) })),
  };
  await TestBed.configureTestingModule({
    imports: [FilesComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { parent: { snapshot: { paramMap: new Map([['acpId', 'acp-1']]) } } },
      },
      { provide: ApiService, useValue: api },
    ],
  })
    .overrideComponent(FilesComponent, {
      remove: { imports: [AcpManagerContextComponent, FilePreviewPanelComponent] },
      add: { imports: [ContextStubComponent, PreviewStubComponent] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(FilesComponent);
  await refresh(fixture);
  return { fixture, api, task, booklet };
}

describe('FilesComponent validation lifecycle', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each(['error', 'warning'] as const)(
    'reloads AP %s details when reopening the page',
    async (severity) => {
      const { fixture, api } = await setup(of(consistency(severity)));
      expect(fixture.nativeElement.textContent).toContain(message);
      fixture.destroy();

      const reopened = TestBed.createComponent(FilesComponent);
      await refresh(reopened);
      const root = reopened.nativeElement as HTMLElement;

      expect(api.getAcpConsistency).toHaveBeenCalledTimes(2);
      expect(api.validateUnitFiles).not.toHaveBeenCalled();
      expect(root.querySelectorAll('.ap-validation-issue')).toHaveLength(1);
      expect(root.querySelector('.ap-validation-issue')?.textContent).toContain(path);
      expect(root.querySelector('.alert-warning')?.textContent).toContain(
        severity === 'error' ? 'Fehler vorhanden' : 'Warnungen vorhanden',
      );
      expect(root.querySelector('tbody')?.textContent).not.toContain(message);
      expect(root.querySelector('tbody .badge-success')?.textContent?.trim()).toBe('OK');
      expect(root.textContent).not.toContain('Auto-Validierung:');
    },
  );

  it.each(['single', 'selected', 'all'] as const)(
    'refreshes AP errors after %s deletion',
    async (mode) => {
      const { fixture, api, task, booklet } = await setup(of(consistency()));
      const component = fixture.componentInstance;
      expect(fixture.nativeElement.textContent).toContain('AP-weite Prüfung: OK');
      api.getFiles.mockReturnValue(of(mode === 'all' ? [] : [task]));
      if (mode === 'single') component.openDeleteFileDialog(booklet);
      else if (mode === 'selected') {
        component.toggleFileSelection(booklet.id, true);
        component.openDeleteSelectedFilesDialog();
      } else component.openDeleteAllFilesDialog();
      component.confirmDeleteDialog();
      await refresh(fixture);

      expect(component.files).toEqual(mode === 'all' ? [] : [task]);
      expect(fixture.nativeElement.querySelector('.ap-validation-issue')?.textContent).toContain(
        message,
      );
      expect(fixture.nativeElement.textContent).not.toContain('AP-weite Prüfung: OK');
      expect(api.getAcpConsistency).toHaveBeenCalledTimes(1);
    },
  );

  it('clears resolved AP errors using the deletion response', async () => {
    const { fixture, api, task, booklet } = await setup();
    const component = fixture.componentInstance;
    api.deleteFile.mockReturnValue(of({ message: 'deleted', validationSummary: summary(false) }));
    api.getFiles.mockReturnValue(of([task]));
    component.openDeleteFileDialog(booklet);
    component.confirmDeleteDialog();
    await refresh(fixture);

    expect(fixture.nativeElement.querySelector('.ap-validation-issue')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('AP-weite Prüfung: OK');
  });

  it('reloads AP consistency when an older deletion response has no summary', async () => {
    const { fixture, api, booklet } = await setup(of(consistency()));
    api.deleteFile.mockReturnValue(of({ message: 'deleted' }));
    api.getAcpConsistency.mockReturnValue(of(consistency('error')));
    fixture.componentInstance.openDeleteFileDialog(booklet);
    fixture.componentInstance.confirmDeleteDialog();
    await refresh(fixture);

    expect(api.getAcpConsistency).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain(message);
  });

  it('ignores an older consistency request that fails after deletion succeeds', async () => {
    const pending = new Subject<ValidationResult>();
    const { fixture, booklet } = await setup(pending);
    fixture.componentInstance.openDeleteFileDialog(booklet);
    fixture.componentInstance.confirmDeleteDialog();
    pending.error(new Error('stale request'));
    await refresh(fixture);

    expect(fixture.componentInstance.consistencyError).toBe('');
    expect(fixture.nativeElement.textContent).toContain(message);
  });

  it('ignores an older file validation response after deletion succeeds', async () => {
    const { fixture, api, booklet } = await setup();
    const pending = new Subject<ValidateUnitsResponse>();
    api.validateUnitFiles.mockReturnValue(pending);
    fixture.componentInstance.validateFiles();
    fixture.componentInstance.openDeleteFileDialog(booklet);
    fixture.componentInstance.confirmDeleteDialog();
    pending.next({ unitResults: [], validationSummary: summary(false) });
    await refresh(fixture);

    expect(fixture.componentInstance.validating).toBe(false);
    expect(fixture.nativeElement.textContent).toContain(message);
    expect(fixture.nativeElement.textContent).not.toContain('AP-weite Prüfung: OK');
  });

  it.each(['cancel', 'skip'] as const)(
    'preserves AP messages when an upload is %s',
    async (action) => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      const input = { files: [new File(['<Booklet/>'], 'booklet.xml')], value: 'booklet.xml' };
      const upload = component.upload({ target: input } as unknown as Event);
      expect(component.conflictDialogOpen).toBe(true);
      if (action === 'cancel') component.cancelConflictDialog();
      else {
        component.applyDecisionToAll('skip');
        component.confirmConflictDialog();
      }
      await upload;
      await refresh(fixture);

      expect(fixture.nativeElement.textContent).toContain(message);
      expect(component.uploading).toBe(false);
    },
  );

  it('reports a failed consistency load without showing an OK status', async () => {
    const { fixture } = await setup(throwError(() => new Error('offline')));
    expect(fixture.nativeElement.textContent).toContain(
      'Die AP-weite Prüfung konnte nicht geladen werden.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('AP-weite Prüfung: OK');
  });
});
