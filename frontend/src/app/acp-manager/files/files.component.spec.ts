import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of } from 'rxjs';
import { FilesComponent } from './files.component';
import {
  AcpFile,
  FilePreviewResponse,
  FileProcessingJob,
  UploadValidationSummary,
} from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';
import { FilePreviewPanelComponent } from './file-preview-panel.component';

@Component({ selector: 'app-acp-manager-context', standalone: true, template: '' })
class AcpManagerContextStubComponent {}

@Component({
  selector: 'app-file-preview-panel',
  standalone: true,
  template: '',
})
class FilePreviewPanelStubComponent {
  file = input<AcpFile | null>(null);
  preview = input<FilePreviewResponse | null>(null);
  inlineUrl = input<string | null>(null);
  downloadUrl = input<string | null>(null);
  loading = input(false);
  error = input('');
}

function createFile(overrides: Partial<AcpFile>): AcpFile {
  return {
    id: 'file-1',
    acpId: 'acp-1',
    filePath: '/tmp/file-1',
    originalName: 'default.txt',
    fileSize: 123,
    uploadedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function createJob(overrides: Partial<FileProcessingJob>): FileProcessingJob {
  return {
    id: 'job-1',
    acpId: 'acp-1',
    jobType: 'archive-download',
    status: 'running',
    phase: 'zip-files',
    phaseLabel: 'ZIP wird erstellt',
    message: 'Archiv wird erstellt.',
    phaseCurrent: 1,
    phaseTotal: 3,
    uploadedFileCount: 3,
    archiveFileName: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    startedAt: '2026-04-01T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

describe('FilesComponent AP validation summary', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function renderSummary(summary: UploadValidationSummary) {
    await TestBed.configureTestingModule({
      imports: [FilesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { parent: { snapshot: { paramMap: new Map([['acpId', 'acp-1']]) } } },
        },
        {
          provide: ApiService,
          useValue: {
            getFileDownloadUrl: vi.fn().mockReturnValue('/api/acp/acp-1/files/file-1/download'),
            getFiles: vi.fn().mockReturnValue(
              of([
                createFile({
                  originalName: 'task.voud',
                  validationResult: { valid: true, issues: [], timestamp: summary.timestamp },
                }),
              ]),
            ),
          },
        },
      ],
    })
      .overrideComponent(FilesComponent, {
        remove: { imports: [AcpManagerContextComponent, FilePreviewPanelComponent] },
        add: { imports: [AcpManagerContextStubComponent, FilePreviewPanelStubComponent] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(FilesComponent);
    fixture.componentInstance.lastValidationSummary = summary;
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it.each(['error', 'warning'] as const)(
    'shows AP %s details once outside valid file rows',
    async (severity) => {
      const message = 'Booklet besitzt weder XML-Definition noch Module.';
      const path = 'assessmentParts[0].instruments[0].testcenterBooklet[0]';
      const root = await renderSummary({
        totalFiles: 1,
        validFiles: 1,
        invalidFiles: 0,
        semanticValid: severity !== 'error',
        semanticIssueCount: 1,
        semanticIssues: [{ severity, message, path }],
        timestamp: '2026-11-04T10:00:00.000Z',
      });

      expect(root.querySelector('.alert-warning')?.textContent).toContain(
        severity === 'error' ? 'Fehler vorhanden' : 'Warnungen vorhanden',
      );
      expect(root.querySelector('.alert-success')).toBeNull();
      const details = root.querySelectorAll('.ap-validation-issue');
      expect(details).toHaveLength(1);
      expect(details[0].textContent).toContain(message);
      expect(details[0].textContent).toContain(path);
      const fileRows = root.querySelector('tbody')!;
      expect(fileRows.textContent).toContain('task.voud');
      expect(fileRows.querySelector('.badge-success')?.textContent?.trim()).toBe('OK');
      expect(fileRows.textContent).not.toContain(message);
    },
  );

  it('renders older saved summaries without issue details', async () => {
    const root = await renderSummary({
      totalFiles: 1,
      validFiles: 1,
      invalidFiles: 0,
      semanticValid: true,
      semanticIssueCount: 0,
      timestamp: '2026-11-04T10:00:00.000Z',
    });

    expect(root.querySelector('.alert-success')?.textContent).toContain('AP-weite Prüfung: OK');
    expect(root.querySelector('.ap-validation-issues')).toBeNull();
  });
});

describe('FilesComponent filtering', () => {
  const seedFiles: AcpFile[] = [
    createFile({
      id: 'f-xml-ok',
      originalName: 'Unit_A.XML',
      fileType: 'application/xml',
      validationResult: {
        valid: true,
        issues: [],
        timestamp: '2026-04-01T00:00:00.000Z',
      },
    }),
    createFile({
      id: 'f-json-error',
      originalName: 'metadata.json',
      fileType: 'application/json',
      validationResult: {
        valid: false,
        issues: [
          {
            severity: 'error',
            message: 'schema mismatch',
          },
        ],
        timestamp: '2026-04-01T00:00:00.000Z',
      },
    }),
    createFile({
      id: 'f-no-type-unchecked',
      originalName: 'readme.txt',
      fileType: '',
    }),
  ];

  let api: {
    getFiles: ReturnType<typeof vi.fn>;
    getFilePreview: ReturnType<typeof vi.fn>;
    getFileContentUrl: ReturnType<typeof vi.fn>;
    deleteFile: ReturnType<typeof vi.fn>;
    deleteAllFiles: ReturnType<typeof vi.fn>;
    bulkDeleteFiles: ReturnType<typeof vi.fn>;
    startFileDownloadJob: ReturnType<typeof vi.fn>;
    getFileJobArchiveUrl: ReturnType<typeof vi.fn>;
  };

  let route: {
    parent: {
      snapshot: {
        paramMap: {
          get: ReturnType<typeof vi.fn>;
        };
      };
    };
  };

  let component: FilesComponent;

  beforeEach(() => {
    api = {
      getFiles: vi.fn().mockReturnValue(of(seedFiles)),
      getFilePreview: vi.fn().mockReturnValue(
        of({
          fileId: 'f-json-error',
          originalName: 'metadata.json',
          extension: 'json',
          mode: 'text',
          textFormat: 'json',
          textContent: '{"hello":true}',
          truncated: false,
        } satisfies FilePreviewResponse),
      ),
      getFileContentUrl: vi.fn().mockReturnValue('/api/acp/acp-1/files/f-json-error/download'),
      deleteFile: vi.fn().mockReturnValue(of({ message: 'File deleted successfully' })),
      deleteAllFiles: vi.fn().mockReturnValue(of({ message: 'All files deleted successfully' })),
      bulkDeleteFiles: vi.fn().mockReturnValue(of({ message: 'Files deleted successfully' })),
      startFileDownloadJob: vi.fn().mockReturnValue(
        of(
          createJob({
            id: 'job-download-1',
            status: 'pending',
            phase: 'queued',
            phaseLabel: 'Wartet auf ZIP-Erstellung',
            message: 'Download-Job wurde erstellt.',
            phaseCurrent: 0,
            phaseTotal: 0,
          }),
        ),
      ),
      getFileJobArchiveUrl: vi
        .fn()
        .mockReturnValue('/api/acp/acp-1/files/jobs/job-download-1/archive?auth_token=test'),
    };

    route = {
      parent: {
        snapshot: {
          paramMap: {
            get: vi.fn().mockReturnValue('acp-1'),
          },
        },
      },
    };

    component = new FilesComponent(route as any, api as any);
    component.acpId = 'acp-1';
    component.files = [...seedFiles];
    component.applyFilters();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-disposition': 'attachment; filename="acp-acp-1-selected-files.zip"',
          'content-type': 'application/zip',
        }),
        body: null,
        blob: vi.fn().mockResolvedValue(new Blob(['zip'])),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads files on init and applies default filters', () => {
    component.ngOnInit();

    expect(api.getFiles).toHaveBeenCalledWith('acp-1');
    expect(component.filteredFiles).toHaveLength(3);
  });

  it('filters by filename search case-insensitively', () => {
    component.searchQuery = 'unit_a';
    component.applyFilters();

    expect(component.filteredFiles.map((file) => file.id)).toEqual(['f-xml-ok']);
  });

  it('filters by file type', () => {
    component.selectedFileType = 'application/json';
    component.applyFilters();

    expect(component.filteredFiles.map((file) => file.id)).toEqual(['f-json-error']);
  });

  it('filters by files without type', () => {
    expect(component.hasFilesWithoutType).toBe(true);

    component.selectedFileType = component.FILE_TYPE_FILTER_NONE;
    component.applyFilters();

    expect(component.filteredFiles.map((file) => file.id)).toEqual(['f-no-type-unchecked']);
  });

  it('filters by validation state', () => {
    component.selectedValidationFilter = 'unchecked';
    component.applyFilters();

    expect(component.filteredFiles.map((file) => file.id)).toEqual(['f-no-type-unchecked']);
  });

  it('combines search and validation filter', () => {
    component.searchQuery = 'meta';
    component.selectedValidationFilter = 'error';
    component.applyFilters();

    expect(component.filteredFiles.map((file) => file.id)).toEqual(['f-json-error']);
  });

  it('resets active filters', () => {
    component.searchQuery = 'meta';
    component.selectedFileType = 'application/json';
    component.selectedValidationFilter = 'error';
    component.applyFilters();

    expect(component.hasActiveFilters()).toBe(true);
    expect(component.filteredFiles).toHaveLength(1);

    component.resetFilters();

    expect(component.searchQuery).toBe('');
    expect(component.selectedFileType).toBe(component.FILE_TYPE_FILTER_ALL);
    expect(component.selectedValidationFilter).toBe('all');
    expect(component.filteredFiles).toHaveLength(3);
    expect(component.hasActiveFilters()).toBe(false);
  });

  it('keeps active filters when the file list is reloaded', () => {
    component.searchQuery = 'meta';
    component.applyFilters();
    expect(component.filteredFiles.map((file) => file.id)).toEqual(['f-json-error']);

    api.getFiles.mockReturnValue(
      of([
        ...seedFiles,
        createFile({
          id: 'f-json-meta-2',
          originalName: 'meta-report.json',
          fileType: 'application/json',
        }),
      ]),
    );

    component.load();

    expect(component.filteredFiles.map((file) => file.id)).toEqual([
      'f-json-error',
      'f-json-meta-2',
    ]);
  });

  it('keeps delete-all scope on full dataset even with active filters', () => {
    component.searchQuery = 'meta';
    component.applyFilters();
    expect(component.filteredFiles).toHaveLength(1);
    expect(component.files).toHaveLength(3);

    component.openDeleteAllFilesDialog();

    expect(component.deleteDialogDetails[0]).toContain('3 Datei(en)');
  });

  it('selects visible filtered files without dropping existing hidden selection', () => {
    component.toggleFileSelection('f-xml-ok', true);
    component.searchQuery = 'meta';
    component.applyFilters();

    component.selectVisibleFiles();

    expect(Array.from(component.selectedFileIds)).toEqual(['f-xml-ok', 'f-json-error']);
    expect(component.selectedFilesCount).toBe(2);
    expect(component.allVisibleFilesSelected).toBe(true);
  });

  it('opens a dedicated delete dialog for the current selection', () => {
    component.toggleFileSelection('f-json-error', true);
    component.toggleFileSelection('f-no-type-unchecked', true);

    component.openDeleteSelectedFilesDialog();

    expect(component.deleteDialogMode).toBe('selected');
    expect(component.deleteDialogMessage).toContain('2 ausgewählte Datei(en)');
    expect(component.deleteDialogDetails[0]).toContain('2 Datei(en)');
    expect(component.deleteDialogDetails).toContain('metadata.json');
  });

  it('bulk deletes the current selection and clears preview + selection state', () => {
    component.toggleFileSelection('f-json-error', true);
    component.toggleFileSelection('f-no-type-unchecked', true);
    component.openPreview(seedFiles[1]);
    expect(component.selectedPreviewFile?.id).toBe('f-json-error');

    api.getFiles.mockReturnValue(of([seedFiles[0]]));
    component.openDeleteSelectedFilesDialog();
    component.confirmDeleteDialog();

    expect(api.bulkDeleteFiles).toHaveBeenCalledWith('acp-1', [
      'f-json-error',
      'f-no-type-unchecked',
    ]);
    expect(component.selectedPreviewFile).toBeNull();
    expect(component.selectedFilesCount).toBe(0);
    expect(component.files).toEqual([seedFiles[0]]);
  });

  it('derives ZIP progress and transfer progress from the current download state', () => {
    component.downloadJob = createJob({
      phaseCurrent: 1_024,
      phaseTotal: 2_048,
      message: '1 von 2 Datei(en), 1.0 KB von 2.0 KB verarbeitet',
    });

    expect(component.downloadStatusLabel).toBe('ZIP wird erstellt');
    expect(component.downloadPercent).toBe(50);
    expect(component.downloadProgress).toBe('1.0 KB von 2.0 KB verarbeitet');
    expect(component.downloadMessage).toBe('1 von 2 Datei(en), 1.0 KB von 2.0 KB verarbeitet');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:02.000Z'));
    component.downloadTransferActive = true;
    component.downloadTransferStartedAt = Date.now() - 2000;
    component.downloadTransferredBytes = 1024;
    component.downloadTransferTotalBytes = 2048;

    expect(component.downloadStatusLabel).toBe('ZIP wird heruntergeladen');
    expect(component.downloadPercent).toBe(50);
    expect(component.downloadProgress).toBe('1.0 KB von 2.0 KB');
    expect(component.downloadMessage).toBe(
      'Das ZIP-Archiv wird in den Browser übertragen. 512 B/s · 2 s verbleibend',
    );
  });

  it('downloads all files as ZIP via background job and archive endpoint', async () => {
    const triggerBrowserDownload = vi
      .spyOn(component as any, 'triggerBrowserDownload')
      .mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-disposition': 'attachment; filename="acp-acp-1-all-files.zip"',
          'content-type': 'application/zip',
        }),
        body: null,
        blob: vi.fn().mockResolvedValue(new Blob(['zip'])),
      }),
    );
    vi.spyOn(component as any, 'waitForJob').mockResolvedValue(
      createJob({
        id: 'job-download-1',
        status: 'completed',
        phase: 'completed',
        phaseLabel: 'ZIP bereit',
        archiveFileName: 'acp-acp-1-all-files.zip',
        phaseCurrent: 3,
        phaseTotal: 3,
        finishedAt: '2026-04-01T00:00:01.000Z',
      }),
    );

    await component.downloadAllFiles();

    expect(api.startFileDownloadJob).toHaveBeenCalledWith('acp-1', { fileIds: [] });
    expect(api.getFileJobArchiveUrl).toHaveBeenCalledWith('acp-1', 'job-download-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/acp/acp-1/files/jobs/job-download-1/archive?auth_token=test',
    );
    expect(triggerBrowserDownload).toHaveBeenCalledWith(
      expect.any(Blob),
      'acp-acp-1-all-files.zip',
    );
  });

  it('downloads the selected files as ZIP via background job and archive endpoint', async () => {
    const triggerBrowserDownload = vi
      .spyOn(component as any, 'triggerBrowserDownload')
      .mockImplementation(() => {});
    vi.spyOn(component as any, 'waitForJob').mockResolvedValue(
      createJob({
        id: 'job-download-1',
        status: 'completed',
        phase: 'completed',
        phaseLabel: 'ZIP bereit',
        archiveFileName: 'acp-acp-1-selected-files.zip',
        phaseCurrent: 2,
        phaseTotal: 2,
        finishedAt: '2026-04-01T00:00:01.000Z',
      }),
    );
    component.toggleFileSelection('f-json-error', true);
    component.toggleFileSelection('f-no-type-unchecked', true);

    await component.downloadSelectedFiles();

    expect(api.startFileDownloadJob).toHaveBeenCalledWith('acp-1', {
      fileIds: ['f-json-error', 'f-no-type-unchecked'],
    });
    expect(api.getFileJobArchiveUrl).toHaveBeenCalledWith('acp-1', 'job-download-1');
    expect(triggerBrowserDownload).toHaveBeenCalled();
  });

  it('loads a preview for the selected file', () => {
    component.acpId = 'acp-1';
    component.openPreview(seedFiles[1]);

    expect(api.getFilePreview).toHaveBeenCalledWith('acp-1', 'f-json-error');
    expect(component.selectedPreviewFile?.id).toBe('f-json-error');
    expect(component.selectedPreview?.textFormat).toBe('json');
    expect(component.previewLoading).toBe(false);
    expect(component.selectedPreviewInlineUrl).toContain('download');
  });

  it('toggles the active preview off when selecting the same file again', () => {
    component.acpId = 'acp-1';
    component.openPreview(seedFiles[1]);
    expect(component.selectedPreviewFile?.id).toBe('f-json-error');

    component.openPreview(seedFiles[1]);

    expect(component.selectedPreviewFile).toBeNull();
    expect(component.selectedPreview).toBeNull();
  });

  it('clears the preview when the selected file disappears on reload', () => {
    component.acpId = 'acp-1';
    component.openPreview(seedFiles[1]);
    expect(component.selectedPreviewFile?.id).toBe('f-json-error');

    api.getFiles.mockReturnValue(of([seedFiles[0]]));
    component.load();

    expect(component.selectedPreviewFile).toBeNull();
    expect(component.selectedPreview).toBeNull();
  });

  it('drops stale file selections when the list is reloaded', () => {
    component.toggleFileSelection('f-json-error', true);
    expect(component.selectedFilesCount).toBe(1);

    api.getFiles.mockReturnValue(of([seedFiles[0]]));
    component.load();

    expect(component.selectedFilesCount).toBe(0);
  });

  it('maps payload-too-large upload errors to a helpful message', () => {
    const message = (component as any).getUploadErrorMessage(
      new HttpErrorResponse({
        status: 413,
        error: 'File too large',
      }),
    );

    expect(message).toBe(
      'Die ausgewählte Datei ist größer als das aktuell erlaubte Upload-Limit des Servers.',
    );
  });
});
