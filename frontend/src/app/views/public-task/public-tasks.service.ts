import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface PublicTaskSnapshot {
  version: 1;
  unitId: string;
  title: string;
  description: string;
  copyrightNotice: string;
  publicComments: string;
  playerHtml: string;
  definition: string;
  codingScheme: Record<string, unknown>;
  metadata: { label: string; entries: { label: string; value: string }[] }[];
}

export interface PublicTaskInput {
  unitId: string;
  copyrightNotice: string;
  publicComments: string;
}

export interface PublicTaskPreview {
  sourceRevision: string;
  snapshot: PublicTaskSnapshot;
}

export interface PublicTaskSummary {
  id: string;
  unitId: string;
  title: string;
  published: boolean;
  createdAt: string;
  path: string;
}

@Injectable({ providedIn: 'root' })
export class PublicTasksService {
  constructor(private http: HttpClient) {}

  get(id: string) {
    return this.http.get<{ id: string; createdAt: string; snapshot: PublicTaskSnapshot }>(
      `/api/public-tasks/${encodeURIComponent(id)}`,
    );
  }

  list(apId: string) {
    return this.http.get<PublicTaskSummary[]>(`/api/ap/${apId}/publications`);
  }

  units(apId: string) {
    return this.http.get<{ id: string; name: string }[]>(`/api/ap/${apId}/publications/units`);
  }

  preview(apId: string, input: PublicTaskInput) {
    return this.http.post<PublicTaskPreview>(`/api/ap/${apId}/publications/preview`, input);
  }

  create(apId: string, input: PublicTaskInput, sourceRevision: string) {
    return this.http.post<PublicTaskSummary>(`/api/ap/${apId}/publications`, {
      ...input,
      sourceRevision,
    });
  }

  setPublished(apId: string, id: string, published: boolean) {
    return this.http.put<PublicTaskSummary>(`/api/ap/${apId}/publications/${id}`, { published });
  }
}
