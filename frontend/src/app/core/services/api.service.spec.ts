import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { Acp, User, AppSettings, AcpFile } from '../models/api.models';

describe('ApiService', () => {
  let service: ApiService;
  let httpClientMock: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    httpClientMock = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      put: vi.fn(),
    };
    service = new ApiService(httpClientMock as any);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('distinguishes booklet requests from legacy module requests with the same ID', () => {
    service.getViewSequence('acp-1', 'same');
    expect(httpClientMock.get).toHaveBeenLastCalledWith('/api/view/acp/acp-1/sequences/same');
    service.getViewSequence('acp-1', 'same', 'booklet');
    expect(httpClientMock.get).toHaveBeenLastCalledWith(
      '/api/view/acp/acp-1/sequences/same?kind=booklet',
    );
  });

  describe('Users', () => {
    it('should get users', () => {
      const mockUsers: User[] = [
        { id: '1', username: 'user1', displayName: 'User 1', isAppAdmin: false },
      ];
      httpClientMock.get.mockReturnValue(of(mockUsers));

      service.getUsers().subscribe((users) => {
        expect(users).toEqual(mockUsers);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/users');
    });

    it('should create user', () => {
      const userData = { username: 'newuser', displayName: 'New User' };
      const mockUser: User = {
        id: '2',
        username: 'newuser',
        displayName: 'New User',
        isAppAdmin: false,
      };
      httpClientMock.post.mockReturnValue(of(mockUser));

      service.createUser(userData).subscribe((user) => {
        expect(user).toEqual(mockUser);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/users', userData);
    });

    it('should update user', () => {
      const updateData = { displayName: 'Updated' };
      const mockUser: User = {
        id: '1',
        username: 'user1',
        displayName: 'Updated',
        isAppAdmin: false,
      };
      httpClientMock.patch.mockReturnValue(of(mockUser));

      service.updateUser('1', updateData).subscribe((user) => {
        expect(user).toEqual(mockUser);
      });

      expect(httpClientMock.patch).toHaveBeenCalledWith('/api/users/1', updateData);
    });

    it('should delete user', () => {
      httpClientMock.delete.mockReturnValue(of(null));

      service.deleteUser('1').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/users/1');
    });

    it('should set app admin', () => {
      const mockUser: User = {
        id: '1',
        username: 'user1',
        displayName: 'User 1',
        isAppAdmin: true,
      };
      httpClientMock.patch.mockReturnValue(of(mockUser));

      service.setAppAdmin('1', true).subscribe((user) => {
        expect(user.isAppAdmin).toBe(true);
      });

      expect(httpClientMock.patch).toHaveBeenCalledWith('/api/users/1/app-admin', {
        isAppAdmin: true,
      });
    });
  });

  describe('Settings', () => {
    it('should get settings', () => {
      const mockSettings: AppSettings = {
        id: '1',
        theme: {},
        language: 'de',
        logoUrl: 'logo.png',
        defaultAcpIndex: {},
      };
      httpClientMock.get.mockReturnValue(of(mockSettings));

      service.getSettings().subscribe((settings) => {
        expect(settings).toEqual(mockSettings);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/admin/settings');
    });

    it('should update settings', () => {
      const updateData: Partial<AppSettings> = { language: 'en' };
      const mockSettings: AppSettings = {
        id: '1',
        theme: {},
        language: 'en',
        logoUrl: 'logo.png',
        defaultAcpIndex: {},
      };
      httpClientMock.put.mockReturnValue(of(mockSettings));

      service.updateSettings(updateData).subscribe((settings) => {
        expect(settings.language).toBe('en');
      });

      expect(httpClientMock.put).toHaveBeenCalledWith('/api/admin/settings', updateData);
    });

    it('should upload the GeoGebra bundle', () => {
      const formData = new FormData();
      const mockSettings: AppSettings = {
        id: '1',
        theme: {},
        language: 'de',
        logoUrl: 'logo.png',
        defaultAcpIndex: {},
        geoGebraBundle: {
          sourceFileName: 'GeoGebra.itcr.zip',
          deployScriptUrl: '/api/shared-assets/GeoGebra/GeoGebra/deployggb.js',
          publicBasePath: '/api/shared-assets',
          checksum: 'abc',
          entryCount: 2,
          uploadedAt: '2026-04-21T10:00:00.000Z',
        },
      };
      httpClientMock.post.mockReturnValue(of(mockSettings));

      service.uploadGeoGebraBundle(formData).subscribe((settings) => {
        expect(settings.geoGebraBundle?.sourceFileName).toBe('GeoGebra.itcr.zip');
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/admin/settings/geogebra-bundle',
        formData,
      );
    });

    it('should delete the GeoGebra bundle', () => {
      const mockSettings: AppSettings = {
        id: '1',
        theme: {},
        language: 'de',
        logoUrl: 'logo.png',
        defaultAcpIndex: {},
        geoGebraBundle: null,
      };
      httpClientMock.delete.mockReturnValue(of(mockSettings));

      service.deleteGeoGebraBundle().subscribe((settings) => {
        expect(settings.geoGebraBundle).toBeNull();
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/admin/settings/geogebra-bundle');
    });
  });

  describe('Application tokens', () => {
    it('should list application tokens with pagination', () => {
      const response = { items: [], total: 0, limit: 25, offset: 10 };
      httpClientMock.get.mockReturnValue(of(response));

      service.getApplicationTokens({ limit: 25, offset: 10 }).subscribe((tokens) => {
        expect(tokens).toEqual(response);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/admin/application-tokens?limit=25&offset=10',
      );
    });

    it('should create application tokens', () => {
      const payload = { name: 'Studio', scopes: ['acp.read' as const], expiresAt: null };
      const response = {
        id: 'token-1',
        name: 'Studio',
        tokenPrefix: 'cp_abc...',
        token: 'cp_secret',
        scopes: ['acp.read' as const],
        active: true,
        expiresAt: null,
        lastUsedAt: null,
        createdByUserId: 'admin-1',
        revokedByUserId: null,
        revokedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      httpClientMock.post.mockReturnValue(of(response));

      service.createApplicationToken(payload).subscribe((token) => {
        expect(token.token).toBe('cp_secret');
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/admin/application-tokens', payload);
    });

    it('should revoke application tokens', () => {
      httpClientMock.patch.mockReturnValue(of({ id: 'token-1', active: false }));

      service.revokeApplicationToken('token-1').subscribe((token) => {
        expect(token.active).toBe(false);
      });

      expect(httpClientMock.patch).toHaveBeenCalledWith(
        '/api/admin/application-tokens/token-1/revoke',
        {},
      );
    });
  });

  describe('ACP', () => {
    const baseAcp: Acp = {
      id: '1',
      packageId: 'pkg-1',
      name: 'ACP 1',
      description: 'Desc',
      acpIndex: {},
      settings: {},
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    it('should get all ACPs', () => {
      httpClientMock.get.mockReturnValue(of([baseAcp]));

      service.getAcps().subscribe((acps) => {
        expect(acps).toEqual([baseAcp]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp');
    });

    it('should get single ACP', () => {
      httpClientMock.get.mockReturnValue(of(baseAcp));

      service.getAcp('1').subscribe((acp) => {
        expect(acp).toEqual(baseAcp);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/1');
    });

    it('should create ACP', () => {
      const createData = { name: 'New ACP', description: 'New Desc' };
      httpClientMock.post.mockReturnValue(of(baseAcp));

      service.createAcp(createData).subscribe((acp) => {
        expect(acp).toBeTruthy();
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp', createData);
    });

    it('should update ACP', () => {
      const updateData = { name: 'Updated' };
      const updatedAcp = { ...baseAcp, name: 'Updated' };
      httpClientMock.patch.mockReturnValue(of(updatedAcp));

      service.updateAcp('1', updateData).subscribe((acp) => {
        expect(acp.name).toBe('Updated');
      });

      expect(httpClientMock.patch).toHaveBeenCalledWith('/api/acp/1', updateData);
    });

    it('should delete ACP', () => {
      httpClientMock.delete.mockReturnValue(of(null));

      service.deleteAcp('1').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/acp/1');
    });
  });

  describe('Files', () => {
    it('should get files', () => {
      const mockFiles: AcpFile[] = [
        {
          id: '1',
          acpId: 'acp1',
          filePath: '/files/test.zip',
          originalName: 'test.zip',
          fileSize: 1000,
          uploadedAt: '2024-01-01',
        },
      ];
      httpClientMock.get.mockReturnValue(of(mockFiles));

      service.getFiles('acp1').subscribe((files) => {
        expect(files).toEqual(mockFiles);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/files');
    });

    it('should delete file', () => {
      httpClientMock.delete.mockReturnValue(of(null));

      service.deleteFile('acp1', 'file1').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/acp/acp1/files/file1');
    });

    it('should bulk delete files', () => {
      httpClientMock.post.mockReturnValue(of({ message: 'Files deleted successfully' }));

      service.bulkDeleteFiles('acp1', ['file1', 'file2']).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/files/bulk-delete', {
        fileIds: ['file1', 'file2'],
      });
    });

    it('should start a ZIP creation job for selected files', () => {
      httpClientMock.post.mockReturnValue(of({ id: 'job-1', status: 'pending' }));

      service.startFileDownloadJob('acp1', { fileIds: ['file1', 'file2'] }).subscribe((job) => {
        expect(job).toEqual({ id: 'job-1', status: 'pending' });
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/files/bulk-download/jobs', {
        fileIds: ['file1', 'file2'],
      });
    });

    it('should request a ZIP archive for all or selected files', () => {
      const blob = new Blob(['zip']);
      httpClientMock.post.mockReturnValue(of({ body: blob }));

      service.downloadFilesArchive('acp1').subscribe((result) => {
        expect(result).toEqual({ body: blob });
      });

      expect(httpClientMock.post).toHaveBeenNthCalledWith(
        1,
        '/api/acp/acp1/files/bulk-download',
        { fileIds: [] },
        {
          observe: 'response',
          responseType: 'blob',
        },
      );

      service.downloadFilesArchive('acp1', ['file1', 'file2']).subscribe((result) => {
        expect(result).toEqual({ body: blob });
      });

      expect(httpClientMock.post).toHaveBeenNthCalledWith(
        2,
        '/api/acp/acp1/files/bulk-download',
        { fileIds: ['file1', 'file2'] },
        {
          observe: 'response',
          responseType: 'blob',
        },
      );
    });

    it('should download the generated ZIP archive of a completed job with progress events', () => {
      const event = { type: 'response' };
      httpClientMock.get.mockReturnValue(of(event));

      service.downloadFileJobArchive('acp1', 'job-1').subscribe((result) => {
        expect(result).toEqual(event);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/files/jobs/job-1/archive', {
        observe: 'events',
        reportProgress: true,
        responseType: 'blob',
      });
    });

    it('should upload files without conflict strategy query', () => {
      const formData = new FormData();
      httpClientMock.post.mockReturnValue(
        of({
          files: [],
        }),
      );

      service.uploadFiles('acp1', formData).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/files/upload', formData, {
        observe: 'events',
        reportProgress: true,
      });
    });

    it('should upload files with conflict strategy query', () => {
      const formData = new FormData();
      httpClientMock.post.mockReturnValue(
        of({
          files: [],
        }),
      );

      service.uploadFiles('acp1', formData, { conflictStrategy: 'overwrite' }).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/files/upload?conflictStrategy=overwrite',
        formData,
        {
          observe: 'events',
          reportProgress: true,
        },
      );
    });

    it('should preflight uploads without progress event mode', () => {
      const formData = new FormData();
      httpClientMock.post.mockReturnValue(of({ canUpload: true }));

      service.preflightUpload('acp1', formData, { conflictStrategy: 'overwrite' }).subscribe();

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/files/upload-preflight?conflictStrategy=overwrite',
        formData,
      );
    });

    it('should start file processing', () => {
      httpClientMock.post.mockReturnValue(of({ id: 'job-1' }));

      service
        .startFileProcessing('acp1', { fileIds: ['file-1'], runCleanup: true })
        .subscribe((result) => {
          expect(result).toEqual({ id: 'job-1' });
        });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/files/process-upload', {
        fileIds: ['file-1'],
        runCleanup: true,
      });
    });

    it('should get file processing job', () => {
      httpClientMock.get.mockReturnValue(of({ id: 'job-1', status: 'running' }));

      service.getFileProcessingJob('acp1', 'job-1').subscribe((result) => {
        expect(result).toEqual({ id: 'job-1', status: 'running' });
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/files/jobs/job-1');
    });

    it('should build file processing events URL with auth token', () => {
      localStorage.setItem('cp_token', 'job-token');

      const url = service.getFileProcessingJobEventsUrl('acp1', 'job-1');

      expect(url).toBe('/api/acp/acp1/files/jobs/job-1/events?auth_token=job-token');
    });

    it('should validate unit files', () => {
      const response = {
        unitResults: [],
        validationSummary: {
          runId: 'r1',
          validFiles: 0,
          invalidFiles: 0,
          totalIssues: 0,
          durationMs: 1,
          timestamp: new Date().toISOString(),
        },
      };
      httpClientMock.get.mockReturnValue(of(response));

      service.validateUnitFiles('acp1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/files/validate-units');
    });

    it('should get file download URL with token', () => {
      localStorage.setItem('cp_token', 'test-token');
      const url = service.getFileDownloadUrl('acp1', 'file1');
      expect(url).toContain('auth_token=test-token');
    });

    it('should get file download URL without token', () => {
      localStorage.removeItem('cp_token');
      const url = service.getFileDownloadUrl('acp1', 'file1');
      expect(url).toBe('/api/acp/acp1/files/file1/download');
    });

    it('should get inline file content URL', () => {
      localStorage.setItem('cp_token', 'preview-token');
      const url = service.getFileContentUrl('acp1', 'file1', { disposition: 'inline' });

      expect(url).toContain('/api/acp/acp1/files/file1/download');
      expect(url).toContain('auth_token=preview-token');
      expect(url).toContain('disposition=inline');
    });

    it('should get file job archive URL with auth token', () => {
      localStorage.setItem('cp_token', 'job-token');
      const url = service.getFileJobArchiveUrl('acp1', 'job-1');

      expect(url).toBe('/api/acp/acp1/files/jobs/job-1/archive?auth_token=job-token');
    });

    it('should request file preview metadata', () => {
      httpClientMock.get.mockReturnValue(
        of({
          fileId: 'file1',
          originalName: 'test.json',
          extension: 'json',
          mode: 'text',
          truncated: false,
        }),
      );

      service.getFilePreview('acp1', 'file1').subscribe((result) => {
        expect(result.fileId).toBe('file1');
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/files/file1/preview');
    });

    it('should request explorer item list with read-only perspective when provided', () => {
      httpClientMock.get.mockReturnValue(of({ items: [] }));

      service.getFileItemList('acp1', { perspective: 'read-only' }).subscribe((result) => {
        expect(result).toEqual({ items: [] });
      });

      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/acp/acp1/files/item-list?perspective=read-only',
      );
    });

    it('should request a fresh Item Explorer row numbering', () => {
      httpClientMock.post.mockReturnValue(of({ renumberedCount: 4 }));

      service.recalculateItemRowNumbers('acp1').subscribe((result) => {
        expect(result).toEqual({ renumberedCount: 4 });
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/files/item-list/renumber',
        {},
      );
    });

    it('should request explorer unit view with read-only perspective when provided', () => {
      httpClientMock.get.mockReturnValue(of({ unitId: 'unit-1' }));

      service
        .getFileUnitView('acp1', 'unit-1', { perspective: 'read-only' })
        .subscribe((result) => {
          expect(result).toEqual({ unitId: 'unit-1' });
        });

      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/acp/acp1/files/unit-view/unit-1?perspective=read-only',
      );
    });
  });

  describe('ACP Index', () => {
    it('should get ACP index', () => {
      httpClientMock.get.mockReturnValue(of({ entries: [] }));

      service.getAcpIndex('acp1').subscribe((result) => {
        expect(result).toEqual({ entries: [] });
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/index');
    });

    it('should update ACP index', () => {
      const indexData = { entries: [{ id: '1' }] };
      httpClientMock.put.mockReturnValue(of(indexData));

      service.updateAcpIndex('acp1', indexData).subscribe((result) => {
        expect(result).toEqual(indexData);
      });

      expect(httpClientMock.put).toHaveBeenCalledWith('/api/acp/acp1/index', indexData);
    });

    it('should import ACP index', () => {
      const importData = { entries: [{ id: '1' }] };
      httpClientMock.post.mockReturnValue(of(importData));

      service.importAcpIndex('acp1', importData).subscribe((result) => {
        expect(result).toEqual(importData);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/index/import', importData);
    });

    it('should delete ACP index', () => {
      httpClientMock.delete.mockReturnValue(of({}));

      service.deleteAcpIndex('acp1').subscribe((result) => {
        expect(result).toEqual({});
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/acp/acp1/index');
    });

    it('should build index export URL with auth token', () => {
      localStorage.setItem('cp_token', 'token+1');

      const url = service.getIndexExportUrl('acp1');

      expect(url).toBe('/api/acp/acp1/index/export?auth_token=token%2B1');
    });

    it('should build index export URL without auth token', () => {
      localStorage.removeItem('cp_token');

      const url = service.getIndexExportUrl('acp1');

      expect(url).toBe('/api/acp/acp1/index/export');
    });
  });

  describe('ACP Roles', () => {
    it('should get ACP roles', () => {
      httpClientMock.get.mockReturnValue(of([{ userId: '1', role: 'MANAGER' }]));

      service.getAcpRoles('acp1').subscribe((result) => {
        expect(result).toEqual([{ userId: '1', role: 'MANAGER' }]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/roles');
    });

    it('should assign ACP role', () => {
      const roleData = { userId: '1', role: 'MANAGER' };
      httpClientMock.post.mockReturnValue(of(roleData));

      service.assignAcpRole('acp1', roleData).subscribe((result) => {
        expect(result).toEqual(roleData);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/roles', roleData);
    });

    it('should remove ACP role', () => {
      httpClientMock.delete.mockReturnValue(of(null));

      service.removeAcpRole('acp1', 'user1').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/acp/acp1/roles/user1');
    });
  });

  describe('ACP Access', () => {
    it('should get access config', () => {
      const accessConfig = { id: '1', accessModel: 'PUBLIC' };
      httpClientMock.get.mockReturnValue(of(accessConfig));

      service.getAccessConfig('acp1').subscribe((result) => {
        expect(result).toEqual(accessConfig);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/access');
    });

    it('should update access config', () => {
      const configData = { accessModel: 'PRIVATE' };
      httpClientMock.put.mockReturnValue(of(configData));

      service.updateAccessConfig('acp1', configData).subscribe((result) => {
        expect(result).toEqual(configData);
      });

      expect(httpClientMock.put).toHaveBeenCalledWith('/api/acp/acp1/access', configData);
    });

    it('should upload credentials', () => {
      const credentials = [{ username: 'user1', password: 'pass' }];
      httpClientMock.post.mockReturnValue(of({}));

      service.uploadCredentials('acp1', credentials).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/access/credentials?mode=replace',
        { credentials },
      );
    });

    it('should upload credentials with append mode', () => {
      const credentials = [{ username: 'user1', password: 'pass' }];
      httpClientMock.post.mockReturnValue(of({}));

      service.uploadCredentials('acp1', credentials, 'append').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/access/credentials?mode=append',
        { credentials },
      );
    });

    it('should update metadata columns', () => {
      const columns = ['col1', 'col2'];
      httpClientMock.put.mockReturnValue(of({}));

      service.updateMetadataColumns('acp1', columns).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.put).toHaveBeenCalledWith('/api/acp/acp1/metadata-columns', columns);
    });
  });

  describe('Snapshots', () => {
    it('should get snapshot diff', () => {
      httpClientMock.get.mockReturnValue(of({ changes: [] }));

      service.getSnapshotDiff('acp1', 'snap1').subscribe((result) => {
        expect(result).toEqual({ changes: [] });
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/snapshots/snap1/diff');
    });
  });

  describe('Comments', () => {
    it('should get my comments', () => {
      httpClientMock.get.mockReturnValue(of([]));

      service.getMyComments('acp1').subscribe((result) => {
        expect(result).toEqual([]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/comments/mine');
    });

    it('should export comments', () => {
      httpClientMock.get.mockReturnValue(of([]));

      service.exportComments('acp1').subscribe((result) => {
        expect(result).toEqual([]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/comments/export');
    });

    it('should create comments and export XLSX comments', () => {
      const created = {
        id: 'c1',
        targetType: 'ITEM',
        targetId: 'item1',
        commentText: 'hello',
      } as any;
      const blob = new Blob(['xlsx'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      httpClientMock.post.mockReturnValue(of(created));
      httpClientMock.get.mockReturnValue(of(blob));

      service
        .createComment('acp1', { targetType: 'ITEM', targetId: 'item1', commentText: 'hello' })
        .subscribe((result) => {
          expect(result).toEqual(created);
        });
      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/comments', {
        targetType: 'ITEM',
        targetId: 'item1',
        commentText: 'hello',
      });

      service.exportCommentsXlsx('acp1').subscribe((result) => {
        expect(result).toEqual(blob);
      });
      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/comments/export.xlsx', {
        responseType: 'blob',
      });
    });

    it('reuses only the supplied visible snapshot on HTTP 304 and propagates revoked access', () => {
      const previous: any = {
        revision: 'visible-a',
        target: { unitId: 'U', itemId: 'I' },
        visibilityMode: 'GROUP',
        comments: [{ id: 'own-group' }],
      };
      httpClientMock.get.mockReturnValue(throwError(() => ({ status: 304 })));
      let result: any;
      service
        .getItemCommentThread('acp1', 'U', 'I', previous)
        .subscribe((snapshot) => (result = snapshot));
      expect(result).toBe(previous);
      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/review/comments', {
        params: { unitId: 'U', itemId: 'I' },
        headers: { 'If-None-Match': '"visible-a"' },
      });
      httpClientMock.get.mockReturnValue(throwError(() => ({ status: 403 })));
      let failure: any;
      service
        .getItemCommentThread('acp1', 'U', 'I', previous)
        .subscribe({ error: (error) => (failure = error) });
      expect(failure.status).toBe(403);
    });

    it('should load and mutate item comment threads', () => {
      httpClientMock.get.mockReturnValue(
        of({ revision: '1', visibilityMode: 'SHARED', comments: [] }),
      );
      httpClientMock.post.mockReturnValue(of({ id: 'c1' }));
      httpClientMock.patch.mockReturnValue(of({ id: 'c1', version: 2 }));
      httpClientMock.delete.mockReturnValue(of({ success: true }));

      service.getItemCommentThread('acp1', 'unit1', 'item1').subscribe();
      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/review/comments', {
        params: { unitId: 'unit1', itemId: 'item1' },
      });

      service.getItemCommentCounts('acp1').subscribe();
      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/review/comments/counts');

      service
        .createItemComment('acp1', {
          unitId: 'unit1',
          itemId: 'item1',
          commentText: 'Hallo',
          parentCommentId: 'parent1',
        })
        .subscribe();
      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/review/comments', {
        unitId: 'unit1',
        itemId: 'item1',
        commentText: 'Hallo',
        parentCommentId: 'parent1',
      });

      service.updateItemComment('acp1', 'c1', { commentText: 'Neu', version: 1 }).subscribe();
      expect(httpClientMock.patch).toHaveBeenCalledWith('/api/acp/acp1/review/comments/c1', {
        commentText: 'Neu',
        version: 1,
      });

      service.deleteItemComment('acp1', 'c1', 2).subscribe();
      expect(httpClientMock.delete).toHaveBeenCalledWith('/api/acp/acp1/review/comments/c1', {
        params: { version: 2 },
      });
    });

    it('uses explicit personal and administrative review export paths', () => {
      const blob = new Blob(['export']);
      httpClientMock.get.mockReturnValue(of(blob));

      service.exportMyReviewCommentsCsv('acp1').subscribe();
      expect(httpClientMock.get).toHaveBeenNthCalledWith(
        1,
        '/api/acp/acp1/review/comments/export/mine.csv',
        { params: {}, responseType: 'blob' },
      );
      service.exportMyReviewCommentsXlsx('acp1').subscribe();
      expect(httpClientMock.get).toHaveBeenNthCalledWith(
        2,
        '/api/acp/acp1/review/comments/export/mine.xlsx',
        { params: {}, responseType: 'blob' },
      );
      service.exportAllReviewCommentsXlsx('acp1').subscribe();
      expect(httpClientMock.get).toHaveBeenNthCalledWith(
        3,
        '/api/acp/acp1/review/comments/export/all.xlsx',
        { responseType: 'blob' },
      );
    });
  });

  describe('Public Views', () => {
    it('should get public settings and public ACP list', () => {
      const publicSettings = { language: 'de' };
      const publicAcps = [{ id: 'acp1', name: 'Public ACP' }];
      httpClientMock.get
        .mockReturnValueOnce(of(publicSettings))
        .mockReturnValueOnce(of(publicAcps));

      service.getPublicSettings().subscribe((result) => {
        expect(result).toEqual(publicSettings);
      });
      expect(httpClientMock.get).toHaveBeenNthCalledWith(1, '/api/view/settings');

      service.getPublicAcps().subscribe((result) => {
        expect(result).toEqual(publicAcps);
      });
      expect(httpClientMock.get).toHaveBeenNthCalledWith(2, '/api/view/acp');
    });

    it('should get ACP start page', () => {
      httpClientMock.get.mockReturnValue(of({}));

      service.getAcpStartPage('acp1').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1');
    });

    it('should get view units', () => {
      httpClientMock.get.mockReturnValue(of([{ id: 'unit1' }]));

      service.getViewUnits('acp1').subscribe((result) => {
        expect(result).toEqual([{ id: 'unit1' }]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/units');
    });

    it('should get view unit', () => {
      httpClientMock.get.mockReturnValue(of({ id: 'unit1', items: [] }));

      service.getViewUnit('acp1', 'unit1').subscribe((result) => {
        expect(result.id).toBe('unit1');
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/units/unit1');
    });

    it('should get view items', () => {
      httpClientMock.get.mockReturnValue(of([]));

      service.getViewItems('acp1').subscribe((result) => {
        expect(result).toEqual([]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/items');
    });

    it('should get view item preferences', () => {
      httpClientMock.get.mockReturnValue(of({ ui: {}, tags: {} }));

      service.getViewItemPreferences('acp1', 'item-explorer').subscribe((result) => {
        expect(result).toEqual({ ui: {}, tags: {} });
      });

      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/preferences?viewId=item-explorer',
      );
    });

    it('should save view item preferences', () => {
      const payload = { ui: { filterText: 'abc' }, tags: { item1: ['A'] } };
      httpClientMock.put.mockReturnValue(of(payload));

      service.saveViewItemPreferences('acp1', payload, 'item-list').subscribe((result) => {
        expect(result).toEqual(payload);
      });

      expect(httpClientMock.put).toHaveBeenCalledWith('/api/view/acp/acp1/items/preferences', {
        viewId: 'item-list',
        ...payload,
      });
    });

    it('should patch one personal item preference row', () => {
      const rowData = { category: 'II', note: 'Persönlich' };
      httpClientMock.patch.mockReturnValue(of({ rowData: { 'uuid::1': rowData } }));

      service
        .patchViewItemPreferenceRow('acp1', 'uuid::1', rowData, 'read-only')
        .subscribe((result) => {
          expect(result.rowData).toEqual({ 'uuid::1': rowData });
        });

      expect(httpClientMock.patch).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/preferences/row-data',
        { rowKey: 'uuid::1', rowData, perspective: 'read-only' },
      );
    });

    it('should export personal item data in the current Explorer order', () => {
      const blob = new Blob(['xlsx']);
      httpClientMock.post.mockReturnValue(of(blob));

      service
        .exportViewPersonalItemDataXlsx('acp1', ['uuid-2::1', 'uuid-1::1'], 'read-only')
        .subscribe((result) => {
          expect(result).toBe(blob);
        });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/preferences/export.xlsx',
        { rowKeys: ['uuid-2::1', 'uuid-1::1'], perspective: 'read-only' },
        { responseType: 'blob' },
      );
    });

    it('should export all participants personal item data as CSV', () => {
      const blob = new Blob(['csv']);
      httpClientMock.post.mockReturnValue(of(blob));

      service.exportAllViewPersonalItemDataCsv('acp1', 'editor').subscribe((result) => {
        expect(result).toBe(blob);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/preferences/export-all.csv',
        { perspective: 'editor' },
        { responseType: 'blob' },
      );
    });

    it('sends the selected collection identifier for the aggregate CSV export', () => {
      httpClientMock.post.mockReturnValue(of(new Blob(['csv'])));
      service.exportAllViewPersonalItemDataCsv('acp1', 'editor', 'collection-1').subscribe();
      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/preferences/export-all.csv',
        { perspective: 'editor', collectionId: 'collection-1' },
        { responseType: 'blob' },
      );
    });

    it('should persist the active personal item list view mode', () => {
      const payload = {
        activeCollectionId: 'collection-1',
        collectionViewMode: 'active' as const,
        collections: [],
      };
      httpClientMock.put.mockReturnValue(of(payload));

      service
        .activateItemCollection('acp1', 'collection-1', 'read-only', 'active')
        .subscribe((result) => expect(result).toEqual(payload));

      expect(httpClientMock.put).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/collections/active',
        {
          collectionId: 'collection-1',
          perspective: 'read-only',
          collectionViewMode: 'active',
        },
      );
    });

    it('should mutate collection rows without sending the complete collection', () => {
      const result = {
        collectionId: 'collection-1',
        version: 3,
        updatedAt: '2026-07-22T10:00:00.000Z',
        summary: { rowCount: 2 },
      };
      httpClientMock.patch.mockReturnValue(of(result));

      service
        .mutateItemCollectionRows('acp1', 'collection-1', {
          baseVersion: 2,
          removeRowKeys: ['uuid::1'],
          perspective: 'read-only',
        })
        .subscribe((response) => expect(response).toBe(result));

      expect(httpClientMock.patch).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/collections/collection-1/rows',
        {
          baseVersion: 2,
          removeRowKeys: ['uuid::1'],
          perspective: 'read-only',
        },
      );
    });

    it('should get view sequences', () => {
      httpClientMock.get.mockReturnValue(of([]));

      service.getViewSequences('acp1').subscribe((result) => {
        expect(result).toEqual([]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/sequences');
    });

    it('should get view sequence', () => {
      httpClientMock.get.mockReturnValue(of({ id: 'seq1', units: [] }));

      service.getViewSequence('acp1', 'seq1').subscribe((result) => {
        expect(result.id).toBe('seq1');
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/sequences/seq1');
    });

    it('should get view index and build export URL with/without token', () => {
      httpClientMock.get.mockReturnValue(of({ assessmentParts: [] }));

      service.getViewIndex('acp1').subscribe((result) => {
        expect(result).toEqual({ assessmentParts: [] });
      });
      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/index');

      localStorage.setItem('cp_token', 'token+view');
      expect(service.getViewIndexExportUrl('acp1')).toBe(
        '/api/view/acp/acp1/index/export?auth_token=token%2Bview',
      );

      localStorage.removeItem('cp_token');
      expect(service.getViewIndexExportUrl('acp1')).toBe('/api/view/acp/acp1/index/export');
    });
  });

  describe('Item Explorer shared state', () => {
    it('should fetch shared explorer state', () => {
      httpClientMock.get.mockReturnValue(of({ status: 'CLEAN', version: 1 }));

      service.getItemExplorerState('acp1').subscribe((result) => {
        expect((result as any).version).toBe(1);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/view/acp/acp1/item-explorer/state', {
        params: {},
      });
    });

    it('should patch explorer draft', () => {
      const payload = {
        changeType: 'UI_STATE_CHANGED',
        patch: { ui: { filterText: 'x' } },
        baseVersion: 4,
      };
      httpClientMock.patch.mockReturnValue(of({ status: 'DIRTY', version: 5 }));

      service.patchItemExplorerDraft('acp1', payload).subscribe((result) => {
        expect((result as any).status).toBe('DIRTY');
      });

      expect(httpClientMock.patch).toHaveBeenCalledWith(
        '/api/acp/acp1/item-explorer/draft',
        payload,
      );
    });

    it('should save explorer draft', () => {
      httpClientMock.post.mockReturnValue(of({ status: 'CLEAN', version: 6 }));

      service.saveItemExplorerDraft('acp1', 5).subscribe((result) => {
        expect((result as any).version).toBe(6);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/item-explorer/draft/save', {
        baseVersion: 5,
      });
    });

    it('should discard explorer draft', () => {
      httpClientMock.post.mockReturnValue(of({ status: 'CLEAN', version: 6 }));

      service.discardItemExplorerDraft('acp1', 5).subscribe((result) => {
        expect((result as any).status).toBe('CLEAN');
      });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/item-explorer/draft/discard',
        { baseVersion: 5 },
      );
    });

    it('should fetch explorer change history', () => {
      httpClientMock.get.mockReturnValue(of([]));

      service.getItemExplorerChanges('acp1', 200).subscribe((result) => {
        expect(result).toEqual([]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/acp/acp1/item-explorer/changes?limit=200',
      );
    });
  });

  describe('Items', () => {
    it('should upload wide item parameters in draft mode', () => {
      httpClientMock.post.mockReturnValue(of({ updated: 1, failed: [], successes: [] }));

      const file = new File(['item;infit\nx;1'], 'parameters.csv', { type: 'text/csv' });
      service.uploadItemParameters('acp1', file, { draft: true, baseVersion: 7 }).subscribe();

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/items/upload-item-parameters?draft=true&baseVersion=7',
        expect.any(FormData),
      );
    });

    it('should confirm warning-gated item parameter imports explicitly', () => {
      httpClientMock.post.mockReturnValue(of({ updated: 1, failed: [], successes: [] }));

      const file = new File(['item;est;booklet\nx;0.5;B1'], 'parameters.csv', {
        type: 'text/csv',
      });
      service
        .uploadItemParameters('acp1', file, {
          draft: true,
          baseVersion: 7,
          confirmWarnings: true,
        })
        .subscribe();

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/items/upload-item-parameters?draft=true&baseVersion=7&confirmWarnings=true',
        expect.any(FormData),
      );
    });

    it('should update and export personal item collections', () => {
      httpClientMock.patch.mockReturnValue(of({ activeCollectionId: 'c1', collections: [] }));
      httpClientMock.post.mockReturnValue(of(new Blob(['csv'])));

      service
        .updateItemCollection(
          'acp1',
          'c1',
          { baseVersion: 2, rowKeys: ['uuid-1'], shared: true },
          'editor',
        )
        .subscribe();
      service.copyItemCollection('acp1', 'shared-1', 'read-only').subscribe();
      service.exportItemCollectionCsv('acp1', 'c1', 'editor').subscribe();

      expect(httpClientMock.patch).toHaveBeenCalledWith('/api/view/acp/acp1/items/collections/c1', {
        baseVersion: 2,
        rowKeys: ['uuid-1'],
        shared: true,
        perspective: 'editor',
      });
      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/collections/shared-1/copy',
        { perspective: 'read-only' },
      );
      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/view/acp/acp1/items/collections/c1/export.csv?perspective=editor',
        {},
        { responseType: 'blob' },
      );
    });

    it('should upload empirical difficulties in draft mode with baseVersion', () => {
      httpClientMock.post.mockReturnValue(of({ updated: 0, failed: [], successes: [] }));

      const file = new File(['item;est\nx;1'], 'data.csv', { type: 'text/csv' });
      service
        .uploadEmpiricalDifficulties('acp1', file, { draft: true, baseVersion: 12 })
        .subscribe(() => {
          expect(true).toBe(true);
        });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/items/upload-empirical-difficulty?draft=true&baseVersion=12',
        expect.any(FormData),
      );
    });

    it('should clear empirical difficulties in draft mode with baseVersion', () => {
      httpClientMock.delete.mockReturnValue(of({ success: true }));

      service.clearEmpiricalDifficulties('acp1', { draft: true, baseVersion: 9 }).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith(
        '/api/acp/acp1/items/empirical-difficulty?draft=true&baseVersion=9',
      );
    });

    it('should save response state', () => {
      const responseData = { value: 'test' };
      httpClientMock.post.mockReturnValue(of({}));

      service.saveResponseState('acp1', 'item1', 'unit1', responseData).subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/items/item1/response-state', {
        unitId: 'unit1',
        responseData,
      });
    });

    it('should get response state', () => {
      httpClientMock.get.mockReturnValue(of({ state: {} }));

      service.getResponseState('acp1', 'item1', 'unit1').subscribe((result) => {
        expect(result).toEqual({ state: {} });
      });

      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/acp/acp1/items/item1/response-state?unitId=unit1',
      );
    });

    it('should delete response state', () => {
      httpClientMock.delete.mockReturnValue(of({}));

      service.deleteResponseState('acp1', 'item1', 'unit1').subscribe(() => {
        expect(true).toBe(true);
      });

      expect(httpClientMock.delete).toHaveBeenCalledWith(
        '/api/acp/acp1/items/item1/response-state?unitId=unit1',
      );
    });

    it('should get response state with fallback', () => {
      const itemList = [{ itemId: 'item1', unitId: 'unit1' }];
      httpClientMock.post.mockReturnValue(of({ state: {}, isFallback: false }));

      service
        .getResponseStateWithFallback('acp1', 'item1', 'unit1', itemList)
        .subscribe((result) => {
          expect(result.isFallback).toBe(false);
        });

      expect(httpClientMock.post).toHaveBeenCalledWith(
        '/api/acp/acp1/items/item1/response-state/with-fallback',
        { unitId: 'unit1', itemList },
      );
    });

    it('should get all response states', () => {
      httpClientMock.get.mockReturnValue(of([]));

      service.getAllResponseStates('acp1').subscribe((result) => {
        expect(result).toEqual([]);
      });

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/items/response-state/all');
    });

    it('should scope response state requests to a stable partial-credit row key', () => {
      httpClientMock.post.mockReturnValue(of({}));
      httpClientMock.get.mockReturnValue(of({}));
      httpClientMock.delete.mockReturnValue(of({}));

      service.saveResponseState('acp1', 'item1', 'unit1', { answer: 1 }, 'uuid-1::1').subscribe();
      expect(httpClientMock.post).toHaveBeenCalledWith('/api/acp/acp1/items/item1/response-state', {
        unitId: 'unit1',
        responseData: { answer: 1 },
        rowKey: 'uuid-1::1',
      });

      service.getResponseState('acp1', 'item1', 'unit1', 'uuid-1::1').subscribe();
      expect(httpClientMock.get).toHaveBeenCalledWith(
        '/api/acp/acp1/items/item1/response-state?unitId=unit1&rowKey=uuid-1%3A%3A1',
      );

      service.deleteResponseState('acp1', 'item1', 'unit1', 'uuid-1::1').subscribe();
      expect(httpClientMock.delete).toHaveBeenCalledWith(
        '/api/acp/acp1/items/item1/response-state?unitId=unit1&rowKey=uuid-1%3A%3A1',
      );
    });

    it('should get and save item tags', () => {
      httpClientMock.get.mockReturnValue(of({ item1: ['A'] }));
      httpClientMock.put.mockReturnValue(of({ item1: ['A', 'B'] }));

      service.getItemTags('acp1').subscribe((result) => {
        expect(result).toEqual({ item1: ['A'] });
      });
      expect(httpClientMock.get).toHaveBeenCalledWith('/api/acp/acp1/items/tags');

      service.saveItemTags('acp1', { item1: ['A', 'B'] }).subscribe((result) => {
        expect(result).toEqual({ item1: ['A', 'B'] });
      });
      expect(httpClientMock.put).toHaveBeenCalledWith('/api/acp/acp1/items/tags', {
        tags: { item1: ['A', 'B'] },
      });
    });
  });

  describe('Helper methods', () => {
    it('should append auth token to URL', () => {
      localStorage.setItem('cp_token', 'test-token');
      expect(service.appendAuthToken('http://example.com/api')).toBe(
        'http://example.com/api?auth_token=test-token',
      );
      expect(service.appendAuthToken('http://example.com/api?foo=bar')).toBe(
        'http://example.com/api?foo=bar&auth_token=test-token',
      );
    });

    it('should return original URL when no token', () => {
      localStorage.removeItem('cp_token');
      expect(service.appendAuthToken('http://example.com/api')).toBe('http://example.com/api');
    });
  });
});
