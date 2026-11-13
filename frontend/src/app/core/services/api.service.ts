import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpResponse } from '@angular/common/http';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  Ap,
  CreateApRequest,
  UpdateApRequest,
  ApRoleAssignment,
  AssignApRoleRequest,
  AssignableApUser,
  UpdateAccessConfigRequest,
  UpdateMetadataColumnsRequest,
  CredentialEntry,
  CredentialUploadMode,
  CredentialUploadResponse,
  CredentialDeletionResponse,
  AccessConfig,
  ApSnapshot,
  SnapshotCurrentDiff,
  ApFile,
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
  PublicAp,
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
  ValidationResult,
  FilePreviewResponse,
  FileDeletionResponse,
  ItemCollectionsPayload,
  ItemCollectionRowsMutation,
  ItemCollectionRowsMutationResult,
  ItemExplorerPerspective,
  SimpleItemListEntry,
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
    options: { limit?: number; offset?: number; allowedApId?: string } = {},
  ): Observable<ApplicationTokenListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options.allowedApId) {
      params.set('allowedApId', options.allowedApId);
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

  getApApplicationTokens(
    apId: string,
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
      `${this.API}/ap/${apId}/application-tokens${suffix}`,
    );
  }

  createApApplicationToken(
    apId: string,
    data: CreateApplicationTokenRequest,
  ): Observable<CreatedApplicationToken> {
    return this.http.post<CreatedApplicationToken>(
      `${this.API}/ap/${apId}/application-tokens`,
      data,
    );
  }

  revokeApApplicationToken(apId: string, tokenId: string): Observable<ApplicationToken> {
    return this.http.patch<ApplicationToken>(
      `${this.API}/ap/${apId}/application-tokens/${tokenId}/revoke`,
      {},
    );
  }

  // AP
  getAps(): Observable<Ap[]> {
    return this.http.get<Ap[]>(`${this.API}/ap`);
  }
  getAp(id: string): Observable<Ap> {
    return this.http.get<Ap>(`${this.API}/ap/${id}`);
  }
  createAp(data: CreateApRequest): Observable<Ap> {
    return this.http.post<Ap>(`${this.API}/ap`, data);
  }
  updateAp(id: string, data: UpdateApRequest): Observable<Ap> {
    return this.http.patch<Ap>(`${this.API}/ap/${id}`, data);
  }
  deleteAp(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API}/ap/${id}`);
  }

  // AP Index
  getApIndex(id: string): Observable<any> {
    return this.http.get(`${this.API}/ap/${id}/index`);
  }
  updateApIndex(id: string, data: any): Observable<any> {
    return this.http.put(`${this.API}/ap/${id}/index`, data);
  }
  importApIndex(id: string, data: any): Observable<any> {
    return this.http.post(`${this.API}/ap/${id}/index/import`, data);
  }
  deleteApIndex(id: string): Observable<any> {
    return this.http.delete(`${this.API}/ap/${id}/index`);
  }

  // AP Roles
  getApRoles(id: string): Observable<ApRoleAssignment[]> {
    return this.http.get<ApRoleAssignment[]>(`${this.API}/ap/${id}/roles`);
  }
  assignApRole(id: string, data: AssignApRoleRequest): Observable<ApRoleAssignment> {
    return this.http.post<ApRoleAssignment>(`${this.API}/ap/${id}/roles`, data);
  }
  removeApRole(apId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.API}/ap/${apId}/roles/${userId}`);
  }
  getAssignableUsers(apId: string): Observable<AssignableApUser[]> {
    return this.http.get<AssignableApUser[]>(`${this.API}/ap/${apId}/assignable-users`);
  }

  updateRoleCapabilities(
    apId: string,
    userId: string,
    capabilities: string[],
  ): Observable<ApRoleAssignment> {
    return this.http.patch<ApRoleAssignment>(
      `${this.API}/ap/${apId}/roles/${userId}/capabilities`,
      {
        capabilities,
      },
    );
  }
  getCapabilities(apId: string): Observable<any> {
    return this.http.get(`${this.API}/view/ap/${apId}/capabilities`);
  }
  getReview(apId: string): Observable<any> {
    return this.http.get(`${this.API}/view/ap/${apId}/review`);
  }
  getReviewConfig(apId: string): Observable<any> {
    return this.http.get(`${this.API}/view/ap/${apId}/review/config`);
  }
  getReviewMembers(apId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/view/ap/${apId}/review/members`);
  }
  getVisibleReviewComments(apId: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API}/ap/${apId}/review/comments/visible`);
  }
  exportVisibleReviewComments(
    apId: string,
    filters: Record<string, string> = {},
  ): Observable<Blob> {
    return this.http.get(`${this.API}/ap/${apId}/review/comments/export/visible.xlsx`, {
      responseType: 'blob',
      params: filters,
    });
  }
  configureReview(apId: string, config: any): Observable<any> {
    return this.http.put(`${this.API}/view/ap/${apId}/review/config`, config);
  }
  getReviewReadiness(apId: string): Observable<ReviewReadiness | null> {
    return this.http.get<ReviewReadiness | null>(`${this.API}/view/ap/${apId}/review/readiness`);
  }
  checkReviewReadiness(apId: string): Observable<ReviewReadiness> {
    return this.http.post<ReviewReadiness>(`${this.API}/view/ap/${apId}/review/readiness`, {});
  }
  importCredentialFile(
    apId: string,
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
      `${this.API}/ap/${apId}/access/credentials/file?mode=${mode}&preview=${preview}`,
      body,
    );
  }

  // AP Access
  getAccessConfig(id: string): Observable<AccessConfig> {
    return this.http.get<AccessConfig>(`${this.API}/ap/${id}/access`);
  }
  updateAccessConfig(id: string, data: UpdateAccessConfigRequest): Observable<AccessConfig> {
    return this.http.put<AccessConfig>(`${this.API}/ap/${id}/access`, data);
  }
  uploadCredentials(
    id: string,
    credentials: CredentialEntry[],
    mode: CredentialUploadMode = 'replace',
  ): Observable<CredentialUploadResponse> {
    return this.http.post<CredentialUploadResponse>(
      `${this.API}/ap/${id}/access/credentials?mode=${mode}`,
      { credentials },
    );
  }
  getCredentials(id: string): Observable<Credential[]> {
    return this.http.get<Credential[]>(`${this.API}/ap/${id}/access/credentials`);
  }
  createCredential(
    apId: string,
    username: string,
    password: string,
    capabilities: string[] = [],
  ): Observable<Credential> {
    return this.http.post<Credential>(`${this.API}/ap/${apId}/access/credentials/single`, {
      username,
      password,
      capabilities,
    });
  }
  updateCredential(
    apId: string,
    credentialId: string,
    data: { username?: string; password?: string; capabilities?: string[] },
  ): Observable<Credential> {
    return this.http.patch<Credential>(
      `${this.API}/ap/${apId}/access/credentials/${credentialId}`,
      data,
    );
  }
  deleteCredential(apId: string, credentialId: string): Observable<CredentialDeletionResponse> {
    return this.http.delete<CredentialDeletionResponse>(
      `${this.API}/ap/${apId}/access/credentials/${credentialId}`,
    );
  }
  updateMetadataColumns(id: string, data: UpdateMetadataColumnsRequest): Observable<AccessConfig> {
    return this.http.put<AccessConfig>(`${this.API}/ap/${id}/metadata-columns`, data);
  }

  // Files
  getFiles(apId: string): Observable<ApFile[]> {
    return this.http.get<ApFile[]>(`${this.API}/ap/${apId}/files`);
  }
  getApConsistency(apId: string): Observable<ValidationResult> {
    return this.http.get<ValidationResult>(`${this.API}/ap/${apId}/files/consistency`);
  }
  uploadFiles(
    apId: string,
    formData: FormData,
    options?: { conflictStrategy?: FileUploadConflictStrategy },
  ): Observable<HttpEvent<FileUploadResponse>> {
    const query: string[] = [];
    if (options?.conflictStrategy) {
      query.push(`conflictStrategy=${encodeURIComponent(options.conflictStrategy)}`);
    }
    const suffix = query.length ? `?${query.join('&')}` : '';
    return this.http.post<FileUploadResponse>(
      `${this.API}/ap/${apId}/files/upload${suffix}`,
      formData,
      {
        observe: 'events',
        reportProgress: true,
      },
    );
  }
  startFileProcessing(
    apId: string,
    data: { fileIds: string[]; runCleanup: boolean },
  ): Observable<FileProcessingJob> {
    return this.http.post<FileProcessingJob>(`${this.API}/ap/${apId}/files/process-upload`, data);
  }
  getFileProcessingJob(apId: string, jobId: string): Observable<FileProcessingJob> {
    return this.http.get<FileProcessingJob>(`${this.API}/ap/${apId}/files/jobs/${jobId}`);
  }
  getFileProcessingJobEventsUrl(apId: string, jobId: string): string {
    return this.appendAuthToken(`${this.API}/ap/${apId}/files/jobs/${jobId}/events`);
  }
  syncIndexFromFiles(apId: string): Observable<IndexSyncReport> {
    return this.http.post<IndexSyncReport>(`${this.API}/ap/${apId}/files/sync-index`, {});
  }
  deleteFile(apId: string, fileId: string): Observable<FileDeletionResponse> {
    return this.http.delete<FileDeletionResponse>(`${this.API}/ap/${apId}/files/${fileId}`);
  }
  deleteAllFiles(apId: string): Observable<FileDeletionResponse> {
    return this.http.delete<FileDeletionResponse>(`${this.API}/ap/${apId}/files/all`);
  }
  bulkDeleteFiles(apId: string, fileIds: string[]): Observable<FileDeletionResponse> {
    return this.http.post<FileDeletionResponse>(`${this.API}/ap/${apId}/files/bulk-delete`, {
      fileIds,
    });
  }
  startFileDownloadJob(apId: string, data: { fileIds: string[] }): Observable<FileProcessingJob> {
    return this.http.post<FileProcessingJob>(
      `${this.API}/ap/${apId}/files/bulk-download/jobs`,
      data,
    );
  }
  downloadFilesArchive(apId: string, fileIds: string[] = []): Observable<HttpResponse<Blob>> {
    return this.http.post(
      `${this.API}/ap/${apId}/files/bulk-download`,
      { fileIds },
      {
        observe: 'response',
        responseType: 'blob',
      },
    );
  }
  downloadFileJobArchive(apId: string, jobId: string): Observable<HttpEvent<Blob>> {
    return this.http.get(`${this.API}/ap/${apId}/files/jobs/${jobId}/archive`, {
      observe: 'events',
      reportProgress: true,
      responseType: 'blob',
    });
  }
  getFileJobArchiveUrl(apId: string, jobId: string): string {
    return this.appendAuthToken(`${this.API}/ap/${apId}/files/jobs/${jobId}/archive`);
  }
  getFileValidation(apId: string, fileId: string): Observable<any> {
    return this.http.get(`${this.API}/ap/${apId}/files/${fileId}/validation`);
  }
  getFileDownloadUrl(apId: string, fileId: string): string {
    return this.getFileContentUrl(apId, fileId);
  }
  getFileContentUrl(
    apId: string,
    fileId: string,
    options?: { disposition?: 'attachment' | 'inline' },
  ): string {
    const token = localStorage.getItem('ch_token');
    const query: string[] = [];
    if (token) {
      query.push(`auth_token=${encodeURIComponent(token)}`);
    }
    if (options?.disposition) {
      query.push(`disposition=${encodeURIComponent(options.disposition)}`);
    }
    const suffix = query.length ? `?${query.join('&')}` : '';
    return `${this.API}/ap/${apId}/files/${fileId}/download${suffix}`;
  }
  getFilePreview(apId: string, fileId: string): Observable<FilePreviewResponse> {
    return this.http.get<FilePreviewResponse>(`${this.API}/ap/${apId}/files/${fileId}/preview`);
  }
  validateUnitFiles(apId: string): Observable<ValidateUnitsResponse> {
    return this.http.get<ValidateUnitsResponse>(`${this.API}/ap/${apId}/files/validate-units`);
  }
  getFileItemList(
    apId: string,
    options?: { perspective?: ItemExplorerPerspective },
  ): Observable<any> {
    const query = this.buildPerspectiveQuery(options?.perspective);
    return this.http.get(`${this.API}/ap/${apId}/files/item-list${query}`);
  }
  recalculateItemRowNumbers(apId: string): Observable<{ renumberedCount: number }> {
    return this.http.post<{ renumberedCount: number }>(
      `${this.API}/ap/${apId}/files/item-list/renumber`,
      {},
    );
  }
  getFileUnitView(
    apId: string,
    unitId: string,
    options?: { perspective?: ItemExplorerPerspective },
  ): Observable<any> {
    const query = this.buildPerspectiveQuery(options?.perspective);
    return this.http.get(`${this.API}/ap/${apId}/files/unit-view/${unitId}${query}`);
  }

  getIndexExportUrl(id: string): string {
    const token = localStorage.getItem('ch_token');
    return `${this.API}/ap/${id}/index/export${token ? '?auth_token=' + encodeURIComponent(token) : ''}`;
  }

  appendAuthToken(url: string): string {
    const token = localStorage.getItem('ch_token');
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
  getSnapshots(apId: string): Observable<ApSnapshot[]> {
    return this.http.get<ApSnapshot[]>(`${this.API}/ap/${apId}/snapshots`);
  }
  createSnapshot(apId: string, changelog?: string): Observable<ApSnapshot> {
    return this.http.post<ApSnapshot>(`${this.API}/ap/${apId}/snapshots`, { changelog });
  }
  restoreSnapshot(apId: string, snapshotId: string): Observable<Ap> {
    return this.http.post<Ap>(`${this.API}/ap/${apId}/snapshots/${snapshotId}/restore`, {});
  }
  deleteSnapshot(apId: string, snapshotId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.API}/ap/${apId}/snapshots/${snapshotId}`);
  }
  getSnapshotDiff(apId: string, snapshotId: string): Observable<any> {
    return this.http.get(`${this.API}/ap/${apId}/snapshots/${snapshotId}/diff`);
  }
  getSnapshotCurrentDiff(apId: string, snapshotId: string): Observable<SnapshotCurrentDiff> {
    return this.http.get<SnapshotCurrentDiff>(
      `${this.API}/ap/${apId}/snapshots/${snapshotId}/diff/current`,
    );
  }

  // Comments
  getComments(apId: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API}/ap/${apId}/comments`);
  }
  getMyComments(apId: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API}/ap/${apId}/comments/mine`);
  }
  createComment(apId: string, data: any): Observable<Comment> {
    return this.http.post<Comment>(`${this.API}/ap/${apId}/comments`, data);
  }
  getItemCommentThread(
    apId: string,
    unitId: string,
    itemId: string,
    previous?: CommentThreadSnapshot | null,
  ): Observable<CommentThreadSnapshot> {
    return this.http
      .get<CommentThreadSnapshot>(`${this.API}/ap/${apId}/review/comments`, {
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
    apId: string,
    target: ReviewCommentTarget,
    previous?: CommentThreadSnapshot | null,
  ): Observable<CommentThreadSnapshot> {
    return this.http
      .get<CommentThreadSnapshot>(`${this.API}/ap/${apId}/review/comments`, {
        params: { ...target },
        ...(previous ? { headers: { 'If-None-Match': `"${previous.revision}"` } } : {}),
      })
      .pipe(
        catchError((error) =>
          error.status === 304 && previous ? of(previous) : throwError(() => error),
        ),
      );
  }
  getItemCommentCounts(apId: string): Observable<ItemCommentCountsSnapshot> {
    return this.http.get<ItemCommentCountsSnapshot>(
      `${this.API}/ap/${apId}/review/comments/counts`,
    );
  }
  createItemComment(
    apId: string,
    data: {
      unitId: string;
      itemId: string;
      commentText: string;
      parentCommentId?: string;
      groupId?: string;
      categoryId?: string | null;
    },
  ): Observable<Comment> {
    return this.http.post<Comment>(`${this.API}/ap/${apId}/review/comments`, data);
  }
  createReviewComment(
    apId: string,
    data: ReviewCommentTarget & {
      commentText: string;
      parentCommentId?: string;
      groupId?: string;
      categoryId?: string | null;
    },
  ): Observable<Comment> {
    return this.http.post<Comment>(`${this.API}/ap/${apId}/review/comments`, data);
  }
  updateItemComment(
    apId: string,
    commentId: string,
    data: { commentText: string; version: number; categoryId?: string | null },
  ): Observable<Comment> {
    return this.http.patch<Comment>(`${this.API}/ap/${apId}/review/comments/${commentId}`, data);
  }
  deleteItemComment(
    apId: string,
    commentId: string,
    version: number,
  ): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.API}/ap/${apId}/review/comments/${commentId}`,
      {
        params: { version },
      },
    );
  }
  exportComments(apId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/ap/${apId}/comments/export`);
  }
  exportCommentsXlsx(apId: string): Observable<Blob> {
    return this.http.get(`${this.API}/ap/${apId}/comments/export.xlsx`, { responseType: 'blob' });
  }
  setCommentVote(
    apId: string,
    commentId: string,
    value: 'UP' | 'DOWN' | null,
  ): Observable<unknown> {
    const url = `${this.API}/ap/${apId}/review/comments/${commentId}/vote`;
    return value === null ? this.http.delete(url) : this.http.put(url, { value });
  }

  exportMyReviewCommentsCsv(apId: string, filters: Record<string, string> = {}): Observable<Blob> {
    return this.http.get(`${this.API}/ap/${apId}/review/comments/export/mine.csv`, {
      responseType: 'blob',
      params: filters,
    });
  }
  exportMyReviewCommentsXlsx(apId: string, filters: Record<string, string> = {}): Observable<Blob> {
    return this.http.get(`${this.API}/ap/${apId}/review/comments/export/mine.xlsx`, {
      responseType: 'blob',
      params: filters,
    });
  }
  exportAllReviewCommentsXlsx(apId: string): Observable<Blob> {
    return this.http.get(`${this.API}/ap/${apId}/review/comments/export/all.xlsx`, {
      responseType: 'blob',
    });
  }

  // Public Views
  getPublicSettings(): Observable<any> {
    return this.http.get(`${this.API}/view/settings`);
  }
  getPublicAps(): Observable<PublicAp[]> {
    return this.http.get<PublicAp[]>(`${this.API}/view/ap`);
  }
  getApStartPage(apId: string): Observable<any> {
    return this.http.get(`${this.API}/view/ap/${apId}`);
  }
  getViewUnits(apId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/view/ap/${apId}/units`);
  }
  getViewUnit(apId: string, unitId: string): Observable<UnitViewData> {
    return this.http.get<UnitViewData>(`${this.API}/view/ap/${apId}/units/${unitId}`);
  }
  getViewItems(apId: string): Observable<SimpleItemListEntry[]> {
    return this.http.get<SimpleItemListEntry[]>(`${this.API}/view/ap/${apId}/items`);
  }
  getViewItemPreferences(apId: string, viewId = 'item-list'): Observable<ItemViewPreferences> {
    return this.http.get<ItemViewPreferences>(
      `${this.API}/view/ap/${apId}/items/preferences?viewId=${encodeURIComponent(viewId)}`,
    );
  }
  saveViewItemPreferences(
    apId: string,
    data: ItemViewPreferences,
    viewId = 'item-list',
  ): Observable<ItemViewPreferences> {
    return this.http.put<ItemViewPreferences>(`${this.API}/view/ap/${apId}/items/preferences`, {
      viewId,
      ...data,
    });
  }
  patchViewItemPreferenceRow(
    apId: string,
    rowKey: string,
    rowData: Record<string, unknown> | null,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemViewPreferences> {
    return this.http.patch<ItemViewPreferences>(
      `${this.API}/view/ap/${apId}/items/preferences/row-data`,
      { rowKey, rowData, perspective },
    );
  }
  exportViewPersonalItemDataXlsx(
    apId: string,
    rowKeys: string[],
    perspective: ItemExplorerPerspective,
  ): Observable<Blob> {
    return this.http.post(
      `${this.API}/view/ap/${apId}/items/preferences/export.xlsx`,
      { rowKeys, perspective },
      { responseType: 'blob' },
    );
  }
  exportAllViewPersonalItemDataCsv(
    apId: string,
    perspective: ItemExplorerPerspective,
    collectionId?: string,
  ): Observable<Blob> {
    return this.http.post(
      `${this.API}/view/ap/${apId}/items/preferences/export-all.csv`,
      { perspective, ...(collectionId === undefined ? {} : { collectionId }) },
      { responseType: 'blob' },
    );
  }
  getViewSequences(apId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/view/ap/${apId}/sequences`);
  }
  getViewSequence(apId: string, seqId: string, kind?: 'booklet'): Observable<TaskSequence> {
    return this.http.get<TaskSequence>(
      `${this.API}/view/ap/${apId}/sequences/${encodeURIComponent(seqId)}${kind === 'booklet' ? '?kind=booklet' : ''}`,
    );
  }
  getViewIndex(apId: string): Observable<any> {
    return this.http.get(`${this.API}/view/ap/${apId}/index`);
  }
  getViewIndexExportUrl(apId: string): string {
    const token = localStorage.getItem('ch_token');
    return `${this.API}/view/ap/${apId}/index/export${token ? '?auth_token=' + encodeURIComponent(token) : ''}`;
  }

  getItemExplorerState(
    apId: string,
    perspective?: ItemExplorerPerspective,
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.get<ItemExplorerStateEnvelope>(
      `${this.API}/view/ap/${apId}/item-explorer/state`,
      { params: perspective ? { perspective } : {} },
    );
  }

  patchItemExplorerDraft(
    apId: string,
    data: {
      changeType: string;
      patch: ItemExplorerSharedState | Record<string, unknown>;
      baseVersion?: number;
    },
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.patch<ItemExplorerStateEnvelope>(
      `${this.API}/ap/${apId}/item-explorer/draft`,
      data,
    );
  }

  saveItemExplorerDraft(apId: string, baseVersion?: number): Observable<ItemExplorerStateEnvelope> {
    return this.http.post<ItemExplorerStateEnvelope>(
      `${this.API}/ap/${apId}/item-explorer/draft/save`,
      {
        baseVersion,
      },
    );
  }

  discardItemExplorerDraft(
    apId: string,
    baseVersion?: number,
  ): Observable<ItemExplorerStateEnvelope> {
    return this.http.post<ItemExplorerStateEnvelope>(
      `${this.API}/ap/${apId}/item-explorer/draft/discard`,
      {
        baseVersion,
      },
    );
  }

  getItemExplorerChanges(apId: string, limit = 100): Observable<ItemExplorerChangeLogEntry[]> {
    return this.http.get<ItemExplorerChangeLogEntry[]>(
      `${this.API}/ap/${apId}/item-explorer/changes?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  // Items
  uploadItemParameters(
    apId: string,
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
    }>(`${this.API}/ap/${apId}/items/upload-item-parameters${queryString}`, formData);
  }

  uploadEmpiricalDifficulties(
    apId: string,
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
    }>(`${this.API}/ap/${apId}/items/upload-empirical-difficulty${queryString}`, formData);
  }

  getItemCollections(
    apId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.get<ItemCollectionsPayload>(
      `${this.API}/view/ap/${apId}/items/collections?perspective=${encodeURIComponent(perspective)}`,
    );
  }

  createItemCollection(
    apId: string,
    name: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.post<ItemCollectionsPayload>(`${this.API}/view/ap/${apId}/items/collections`, {
      name,
      perspective,
    });
  }

  updateItemCollection(
    apId: string,
    collectionId: string,
    update: { baseVersion: number; name?: string; rowKeys?: string[]; shared?: boolean },
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.patch<ItemCollectionsPayload>(
      `${this.API}/view/ap/${apId}/items/collections/${encodeURIComponent(collectionId)}`,
      { ...update, perspective },
    );
  }

  copyItemCollection(
    apId: string,
    collectionId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.post<ItemCollectionsPayload>(
      `${this.API}/view/ap/${apId}/items/collections/${encodeURIComponent(collectionId)}/copy`,
      { perspective },
    );
  }

  mutateItemCollectionRows(
    apId: string,
    collectionId: string,
    mutation: ItemCollectionRowsMutation,
  ): Observable<ItemCollectionRowsMutationResult> {
    return this.http.patch<ItemCollectionRowsMutationResult>(
      `${this.API}/view/ap/${apId}/items/collections/${encodeURIComponent(collectionId)}/rows`,
      mutation,
    );
  }

  activateItemCollection(
    apId: string,
    collectionId: string | null,
    perspective: ItemExplorerPerspective,
    collectionViewMode?: 'all' | 'active',
  ): Observable<ItemCollectionsPayload> {
    return this.http.put<ItemCollectionsPayload>(
      `${this.API}/view/ap/${apId}/items/collections/active`,
      { collectionId, perspective, collectionViewMode },
    );
  }

  deleteItemCollection(
    apId: string,
    collectionId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<ItemCollectionsPayload> {
    return this.http.delete<ItemCollectionsPayload>(
      `${this.API}/view/ap/${apId}/items/collections/${encodeURIComponent(collectionId)}?perspective=${encodeURIComponent(perspective)}`,
    );
  }

  exportItemCollectionCsv(
    apId: string,
    collectionId: string,
    perspective: ItemExplorerPerspective,
  ): Observable<Blob> {
    return this.http.post(
      `${this.API}/view/ap/${apId}/items/collections/${encodeURIComponent(collectionId)}/export.csv?perspective=${encodeURIComponent(perspective)}`,
      {},
      { responseType: 'blob' },
    );
  }

  clearEmpiricalDifficulties(
    apId: string,
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
      `${this.API}/ap/${apId}/items/empirical-difficulty${queryString}`,
    );
  }

  getItemTags(apId: string): Observable<Record<string, string[]>> {
    return this.http.get<Record<string, string[]>>(`${this.API}/ap/${apId}/items/tags`);
  }

  saveItemTags(apId: string, tags: Record<string, string[]>): Observable<Record<string, string[]>> {
    return this.http.put<Record<string, string[]>>(`${this.API}/ap/${apId}/items/tags`, { tags });
  }

  // Response State
  saveResponseState(
    apId: string,
    itemId: string,
    unitId: string,
    responseData: Record<string, any>,
    rowKey?: string,
  ): Observable<any> {
    return this.http.post(`${this.API}/ap/${apId}/items/${itemId}/response-state`, {
      unitId,
      responseData,
      ...(rowKey ? { rowKey } : {}),
    });
  }

  getResponseState(apId: string, itemId: string, unitId: string, rowKey?: string): Observable<any> {
    const rowKeyQuery = rowKey ? `&rowKey=${encodeURIComponent(rowKey)}` : '';
    return this.http.get(
      `${this.API}/ap/${apId}/items/${itemId}/response-state?unitId=${encodeURIComponent(unitId)}${rowKeyQuery}`,
    );
  }

  deleteResponseState(
    apId: string,
    itemId: string,
    unitId: string,
    rowKey?: string,
  ): Observable<any> {
    const rowKeyQuery = rowKey ? `&rowKey=${encodeURIComponent(rowKey)}` : '';
    return this.http.delete(
      `${this.API}/ap/${apId}/items/${itemId}/response-state?unitId=${encodeURIComponent(unitId)}${rowKeyQuery}`,
    );
  }

  getResponseStateWithFallback(
    apId: string,
    itemId: string,
    unitId: string,
    itemList: { itemId: string; unitId: string; rowKey?: string }[],
    rowKey?: string,
  ): Observable<{ state: any; isFallback: boolean; fallbackItemId?: string }> {
    return this.http.post<{ state: any; isFallback: boolean; fallbackItemId?: string }>(
      `${this.API}/ap/${apId}/items/${itemId}/response-state/with-fallback`,
      { unitId, itemList, ...(rowKey ? { rowKey } : {}) },
    );
  }

  getAllResponseStates(apId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API}/ap/${apId}/items/response-state/all`);
  }
}
