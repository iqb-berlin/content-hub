import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiService } from './api.service';
import {
  Acp,
  AccessConfig,
  AcpRoleAssignment,
  AssignableAcpUser,
  CreateAcpRequest,
  UpdateAcpRequest,
  AssignAcpRoleRequest,
  UpdateAccessConfigRequest,
  CredentialUploadMode,
  CredentialUploadResponse,
} from '../models/api.models';

describe('ACP API client contracts', () => {
  let api: ApiService;
  let http: HttpTestingController;
  const acp: Acp = {
    id: 'acp-id',
    packageId: 'package',
    name: 'Package',
    description: null,
    acpIndex: {},
    settings: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const config: AccessConfig = {
    id: 'access-id',
    acpId: acp.id,
    accessModel: 'PRIVATE',
    allowRegistered: false,
    featureConfig: {},
    validFrom: null,
    validUntil: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = new ApiService(TestBed.inject(HttpClient));
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    try {
      http?.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('creates and partially updates ACPs with their existing payloads', async () => {
    const create: CreateAcpRequest = { packageId: 'package', name: 'Package' };
    const created = firstValueFrom(api.createAcp(create));
    const post = http.expectOne('/api/acp');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(create);
    post.flush(acp);
    expect(await created).toEqual(acp);

    const update: UpdateAcpRequest = { name: 'Renamed' };
    const updated = firstValueFrom(api.updateAcp(acp.id, update));
    const patch = http.expectOne(`/api/acp/${acp.id}`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ name: 'Renamed' });
    patch.flush({ ...acp, name: 'Renamed' });
    expect((await updated).name).toBe('Renamed');
  });

  it('distinguishes user summaries, listed assignments and assignment write responses', async () => {
    const user: AssignableAcpUser = { id: 'user-id', username: 'reader', displayName: null };
    const assignment: AcpRoleAssignment = {
      id: 'role-id',
      acpId: acp.id,
      userId: user.id,
      role: 'READ_ONLY',
      capabilities: ['review:participate'],
    };
    const users = firstValueFrom(api.getAssignableUsers(acp.id));
    http.expectOne(`/api/acp/${acp.id}/assignable-users`).flush([user]);
    expect(await users).toEqual([user]);

    const roles = firstValueFrom(api.getAcpRoles(acp.id));
    http.expectOne(`/api/acp/${acp.id}/roles`).flush([{ ...assignment, user }]);
    expect((await roles)[0].user).toEqual(user);

    const body: AssignAcpRoleRequest = {
      userId: user.id,
      role: 'READ_ONLY',
      capabilities: ['review:participate'],
    };
    const saved = firstValueFrom(api.assignAcpRole(acp.id, body));
    const post = http.expectOne(`/api/acp/${acp.id}/roles`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(body);
    post.flush(assignment);
    expect(await saved).toEqual(assignment);
  });

  it('preserves an explicit empty capability list when removing grants', async () => {
    const saved = firstValueFrom(api.updateRoleCapabilities(acp.id, 'user-id', []));
    const patch = http.expectOne(`/api/acp/${acp.id}/roles/user-id/capabilities`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ capabilities: [] });
    const response: AcpRoleAssignment = {
      id: 'role-id',
      acpId: acp.id,
      userId: 'user-id',
      role: 'READ_ONLY',
      capabilities: [],
    };
    patch.flush(response);
    expect(await saved).toEqual(response);
  });

  it('preserves false, nullable dates and extension fields in access updates', async () => {
    const body: UpdateAccessConfigRequest = {
      accessModel: 'PRIVATE',
      allowRegistered: false,
      validFrom: null,
      validUntil: null,
      featureConfig: {
        enableItemList: true,
        commentVisibilityMode: 'GROUP',
        extension: { version: 1 },
      },
    };
    const saved = firstValueFrom(api.updateAccessConfig(acp.id, body));
    const put = http.expectOne(`/api/acp/${acp.id}/access`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(body);
    put.flush({ ...config, ...body });
    expect(await saved).toEqual({ ...config, ...body });
  });

  it.each<CredentialUploadMode>(['replace', 'append', 'upsert'])(
    'sends credential upload mode %s and returns counters',
    async (mode) => {
      const credentials = [{ username: 'reader', password: 'StrongPassword1!' }];
      const result: CredentialUploadResponse = {
        message: 'Processed',
        added: 1,
        updated: 0,
        skipped: 0,
        duplicates: [],
      };
      const upload = firstValueFrom(api.uploadCredentials(acp.id, credentials, mode));
      const post = http.expectOne(`/api/acp/${acp.id}/access/credentials?mode=${mode}`);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ credentials });
      post.flush(result);
      expect(await upload).toEqual(result);
    },
  );

  it('returns the actual credential deletion response', async () => {
    const deleted = firstValueFrom(api.deleteCredential(acp.id, 'credential-id'));
    const req = http.expectOne(`/api/acp/${acp.id}/access/credentials/credential-id`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Credential deleted successfully' });
    expect(await deleted).toEqual({ message: 'Credential deleted successfully' });
  });

  it.each([400, 403])('propagates HTTP %s without converting it to a success', async (status) => {
    const result = firstValueFrom(api.updateAccessConfig(acp.id, { accessModel: 'PUBLIC' }));
    const rejected = expect(result).rejects.toMatchObject({
      status,
      error: { message: 'Rejected' },
    });
    http
      .expectOne(`/api/acp/${acp.id}/access`)
      .flush({ message: 'Rejected' }, { status, statusText: 'Rejected' });
    await rejected;
  });
});
