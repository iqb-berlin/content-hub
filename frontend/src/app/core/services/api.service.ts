import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpResponse } from '@angular/common/http';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  Acp,
  CreateAcpRequest,
  UpdateAcpRequest,
  AcpRoleAssignment,
  AssignAcpRoleRequest,
  AssignableAcpUser,
  UpdateAccessConfigRequest,
  UpdateMetadataColumnsRequest,
  CredentialEntry,
  CredentialUploadMode,
  CredentialUploadResponse,
  CredentialDeletionResponse,
  AccessConfig,
  AcpSnapshot,
  SnapshotCurrentDiff,
  AcpFile,
  Comment,
  CommentThreadSnapshot,
  ItemCommentCountsSnapshot,
  ReviewCommentTarget,
  ReviewReadiness,
  AppSettings,
  ApplicationToken,
  ApplicationTokenListResponse,
  CreatedApplicationToken,
  CreateApplicationTokenRequest,
  User,
  CreateUserRequest,
  UpdateUserRequest,
  PublicAcp,
  UnitViewData,
  TaskSequence,
  Credential,
  FileUploadResponse,
  FileUploadConflictStrategy,
  FileProcessingJob,
  IndexSyncReport,
  ItemViewPreferences,
  ItemExplorerStateEnvelope,
  ItemExplorerChangeLogEntry,
  ItemExplorerSharedState,
  ValidateUnitsResponse,
  FilePreviewResponse,
  FileDeletionResponse,
  ItemCollectionsPayload,
  ItemCollectionRowsMutation,
  ItemCollectionRowsMutationResult,
  ItemExplorerPerspective,
  SimpleItemListEntry,
  AcpIndexValidationReport,
  AcpIndexMigrationPreview,
  AcpIndexGenerationPreview,
  BuildVersion,
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly API = '/api';

  constructor(private http: HttpClient) {}

  getBackendVersion(): Observable<BuildVersion> {
    return this.http.get<BuildVersion>(`${this.API}/version`);
  }

  getFrontendVersion(): Observable<BuildVersion> {
    return this.http.get<BuildVersion>('/version.json');
  }

  // Users
  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.API}/users`);
  }
  createUser(data: CreateUserRequest): Observable<User> {
    return this.http.post<User>(`${this.API}/users`, data);
  }
  updateUser(id: string, data: UpdateUserRequest): Observable<User> {
    return this.http.patch<User>(`${this.API}/users/${id}`, data);
  }
  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API}/users/${id}`);
  }
  setAppAdmin(id: string, isAppAdmin: boolean): Observable<User> {
    return this.http.patch<User>(`${this.API}/users/${id}/app-admin`, { isAppAdmin });
  }
  linkOidcAccount(userId: string, oidcSub: string): Observable<any> {
    return this.http.post(`${this.API}/auth/link-oidc`, { userId, oidcSub });
  }

  // Settings
  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.API}/admin/settings`);
  }
  updateSettings(data: Partial<AppSettings>): Observable<AppSettings> {
    return this.http.put<AppSettings>(`${this.API}/admin/settings`, data);
  }
  uploadGeoGebraBundle(formData: FormData): Observable<AppSettings> {
    return this.http.post<AppSettings>(`${this.API}/admin/settings/geogebra-bundle`, formData);
  }
  deleteGeoGebraBundle(): Observable<AppSettings> {
    return this.http.delete<AppSettings>(`${this.API}/admin/settings/geogebra-bundle`);
  }

  // Application tokens
  getApplicationTokens(
    options: { limit?: number; offset?: number; allowedAcpId?: string } = {},
  ): Observable<ApplicationTokenListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options.allowedAcpId) {
      params.set('allowedAcpId', options.allowedAcpId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApplicationTokenListResponse>(
      `${this.API}/admin/application-tokens${suffix}`,
    );
  }

  createApplicationToken(data: CreateApplicationTokenRequest): Observable<CreatedApplicationToken> {
    return this.http.post<CreatedApplicationToken>(`${this.API}/admin/application-tokens`, data);
  }

  revokeApplicationToken(id: string): Observable<ApplicationToken> {
    return this.http.patch<ApplicationToken>(
      `${this.API}/admin/application-tokens/${id}/revoke`,
      {},
    );
  }

  getAcpApplicationTokens(
    acpId: string,
    options: { limit?: number; offset?: number } = {},
  ): Observable<ApplicationTokenListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApplicationTokenListResponse>(
      `${this.API}/acp/${acpId}/application-tokens${suffix}`,
    );
  }

  createAcpApplicationToken(
    acpId: string,
    data: CreateApplicationTokenRequest,
  ): Observable<CreatedApplicationToken> {
    return this.http.post<CreatedApplicationToken>(
      `${this.API}/acp/${acpId}/application-tokens`,
      data,
    );
  }

  revokeAcpApplicationToken(acpId: string, tokenId: string): Observable<ApplicationToken> {
    return this.http.patch<ApplicationToken>(
      `${this.API}/acp/${acpId}/application-tokens/${tokenId}/revoke`,
      {},
    );
  }

  // ACP
  getAcps(): Observable<Acp[]> {
    return this.http.get<Acp[]>(`${this.API}/acp`);
  }
  getAcp(id: string): Observable<Acp> {
    return this.http.get<Acp>(`${this.API}/acp/${id}`);
  }
  createAcp(data: CreateAcpRequest): Observable<Acp> {
    return this.http.post<Acp>(`${this.API}/acp`, data);
  }
  updateAcp(id: string, data: UpdateAcpRequest): Observable<Acp> {
    return this.http.patch<Acp>(`${this.API}/acp/${id}`, data);
  }
  deleteAcp(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API}/acp/${id}`);
  }

  // ACP Index
  getAcpIndex(id: string): Observable<any> {
    return this.http.get(`${this.API}/acp/${id}/index`);
  }
  updateAcpIndex(id: string, data: any, expectedUpdatedAt: string): Observable<any> {
    return this.http.put(
      `${this.API}/acp/${id}/index?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
      data,
    );
  }
  importAcpIndex(id: string, data: any, expectedUpdatedAt: string): Observable<any> {
    return this.http.post(
      `${this.API}/acp/${id}/index/import?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
      data,
    );
  }
  deleteAcpIndex(id: string, expectedUpdatedAt: string): Observable<any> {
    return this.http.delete(
      `${this.API}/acp/${id}/index?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    );
  }
  validateAcpIndex(id: string): Observable<AcpIndexValidationReport> {
    return this.http.post<AcpIndexValidationReport>(`${this.API}/acp/${id}/index/validate`, {});
  }
  previewAcpIndexMigration(id: string): Observable<AcpIndexMigrationPreview> {
    return this.http.post<AcpIndexMigrationPreview>(
      `${this.API}/acp/${id}/index/migration-preview`,
      {},
    );
  }
  migrateAcpIndex(id: string, expectedUpdatedAt: string): Observable<Acp> {
    return this.http.post<Acp>(`${this.API}/acp/${id}/index/migrate`, { expectedUpdatedAt });
  }
  publishAcpIndex(
    id: string,
    status: 'RELEASED_PUBLIC' | 'RELEASED_CONFIDENTIAL',
    expectedUpdatedAt: string,
  ): Observable<Acp> {
    return this.http.post<Acp>(`${this.API}/acp/${id}/index/publish`, {
      status,
      expectedUpdatedAt,
    });
  }
  reopenAcpIndex(id: string, expectedUpdatedAt: string): Observable<Acp> {
    return this.http.post<Acp>(`${this.API}/acp/${id}/index/reopen`, { expectedUpdatedAt });
  }
  previewIndexGeneration(
    acpId: string,
    options: { partAssignments?: Record<string, string>; omittedUnitPaths?: string[] } = {},
  ): Observable<AcpIndexGenerationPreview> {
    return this.http.post<AcpIndexGenerationPreview>(
      `${this.API}/files/${acpId}/index-generation/preview`,
      options,
    );
  }
  applyIndexGeneration(
    acpId: string,
    input: {
      sourceRevision: string;
      expectedUpdatedAt: string;
      partAssignments?: Record<string, string>;
      omittedUnitPaths?: string[];
    },
  ): Observable<{ index: Record<string, any>; validation: AcpIndexValidationReport }> {
    return this.http.post<{ index: Record<string, any>; validation: AcpIndexValidationReport }>(
      `${this.API}/files/${acpId}/index-generation/apply`,
      input,
    );
  }

  // ACP Roles
  getAcpRoles(id: string): Observable<AcpRoleAssignment[]> {
    return this.http.get<AcpRoleAssignment[]>(`${this.API}/acp/${id}/roles`);
  }
  assignAcpRole(id: string, data: AssignAcpRoleRequest): Observable<AcpRoleAssignment> {
    return this.http.post<AcpRoleAssignment>(`${this.API}/acp/${id}/roles`, data);
  }
  removeAcpRole(acpId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.API}/acp/${acpId}/roles/${userId}`);
  }
  getAssignableUsers(acpId: string): Observable<AssignableAcpUser[]> {
    return this.http.get<AssignableAcpUser[]>(`${this.API}/acp/${acpId}/assignable-users`);
  }

  updateRoleCapabilities(
    acpId: string,
    userId: string,
    capabilities: string[],
  ): Observable<AcpRoleAssignment> {
    return this.http.patch<AcpRoleAssignment>(
      `${this.API}/acp/${acpId}/roles/${userId}/capabilities`,
      {
        capabilities,
      },
    );
  }
  getCapabilities(acpId: string): Observable<any> {
    return this.http.get(`${this.API}/view/acp/${acpId}/capabilities`);
  }
  getReview(acpId: string): Observable<any> {
    return this.http.get(`${this.API}/view/acp/${acpId}/review`);
  }
  getReviewConfig(acpId: string): Observable<any> {
    return this.http.get(`${this.API}/view/acp/${acpId}/review/config`);
  }
  getReviewMembers(acpId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/view/acp/${acpId}/review/members`);
  }
  getVisibleReviewComments(acpId: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API}/acp/${acpId}/review/comments/visible`);
  }
  exportVisibleReviewComments(
    acpId: string,
    filters: Record<string, string> = {},
  ): Observable<Blob> {
    return this.http.get(`${this.API}/acp/${acpId}/review/comments/export/visible.xlsx`, {
      responseType: 'blob',
      params: filters,
    });
  }
  configureReview(acpId: string, config: any): Observable<any> {
    return this.http.put(`${this.API}/view/acp/${acpId}/review/config`, config);
  }
  getReviewReadiness(acpId: string): Observable<ReviewReadiness | null> {
    return this.http.get<ReviewReadiness | null>(`${this.API}/view/acp/${acpId}/review/readiness`);
  }
  checkReviewReadiness(acpId: string): Observable<ReviewReadiness> {
    return this.http.post<ReviewReadiness>(`${this.API}/view/acp/${acpId}/review/readiness`, {});
  }
  importCredentialFile(
    acpId: string,
    file: File,
    mode: string,
    profile: string,
    capabilities: string[],
    preview = false,
  ): Observable<any> {
    const body = new FormData();
    body.append('file', file);
    body.append('profile', profile);
    body.append('capabilities', JSON.stringify(capabilities));
    return this.http.post(
      `${this.API}/acp/${acpId}/access/credentials/file?mode=${mode}&preview=${preview}`,
      body,
    );
  }

  // ACP Access
  getAccessConfig(id: string): Observable<AccessConfig> {
    return this.http.get<AccessConfig>(`${this.API}/acp/${id}/access`);
  }
  updateAccessConfig(id: string, data: UpdateAccessConfigRequest): Observable<AccessConfig> {
    return this.http.put<AccessConfig>(`${this.API}/acp/${id}/access`, data);
  }
  uploadCredentials(
    id: string,
    credentials: CredentialEntry[],
    mode: CredentialUploadMode = 'replace',
  ): Observable<CredentialUploadResponse> {
    return this.http.post<CredentialUploadResponse>(
      `${this.API}/acp/${id}/access/credentials?mode=${mode}`,
      { credentials },
    );
  }
  getCredentials(id: string): Observable<Credential[]> {
    return this.http.get<Credential[]>(`${this.API}/acp/${id}/access/credentials`);
  }
  createCredential(
    acpId: string,
    username: string,
    password: string,
    capabilities: string[] = [],
  ): Observable<Credential> {
    return this.http.post<Credential>(`${this.API}/acp/${acpId}/access/credentials/single`, {
      username,
      password,
      capabilities,
    });
  }
  updateCredential(
    acpId: string,
    credentialId: string,
    data: { username?: string; password?: string; capabilities?: string[] },
  ): Observable<Credential> {
    return this.http.patch<Credential>(
      `${this.API}/acp/${acpId}/access/credentials/${credentialId}`,
      data,
    );
  }
  deleteCredential(acpId: string, credentialId: string): Observable<CredentialDeletionResponse> {
    return this.http.delete<CredentialDeletionResponse>(
      `${this.API}/acp/${acpId}/access/credentials/${credentialId}`,
    );
  }
  updateMetadataColumns(id: string, data: UpdateMetadataColumnsRequest): Observable<AccessConfig> {
    return this.http.put<AccessConfig>(`${this.API}/acp/${id}/metadata-columns`, data);
  }

  // Files
  getFiles(acpId: string): Observable<AcpFile[]> {
    return this.http.get<AcpFile[]>(`${this.API}/acp/${acpId}/files`);
  }
  uploadFiles(
    acpId: string,
    formData: FormData,
    options?: { conflictStrategy?: FileUploadConflictStrategy },
  ): Observable<HttpEvent<FileUploadResponse>> {
    const query: string[] = [];
    if (options?.conflictStrategy) {
      query.push(`conflictStrategy=${encodeURIComponent(options.conflictStrategy)}`);
    }
    const suffix = query.length ? `?${query.join('&')}` : '';
    return this.http.post<FileUploadResponse>(
      `${this.API}/acp/${acpId}/files/upload${suffix}`,
      formData,
      {
        observe: 'events',
        reportProgress: true,
      },
    );
  }
  startFileProcessing(
    acpId: string,
    data: { fileIds: string[]; runCleanup: boolean },
  ): Observable<FileProcessingJob> {
    return this.http.post<FileProcessingJob>(`${this.API}/acp/${acpId}/files/process-upload`, data);
  }
  getFileProcessingJob(acpId: string, jobId: string): Observable<FileProcessingJob> {
    return this.http.get<FileProcessingJob>(`${this.API}/acp/${acpId}/files/jobs/${jobId}`);
  }
  getFileProcessingJobEventsUrl(acpId: string, jobId: string): string {
    return this.appendAuthToken(`${this.API}/acp/${acpId}/files/jobs/${jobId}/events`);
  }
  syncIndexFromFiles(acpId: string): Observable<IndexSyncReport> {
    return this.http.post<IndexSyncReport>(`${this.API}/acp/${acpId}/files/sync-index`, {});
  }
  deleteFile(acpId: string, fileId: string): Observable<FileDeletionResponse> {
    return this.http.delete<FileDeletionResponse>(`${this.API}/acp/${acpId}/files/${fileId}`);
  }
  deleteAllFiles(acpId: string): Observable<FileDeletionResponse> {
    return this.http.delete<FileDeletionResponse>(`${this.API}/acp/${acpId}/files/all`);
  }
  bulkDeleteFiles(acpId: string, fileIds: string[]): Observable<FileDeletionResponse> {
    return this.http.post<FileDeletionResponse>(`${this.API}/acp/${acpId}/files/bulk-delete`, {
      fileIds,
    });
  }
  startFileDownloadJob(acpId: string, data: { fileIds: string[] }): Observable<FileProcessingJob> {
    return this.http.post<FileProcessingJob>(
      `${this.API}/acp/${acpId}/files/bulk-download/jobs`,
      data,
    );
  }
  downloadFilesArchive(acpId: string, fileIds: string[] = []): Observable<HttpResponse<Blob>> {
    return this.http.post(
      `${this.API}/acp/${acpId}/files/bulk-download`,
      { fileIds },
      {
        observe: 'response',
        responseType: 'blob',
      },
    );
  }
  downloadFileJobArchive(acpId: string, jobId: string): Observable<HttpEvent<Blob>> {
    return this.http.get(`${this.API}/acp/${acpId}/files/jobs/${jobId}/archive`, {
      observe: 'events',
      reportProgress: true,
      responseType: 'blob',
    });
  }
  getFileJobArchiveUrl(acpId: string, jobId: string): string {
    return this.appendAuthToken(`${this.API}/acp/${acpId}/files/jobs/${jobId}/archive`);
  }
  getFileValidation(acpId: string, fileId: string): Observable<any> {
    return this.http.get(`${this.API}/acp/${acpId}/files/${fileId}/validation`);
  }
  getFileDownloadUrl(acpId: string, fileId: string): string {
    return this.getFileContentUrl(acpId, fileId);
  }
  getFileContentUrl(
    acpId: string,
    fileId: string,
    options?: { disposition?: 'attachment' | 'inline' },
  ): string {
    const token = localStorage.getItem('cp_token');
    const query: string[] = [];
    if (token) {
      query.push(`auth_token=${encodeURIComponent(token)}`);
    }
    if (options?.disposition) {
      query.push(`disposition=${encodeURIComponent(options.disposition)}`);
    }
    const suffix = query.length ? `?${query.join('&')}` : '';
    return `${this.API}/acp/${acpId}/files/${fileId}/download${suffix}`;
  }
  getFilePreview(acpId: string, fileId: string): Observable<FilePreviewResponse> {
    return this.http.get<FilePreviewResponse>(`${this.API}/acp/${acpId}/files/${fileId}/preview`);
  }
  validateUnitFiles(acpId: string): Observable<ValidateUnitsResponse> {
    return this.http.get<ValidateUnitsResponse>(`${this.API}/acp/${acpId}/files/validate-units`);
  }
  getFileItemList(
    acpId: string,
    options?: { perspective?: ItemExplorerPerspective },
  ): Observable<any> {
    const query = this.buildPerspectiveQuery(options?.perspective);
    return this.http.get(`${this.API}/acp/${acpId}/files/item-list${query}`);
  }
  recalculateItemRowNumbers(acpId: string): Observable<{ renumberedCount: number }> {
    return this.http.post<{ renumberedCount: number }>(
      `${this.API}/acp/${acpId}/files/item-list/renumber`,
      {},
    );
  }
  getFileUnitView(
    acpId: string,
    unitId: string,
    options?: { perspective?: ItemExplorerPerspective; partId?: string },
  ): Observable<any> {
    const query = this.buildPerspectiveQuery(options?.perspective);
    const route = options?.partId
      ? `${this.API}/acp/${acpId}/files/unit-view/${encodeURIComponent(options.partId)}/${encodeURIComponent(unitId)}`
      : `${this.API}/acp/${acpId}/files/unit-view/${encodeURIComponent(unitId)}`;
    return this.http.get(`${route}${query}`);
  }

  getIndexExportUrl(id: string): string {
    const token = localStorage.getItem('cp_token');
    return `${this.API}/acp/${id}/index/export${token ? '?auth_token=' + encodeURIComponent(token) : ''}`;
  }

  appendAuthToken(url: string): string {
    const token = localStorage.getItem('cp_token');
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}auth_token=${encodeURIComponent(token)}`;
  }

  private buildPerspectiveQuery(perspective?: ItemExplorerPerspective): string {
    if (!perspective || perspective === 'editor') {
      return '';
    }

    return `?perspective=${encodeURIComponent(perspective)}`;
  }

  // Snapshots
  getSnapshots(acpId: string): Observable<AcpSnapshot[]> {
    return this.http.get<AcpSnapshot[]>(`${this.API}/acp/${acpId}/snapshots`);
  }
  createSnapshot(acpId: string, changelog?: string): Observable<AcpSnapshot> {
    return this.http.post<AcpSnapshot>(`${this.API}/acp/${acpId}/snapshots`, { changelog });
  }
  restoreSnapshot(acpId: string, snapshotId: string): Observable<Acp> {
    return this.http.post<Acp>(`${this.API}/acp/${acpId}/snapshots/${snapshotId}/restore`, {});
  }
  deleteSnapshot(acpId: string, snapshotId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.API}/acp/${acpId}/snapshots/${snapshotId}`,
    );
  }
  getSnapshotDiff(acpId: string, snapshotId: string): Observable<any> {
    return this.http.get(`${this.API}/acp/${acpId}/snapshots/${snapshotId}/diff`);
  }
  getSnapshotCurrentDiff(acpId: string, snapshotId: string): Observable<SnapshotCurrentDiff> {
    return this.http.get<SnapshotCurrentDiff>(
      `${this.API}/acp/${acpId}/snapshots/${snapshotId}/diff/current`,
    );
  }

  // Comments
  getComments(acpId: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API}/acp/${acpId}/comments`);
  }
  getMyComments(acpId: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API}/acp/${acpId}/comments/mine`);
  }
  createComment(acpId: string, data: any): Observable<Comment> {
    return this.http.post<Comment>(`${this.API}/acp/${acpId}/comments`, data);
  }
  getItemCommentThread(
    acpId: string,
    unitId: string,
    itemId: string,
    previous?: CommentThreadSnapshot | null,
  ): Observable<CommentThreadSnapshot> {
    return this.http
      .get<CommentThreadSnapshot>(`${this.API}/acp/${acpId}/review/comments`, {
        params: { unitId, itemId },
        ...(previous ? { headers: { 'If-None-Match': `"${previous.revision}"` } } : {}),
      })
      .pipe(
        catchError((error) =>
          error.status === 304 && previous ? of(previous) : throwError(() => error),
        ),
      );
  }
  getReviewCommentThread(
    acpId: string,
    target: ReviewCommentTarget,
    previous?: CommentThreadSnapshot | null,
  ): Observable<CommentThreadSnapshot> {
    return this.http
      .get<CommentThreadSnapshot>(`${this.API}/acp/${acpId}/review/comments`, {
        params: { ...target },
        ...(previous ? { headers: { 'If-None-Match': `"${previous.revision}"` } } : {}),
      })
      .pipe(
        catchError((error) =>
          error.status === 304 && previous ? of(previous) : throwError(() => error),
        ),
      );
  }
  getItemCommentCounts(acpId: string): Observable<ItemCommentCountsSnapshot> {
    return this.http.get<ItemCommentCountsSnapshot>(
      `${this.API}/acp/${acpId}/review/comments/counts`,
    );
  }
  createItemComment(
    acpId: string,
    data: {
      unitId: string;
      itemId: string;
      commentText: string;
      parentCommentId?: string;
      groupId?: string;
      categoryId?: string | null;
    },
  ): Observable<Comment> {
    return this.http.post<Comment>(`${this.API}/acp/${acpId}/review/comments`, data);
  }
  createReviewComment(
    acpId: string,
    data: ReviewCommentTarget & {
      commentText: string;
      parentCommentId?: string;
      groupId?: string;
      categoryId?: string | null;
    },
  ): Observable<Comment> {
    return this.http.post<Comment>(`${this.API}/acp/${acpId}/review/comments`, data);
  }
  updateItemComment(
    acpId: string,
    commentId: string,
    data: { commentText: string; version: number; categoryId?: string | null },
  ): Observable<Comment> {
    return this.http.patch<Comment>(`${this.API}/acp/${acpId}/review/comments/${commentId}`, data);
  }
  deleteItemComment(
    acpId: string,
    commentId: string,
    version: number,
  ): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.API}/acp/${acpId}/review/comments/${commentId}`,
      {
        params: { version },
      },
    );
  }
  exportComments(acpId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/acp/${acpId}/comments/export`);
  }
  exportCommentsXlsx(acpId: string): Observable<Blob> {
    return this.http.get(`${this.API}/acp/${acpId}/comments/export.xlsx`, { responseType: 'blob' });
  }
  setCommentVote(
    acpId: string,
    commentId: string,
    value: 'UP' | 'DOWN' | null,
  ): Observable<unknown> {
    const url = `${this.API}/acp/${acpId}/review/comments/${commentId}/vote`;
    return value === null ? this.http.delete(url) : this.http.put(url, { value });
  }

  exportMyReviewCommentsCsv(acpId: string, filters: Record<string, string> = {}): Observable<Blob> {
    return this.http.get(`${this.API}/acp/${acpId}/review/comments/export/mine.csv`, {
      responseType: 'blob',
      params: filters,
    });
  }
  exportMyReviewCommentsXlsx(
    acpId: string,
    filters: Record<string, string> = {},
  ): Observable<Blob> {
    return this.http.get(`${this.API}/acp/${acpId}/review/comments/export/mine.xlsx`, {
      responseType: 'blob',
      params: filters,
    });
  }
  exportAllReviewCommentsXlsx(acpId: string): Observable<Blob> {
    return this.http.get(`${this.API}/acp/${acpId}/review/comments/export/all.xlsx`, {
      responseType: 'blob',
    });
  }

  // Public Views
  getPublicSettings(): Observable<any> {
    return this.http.get(`${this.API}/view/settings`);
  }
  getPublicAcps(): Observable<PublicAcp[]> {
    return this.http.get<PublicAcp[]>(`${this.API}/view/acp`);
  }
  getAcpStartPage(acpId: string): Observable<any> {
    return this.http.get(`${this.API}/view/acp/${acpId}`);
  }
  getViewUnits(acpId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/view/acp/${acpId}/units`);
  }
  getViewUnit(acpId: string, unitId: string, partId?: string): Observable<UnitViewData> {
    const url = partId
      ? `${this.API}/view/acp/${acpId}/parts/${encodeURIComponent(partId)}/units/${encodeURIComponent(unitId)}`
      : `${this.API}/view/acp/${acpId}/units/${encodeURIComponent(unitId)}`;
    return this.http.get<UnitViewData>(url);
  }
  getViewItems(acpId: string): Observable<SimpleItemListEntry[]> {
    return this.http.get<SimpleItemListEntry[]>(`${this.API}/view/acp/${acpId}/items`);
  }
  getViewItemPreferences(acpId: string, viewId = 'item-list'): Observable<ItemViewPreferences> {
    return this.http.get<ItemViewPreferences>(
      `${this.API}/view/acp/${acpId}/items/preferences?viewId=${encodeURIComponent(viewId)}`,
    );
  }
  saveViewItemPreferences(
    acpId: string,
    data: ItemViewPreferences,
    viewId = 'item-list',
  ): Observable<ItemViewPreferences> {
    return this.http.put<ItemViewPreferences>(`${this.API}/view/acp/${acpId}/items/preferences`, {
      viewId,
      ...data,
    });
  }
  patchViewItemPreferenceRow(
    acpId: string,
    rowKey: string,
    rowData: Record<string, unknown> | null,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemViewPreferences> {
    return this.http.patch<ItemViewPreferences>(
      `${this.API}/view/acp/${acpId}/items/preferences/row-data`,
      { rowKey, rowData, perspective },
    );
  }
  exportViewPersonalItemDataXlsx(
    acpId: string,
    rowKeys: string[],
    perspective: ItemExplorerPerspective,
  ): Observable<Blob> {
    return this.http.post(
      `${this.API}/view/acp/${acpId}/items/preferences/export.xlsx`,
      { rowKeys, perspective },
      { responseType: 'blob' },
    );
  }
  exportAllViewPersonalItemDataCsv(
    acpId: string,
    perspective: ItemExplorerPerspective,
    collectionId?: string,
  ): Observable<Blob> {
    return this.http.post(
      `${this.API}/view/acp/${acpId}/items/preferences/export-all.csv`,
      { perspective, ...(collectionId === undefined ? {} : { collectionId }) },
      { responseType: 'blob' },
    );
  }
  getViewSequences(acpId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/view/acp/${acpId}/sequences`);
  }
  getViewSequence(acpId: string, seqId: string, kind?: 'booklet'): Observable<TaskSequence> {
    return this.http.get<TaskSequence>(
      `${this.API}/view/acp/${acpId}/sequences/${encodeURIComponent(seqId)}${kind === 'booklet' ? '?kind=booklet' : ''}`,
    );
  }
  getViewIndex(acpId: string): Observable<any> {
    return this.http.get(`${this.API}/view/acp/${acpId}/index`);
  }
  getViewIndexExportUrl(acpId: string): string {
    const token = localStorage.getItem('cp_token');
    return `${this.API}/view/acp/${acpId}/index/export${token ? '?auth_token=' + encodeURIComponent(token) : ''}`;
  }

  getItemExplorerState(
    acpId: string,
    perspective?: ItemExplorerPerspective,
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.get<ItemExplorerStateEnvelope>(
      `${this.API}/view/acp/${acpId}/item-explorer/state`,
      { params: perspective ? { perspective } : {} },
    );
  }

  patchItemExplorerDraft(
    acpId: string,
    data: {
      changeType: string;
      patch: ItemExplorerSharedState | Record<string, unknown>;
      baseVersion?: number;
    },
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.patch<ItemExplorerStateEnvelope>(
      `${this.API}/acp/${acpId}/item-explorer/draft`,
      data,
    );
  }

  saveItemExplorerDraft(
    acpId: string,
    baseVersion?: number,
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.post<ItemExplorerStateEnvelope>(
      `${this.API}/acp/${acpId}/item-explorer/draft/save`,
      {
        baseVersion,
      },
    );
  }

  discardItemExplorerDraft(
    acpId: string,
    baseVersion?: number,
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.post<ItemExplorerStateEnvelope>(
      `${this.API}/acp/${acpId}/item-explorer/draft/discard`,
      {
        baseVersion,
      },
    );
  }

  getItemExplorerChanges(acpId: string, limit = 100): Observable<ItemExplorerChangeLogEntry[]> {
    return this.http.get<ItemExplorerChangeLogEntry[]>(
      `${this.API}/acp/${acpId}/item-explorer/changes?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  // Items
  uploadItemParameters(
    acpId: string,
    file: File,
    options?: { draft?: boolean; baseVersion?: number; confirmWarnings?: boolean },
  ): Observable<{
    updated: number;
    failed: Array<{ csvRow: string; reason: string }>;
    successes: any[];
    warnings?: Array<{ code: 'BOOKLET_OCCURRENCES_SKIPPED'; message: string }>;
    requiresConfirmation?: boolean;
    showOnlyItemsWithEmpiricalDifficulty?: boolean;
    explorerState?: ItemExplorerStateEnvelope;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const query: string[] = [];
    if (options?.draft) query.push('draft=true');
    if (typeof options?.baseVersion === 'number') {
      query.push(`baseVersion=${encodeURIComponent(String(options.baseVersion))}`);
    }
    if (options?.confirmWarnings) query.push('confirmWarnings=true');
    const queryString = query.length ? `?${query.join('&')}` : '';
    return this.http.post<{
      updated: number;
      failed: Array<{ csvRow: string; reason: string }>;
      successes: any[];
      warnings?: Array<{ code: 'BOOKLET_OCCURRENCES_SKIPPED'; message: string }>;
      requiresConfirmation?: boolean;
      showOnlyItemsWithEmpiricalDifficulty?: boolean;
      explorerState?: ItemExplorerStateEnvelope;
    }>(`${this.API}/acp/${acpId}/items/upload-item-parameters${queryString}`, formData);
  }

  uploadEmpiricalDifficulties(
    acpId: string,
    file: File,
    options?: { draft?: boolean; baseVersion?: number },
  ): Observable<{
    updated: number;
    failed: any[];
    successes: any[];
    showOnlyItemsWithEmpiricalDifficulty?: boolean;
    explorerState?: ItemExplorerStateEnvelope;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const query: string[] = [];
    if (options?.draft) {
      query.push('draft=true');
    }
    if (typeof options?.baseVersion === 'number') {
      query.push(`baseVersion=${encodeURIComponent(String(options.baseVersion))}`);
    }
    const queryString = query.length ? `?${query.join('&')}` : '';
    return this.http.post<{
      updated: number;
      failed: any[];
      successes: any[];
      explorerState?: ItemExplorerStateEnvelope;
    }>(`${this.API}/acp/${acpId}/items/upload-empirical-difficulty${queryString}`, formData);
  }

  getItemCollections(
    acpId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.get<ItemCollectionsPayload>(
      `${this.API}/view/acp/${acpId}/items/collections?perspective=${encodeURIComponent(perspective)}`,
    );
  }

  createItemCollection(
    acpId: string,
    name: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.post<ItemCollectionsPayload>(
      `${this.API}/view/acp/${acpId}/items/collections`,
      { name, perspective },
    );
  }

  updateItemCollection(
    acpId: string,
    collectionId: string,
    update: { baseVersion: number; name?: string; rowKeys?: string[]; shared?: boolean },
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.patch<ItemCollectionsPayload>(
      `${this.API}/view/acp/${acpId}/items/collections/${encodeURIComponent(collectionId)}`,
      { ...update, perspective },
    );
  }

  copyItemCollection(
    acpId: string,
    collectionId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.post<ItemCollectionsPayload>(
      `${this.API}/view/acp/${acpId}/items/collections/${encodeURIComponent(collectionId)}/copy`,
      { perspective },
    );
  }

  mutateItemCollectionRows(
    acpId: string,
    collectionId: string,
    mutation: ItemCollectionRowsMutation,
  ): Observable<ItemCollectionRowsMutationResult> {
    return this.http.patch<ItemCollectionRowsMutationResult>(
      `${this.API}/view/acp/${acpId}/items/collections/${encodeURIComponent(collectionId)}/rows`,
      mutation,
    );
  }

  activateItemCollection(
    acpId: string,
    collectionId: string | null,
    perspective: ItemExplorerPerspective,
    collectionViewMode?: 'all' | 'active',
  ): Observable<ItemCollectionsPayload> {
    return this.http.put<ItemCollectionsPayload>(
      `${this.API}/view/acp/${acpId}/items/collections/active`,
      { collectionId, perspective, collectionViewMode },
    );
  }

  deleteItemCollection(
    acpId: string,
    collectionId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.delete<ItemCollectionsPayload>(
      `${this.API}/view/acp/${acpId}/items/collections/${encodeURIComponent(collectionId)}?perspective=${encodeURIComponent(perspective)}`,
    );
  }

  exportItemCollectionCsv(
    acpId: string,
    collectionId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<Blob> {
    return this.http.post(
      `${this.API}/view/acp/${acpId}/items/collections/${encodeURIComponent(collectionId)}/export.csv?perspective=${encodeURIComponent(perspective)}`,
      {},
      { responseType: 'blob' },
    );
  }

  clearEmpiricalDifficulties(
    acpId: string,
    options?: { draft?: boolean; baseVersion?: number },
  ): Observable<{ success: boolean; explorerState?: ItemExplorerStateEnvelope }> {
    const query: string[] = [];
    if (options?.draft) {
      query.push('draft=true');
    }
    if (typeof options?.baseVersion === 'number') {
      query.push(`baseVersion=${encodeURIComponent(String(options.baseVersion))}`);
    }
    const queryString = query.length ? `?${query.join('&')}` : '';
    return this.http.delete<{ success: boolean; explorerState?: ItemExplorerStateEnvelope }>(
      `${this.API}/acp/${acpId}/items/empirical-difficulty${queryString}`,
    );
  }

  getItemTags(acpId: string): Observable<Record<string, string[]>> {
    return this.http.get<Record<string, string[]>>(`${this.API}/acp/${acpId}/items/tags`);
  }

  saveItemTags(
    acpId: string,
    tags: Record<string, string[]>,
  ): Observable<Record<string, string[]>> {
    return this.http.put<Record<string, string[]>>(`${this.API}/acp/${acpId}/items/tags`, { tags });
  }

  // Response State
  saveResponseState(
    acpId: string,
    itemId: string,
    unitId: string,
    responseData: Record<string, any>,
    rowKey?: string,
  ): Observable<any> {
    return this.http.post(`${this.API}/acp/${acpId}/items/${itemId}/response-state`, {
      unitId,
      responseData,
      ...(rowKey ? { rowKey } : {}),
    });
  }

  getResponseState(
    acpId: string,
    itemId: string,
    unitId: string,
    rowKey?: string,
  ): Observable<any> {
    const rowKeyQuery = rowKey ? `&rowKey=${encodeURIComponent(rowKey)}` : '';
    return this.http.get(
      `${this.API}/acp/${acpId}/items/${itemId}/response-state?unitId=${encodeURIComponent(unitId)}${rowKeyQuery}`,
    );
  }

  deleteResponseState(
    acpId: string,
    itemId: string,
    unitId: string,
    rowKey?: string,
  ): Observable<any> {
    const rowKeyQuery = rowKey ? `&rowKey=${encodeURIComponent(rowKey)}` : '';
    return this.http.delete(
      `${this.API}/acp/${acpId}/items/${itemId}/response-state?unitId=${encodeURIComponent(unitId)}${rowKeyQuery}`,
    );
  }

  getResponseStateWithFallback(
    acpId: string,
    itemId: string,
    unitId: string,
    itemList: { itemId: string; unitId: string; rowKey?: string }[],
    rowKey?: string,
  ): Observable<{ state: any; isFallback: boolean; fallbackItemId?: string }> {
    return this.http.post<{ state: any; isFallback: boolean; fallbackItemId?: string }>(
      `${this.API}/acp/${acpId}/items/${itemId}/response-state/with-fallback`,
      { unitId, itemList, ...(rowKey ? { rowKey } : {}) },
    );
  }

  getAllResponseStates(acpId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/acp/${acpId}/items/response-state/all`);
  }
}
