import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { catchError, combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { AcpNavigationService } from '../../core/services/acp-navigation.service';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { AcpFile } from '../../core/models/api.models';
import { BreadcrumbComponent, BreadcrumbItem } from '../../shared/components/breadcrumb.component';

type NodeKind = 'object' | 'array' | 'value';
type ActionKind = 'route' | 'file-view' | 'file-download';

interface IndexNode {
  id: string;
  label: string;
  path: string;
  depth: number;
  kind: NodeKind;
  value: unknown;
  children: IndexNode[];
  actions: NodeAction[];
}

interface NodeAction {
  id: string;
  kind: ActionKind;
  label: string;
  route?: string[];
  fileId?: string;
  fileName?: string;
  title?: string;
}

@Component({
  selector: 'app-acp-index-view',
  standalone: true,
  imports: [RouterLink, CommonModule, BreadcrumbComponent],
  template: `
    <app-breadcrumb [items]="breadcrumbs" />

    <div class="page-header">
      <h1>ACP-Index</h1>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" (click)="applyExpandDepth(1)">Ebene 1</button>
        <button class="btn btn-outline btn-sm" (click)="applyExpandDepth(2)">Ebene 2</button>
        <button class="btn btn-outline btn-sm" (click)="applyExpandDepth(99)">
          Alles aufklappen
        </button>
        <a [routerLink]="navigation.overviewRoute(acpId)" class="btn btn-outline"
          >← Zur ACP-Übersicht</a
        >
      </div>
    </div>

    @if (loading) {
      <div class="empty-state"><h3>Lade ACP-Index...</h3></div>
    } @else if (error) {
      <div class="alert alert-warning">{{ error }}</div>
    } @else {
      <div class="card">
        <div class="tree-toolbar">
          <span class="tree-hint">
            Rekursive Strukturansicht mit Links für Aufgabenfolgen, Aufgaben, Items und Dateien.
          </span>
        </div>

        @if (fileActionError) {
          <div class="alert alert-warning" style="margin-bottom: 12px">{{ fileActionError }}</div>
        }

        <div class="tree-root">
          @for (node of rootNodes; track node.id) {
            <ng-container
              [ngTemplateOutlet]="nodeTemplate"
              [ngTemplateOutletContext]="{ $implicit: node }"
            >
            </ng-container>
          }
        </div>
      </div>
    }

    <ng-template #nodeTemplate let-node>
      @if (node.kind === 'value') {
        <div class="node-row leaf" [style.padding-left.px]="node.depth * 18">
          <span class="node-key">{{ node.label }}</span>
          <span class="node-sep">:</span>
          <code class="node-value">{{ formatPrimitive(node.value) }}</code>
          @if (node.actions.length) {
            <div class="node-actions">
              @for (action of node.actions; track action.id) {
                @if (action.kind === 'route') {
                  <a class="action-chip" [title]="action.title || ''" [routerLink]="action.route">
                    {{ action.label }}
                  </a>
                } @else {
                  <button
                    class="action-chip"
                    [title]="action.title || ''"
                    [disabled]="busyFileId === action.fileId"
                    (click)="runFileAction(action, $event)"
                  >
                    {{ busyFileId === action.fileId ? '…' : action.label }}
                  </button>
                }
              }
            </div>
          }
        </div>
      } @else {
        <details
          #detailsEl
          class="node-group"
          [attr.open]="isExpanded(node) ? '' : null"
          (toggle)="onNodeToggle(node, detailsEl, $event)"
        >
          <summary class="node-row group" [style.padding-left.px]="node.depth * 18">
            <span class="node-key">{{ node.label }}</span>
            <span class="node-sep">:</span>
            <span class="node-kind">{{ node.kind === 'array' ? 'Array' : 'Objekt' }}</span>
            <span class="node-count">{{ node.children.length }}</span>
          </summary>
          <div class="node-children">
            @if (!node.children.length) {
              <div class="node-empty" [style.padding-left.px]="(node.depth + 1) * 18">leer</div>
            }
            @for (child of node.children; track child.id) {
              <ng-container
                [ngTemplateOutlet]="nodeTemplate"
                [ngTemplateOutletContext]="{ $implicit: child }"
              >
              </ng-container>
            }
          </div>
        </details>
      }
    </ng-template>
  `,
  styles: [
    `
      .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .tree-toolbar {
        margin-bottom: 10px;
      }
      .tree-hint {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
      }

      .tree-root {
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        overflow: hidden;
        background: #fff;
      }

      .node-group {
        border-top: 1px solid rgba(0, 0, 0, 0.04);
      }
      .node-group:first-child {
        border-top: none;
      }
      .node-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding-right: 10px;
        font-size: 0.84rem;
      }
      .node-row.group {
        cursor: pointer;
        user-select: none;
        background: rgba(0, 0, 0, 0.02);
      }
      .node-row.group:hover {
        background: rgba(41, 128, 185, 0.08);
      }
      .node-row.leaf {
        border-top: 1px solid rgba(0, 0, 0, 0.03);
      }
      .node-key {
        font-weight: 600;
        color: var(--color-text);
        white-space: nowrap;
      }
      .node-sep {
        color: var(--color-text-secondary);
      }
      .node-kind {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 54px;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--color-bg);
        color: var(--color-text-secondary);
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .node-count {
        font-size: 0.75rem;
        color: var(--color-text-secondary);
      }
      .node-value {
        display: inline-block;
        max-width: min(60vw, 760px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--color-bg);
        color: var(--color-text);
      }
      .node-actions {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-left: auto;
      }
      .action-chip {
        border: 1px solid rgba(41, 128, 185, 0.35);
        background: rgba(41, 128, 185, 0.08);
        color: var(--color-primary-light);
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 600;
        line-height: 1;
        padding: 5px 9px;
        text-decoration: none;
        cursor: pointer;
        font-family: inherit;
      }
      .action-chip:hover {
        background: rgba(41, 128, 185, 0.18);
        text-decoration: none;
      }
      .action-chip:disabled {
        opacity: 0.55;
        cursor: wait;
      }
      .node-empty {
        color: var(--color-text-secondary);
        font-size: 0.8rem;
        padding-top: 6px;
        padding-bottom: 8px;
        font-style: italic;
      }
      .node-children {
        padding-bottom: 4px;
      }

      @media (max-width: 900px) {
        .node-row {
          flex-wrap: wrap;
          padding-top: 4px;
          padding-bottom: 4px;
        }
        .node-actions {
          width: 100%;
          margin-left: 0;
        }
        .node-value {
          max-width: 100%;
        }
      }
    `,
  ],
})
export class AcpIndexViewComponent implements OnInit {
  readonly navigation = inject(AcpNavigationService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  acpId = '';
  breadcrumbs: BreadcrumbItem[] = [];

  loading = true;
  error = '';
  fileActionError = '';

  expandDepth = 2;
  busyFileId = '';

  rootNodes: IndexNode[] = [];
  private expandedNodeIds = new Set<string>();

  private unitIds = new Set<string>();
  private itemIds = new Set<string>();
  private moduleIds = new Set<string>();
  private fileByName = new Map<string, AcpFile>();

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.acpId = this.route.snapshot.paramMap.get('acpId') || '';
    this.breadcrumbs = [
      { label: 'Content Hub', route: ['/'] },
      { label: 'ACP', route: ['/view', this.acpId] },
      { label: 'ACP-Index' },
    ];

    combineLatest({
      index: this.api.getViewIndex(this.acpId),
      files: combineLatest([this.api.getAcpStartPage(this.acpId), this.auth.currentUser$]).pipe(
        map(([data, user]) =>
          Boolean(
            data.featureConfig?.allowFileDownload ||
            user?.isAppAdmin ||
            user?.acpRoles?.some(
              (role) => role.acpId === this.acpId && role.role === 'ACP_MANAGER',
            ),
          ),
        ),
        distinctUntilChanged(),
        switchMap((canListFiles) =>
          canListFiles
            ? this.api.getFiles(this.acpId).pipe(catchError(() => of([] as AcpFile[])))
            : of([] as AcpFile[]),
        ),
        catchError(() => of([] as AcpFile[])),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ index, files }) => {
          this.configureLookups(index, files);
          this.rootNodes = this.buildRoot(index);
          this.applyExpandDepth(this.expandDepth);
          this.loading = false;
        },
        error: () => {
          this.error = 'ACP-Index konnte nicht geladen werden.';
          this.loading = false;
        },
      });
  }

  formatPrimitive(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  applyExpandDepth(depth: number): void {
    this.expandDepth = depth;
    this.expandedNodeIds.clear();
    this.collectExpandedNodes(this.rootNodes, depth);
  }

  isExpanded(node: IndexNode): boolean {
    return this.expandedNodeIds.has(node.id);
  }

  onNodeToggle(node: IndexNode, detailsEl: HTMLDetailsElement, event: Event): void {
    if (event.target !== detailsEl) return;
    if (detailsEl.open) {
      this.expandedNodeIds.add(node.id);
    } else {
      this.expandedNodeIds.delete(node.id);
    }
  }

  async runFileAction(action: NodeAction, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (!action.fileId) return;
    this.fileActionError = '';

    if (action.kind === 'file-download') {
      window.open(this.api.getFileDownloadUrl(this.acpId, action.fileId), '_blank', 'noopener');
      return;
    }

    try {
      this.busyFileId = action.fileId;
      const downloadUrl = this.api.getFileDownloadUrl(this.acpId, action.fileId);
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const mime = this.resolveMimeType(action.fileName || '', blob.type);
      const preparedBlob = mime ? new Blob([blob], { type: mime }) : blob;
      const objectUrl = URL.createObjectURL(preparedBlob);
      window.open(objectUrl, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (_e) {
      this.fileActionError = `Datei konnte nicht geöffnet werden (${action.fileName || action.fileId}).`;
    } finally {
      this.busyFileId = '';
    }
  }

  private configureLookups(index: any, files: AcpFile[]): void {
    this.unitIds.clear();
    this.itemIds.clear();
    this.moduleIds.clear();
    this.fileByName.clear();

    for (const file of files) {
      if (!file?.originalName) continue;
      this.fileByName.set(file.originalName, file);
    }

    const units = this.getUnits(index);
    for (const unit of units) {
      const unitId = typeof unit?.id === 'string' ? unit.id.trim() : '';
      if (!unitId) continue;
      this.unitIds.add(unitId);

      for (const item of Array.isArray(unit?.items) ? unit.items : []) {
        const itemId = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!itemId) continue;
        this.itemIds.add(itemId);
        if (item?.useUnitAliasAsPrefix !== false) {
          this.itemIds.add(`${unitId}_${itemId}`);
        }
      }
    }

    for (const part of this.getAssessmentParts(index)) {
      for (const moduleEntry of Array.isArray(part?.bookletModules) ? part.bookletModules : []) {
        const moduleId = typeof moduleEntry?.id === 'string' ? moduleEntry.id.trim() : '';
        if (moduleId) {
          this.moduleIds.add(moduleId);
        }
      }
    }
  }

  private buildRoot(index: any): IndexNode[] {
    if (!index || typeof index !== 'object') return [];
    return this.buildChildren(index, '', 0);
  }

  private collectExpandedNodes(nodes: IndexNode[], depth: number): void {
    for (const node of nodes) {
      if (node.kind !== 'value' && node.depth <= depth) {
        this.expandedNodeIds.add(node.id);
      }
      if (node.children.length) {
        this.collectExpandedNodes(node.children, depth);
      }
    }
  }

  private buildChildren(value: any, path: string, depth: number): IndexNode[] {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        this.buildNode(`[${index}]`, entry, this.joinPath(path, index, true), depth),
      );
    }

    if (value && typeof value === 'object') {
      return Object.entries(value).map(([key, entry]) =>
        this.buildNode(key, entry, this.joinPath(path, key, false), depth),
      );
    }

    return [];
  }

  private buildNode(label: string, value: unknown, path: string, depth: number): IndexNode {
    const kind: NodeKind = Array.isArray(value)
      ? 'array'
      : value && typeof value === 'object'
        ? 'object'
        : 'value';

    const children = kind === 'value' ? [] : this.buildChildren(value as any, path, depth + 1);

    return {
      id: path || label,
      label,
      path,
      depth,
      kind,
      value,
      children,
      actions: this.resolveActions(path, value),
    };
  }

  private resolveActions(path: string, value: unknown): NodeAction[] {
    if (typeof value !== 'string') return [];
    const raw = value.trim();
    if (!raw) return [];

    const actions: NodeAction[] = [];

    const file = this.resolveFileReference(raw);
    if (file) {
      const viewable = this.isViewableFile(file);
      const bookletPath = path.toLowerCase().endsWith('definitionid');
      actions.push({
        id: `file:${file.id}:${viewable ? 'view' : 'download'}`,
        kind: viewable ? 'file-view' : 'file-download',
        label: bookletPath
          ? viewable
            ? 'Booklet ansehen'
            : 'Booklet downloaden'
          : viewable
            ? 'Datei ansehen'
            : 'Datei downloaden',
        fileId: file.id,
        fileName: file.originalName,
        title: file.originalName,
      });
    }

    if (this.moduleIds.has(raw)) {
      actions.push({
        id: `sequence:${raw}`,
        kind: 'route',
        label: 'Aufgabenfolge öffnen',
        route: ['/view', this.acpId, 'sequence', raw],
      });
    }

    if (this.unitIds.has(raw)) {
      actions.push({
        id: `unit:${raw}`,
        kind: 'route',
        label: 'Aufgabe öffnen',
        route: ['/view', this.acpId, 'unit', raw],
      });
    }

    if (this.itemIds.has(raw)) {
      actions.push({
        id: `item:${raw}`,
        kind: 'route',
        label: 'Item öffnen',
        route: ['/view', this.acpId, 'item', raw],
      });
    }

    return actions;
  }

  private resolveFileReference(reference: string): AcpFile | undefined {
    const direct = this.fileByName.get(reference);
    if (direct) return direct;

    const withJson = this.fileByName.get(`${reference}.json`);
    if (withJson) return withJson;

    const playerRefMatch = reference.match(/^([a-z0-9-]+)@([0-9]+\.[0-9]+)/i);
    if (playerRefMatch) {
      const base = playerRefMatch[1].toLowerCase();
      const version = playerRefMatch[2];
      return Array.from(this.fileByName.values()).find((file) => {
        const name = file.originalName.toLowerCase();
        return name.includes(base) && name.includes(version) && name.endsWith('.html');
      });
    }

    return undefined;
  }

  private isViewableFile(file: AcpFile): boolean {
    const ext = this.getExtension(file.originalName);
    const mime = (file.fileType || '').toLowerCase();
    const viewableExt = new Set([
      'htm',
      'html',
      'xml',
      'json',
      'txt',
      'csv',
      'md',
      'png',
      'jpg',
      'jpeg',
      'gif',
      'svg',
      'webp',
    ]);
    if (viewableExt.has(ext)) return true;
    if (mime.startsWith('text/')) return true;
    if (mime.startsWith('image/')) return true;
    if (mime === 'application/json' || mime === 'application/xml') {
      return true;
    }
    return false;
  }

  private resolveMimeType(fileName: string, fallbackMime: string): string {
    const ext = this.getExtension(fileName);
    const byExt: Record<string, string> = {
      html: 'text/html',
      htm: 'text/html',
      xml: 'application/xml',
      json: 'application/json',
      txt: 'text/plain',
      csv: 'text/csv',
      md: 'text/markdown',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
    };
    return byExt[ext] || fallbackMime;
  }

  private getExtension(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
  }

  private getAssessmentParts(index: any): any[] {
    return Array.isArray(index?.assessmentParts) ? index.assessmentParts : [];
  }

  private getUnits(index: any): any[] {
    const fromParts = this.getAssessmentParts(index).flatMap((part) =>
      Array.isArray(part?.units) ? part.units : [],
    );
    if (fromParts.length) return fromParts;
    return Array.isArray(index?.units) ? index.units : [];
  }

  private joinPath(path: string, segment: string | number, isIndex: boolean): string {
    if (!path) {
      return isIndex ? `[${segment}]` : `${segment}`;
    }
    return isIndex ? `${path}[${segment}]` : `${path}.${segment}`;
  }
}
