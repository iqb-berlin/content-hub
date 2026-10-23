import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import {
  Acp,
  AcpIndexGenerationPreview,
  AcpIndexMigrationPreview,
  AcpIndexValidationReport,
} from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';

@Component({
  selector: 'app-acp-index-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, AcpManagerContextComponent],
  template: `
    <app-acp-manager-context />
    <div class="page-header"><h1>ACP-Index 0.6</h1></div>
    @if (acp?.acpIndexValidationStatus) {
      <div
        class="alert"
        [class.alert-warning]="acp?.acpIndexValidationStatus === 'LEGACY_NONCONFORMANT'"
      >
        Bestandsstatus: {{ acp?.acpIndexValidationStatus }} · Schema:
        {{ acp?.acpIndexSchemaId || 'unbekannt' }}
      </div>
    }
    @if (message) {
      <div class="alert alert-success">{{ message }}</div>
    }
    @if (error) {
      <div class="alert alert-error">{{ error }}</div>
    }

    <div class="card">
      <h3>Header und Metadaten</h3>
      <div class="form-grid">
        <label>Paket-ID<input [(ngModel)]="header.packageId" disabled /></label>
        <label>Version<input [(ngModel)]="header.version" placeholder="1.0.0" /></label>
        <label>Name (de)<input [(ngModel)]="header.nameDe" /></label>
        <label>Beschreibung (de)<input [(ngModel)]="header.descriptionDe" /></label>
        <label>Maintainer<input [(ngModel)]="header.maintainerName" /></label>
        <label>Maintainer-URL<input [(ngModel)]="header.maintainerUrl" /></label>
      </div>
      <label
        >Metadaten (metadata-values@3.0 JSON)
        <textarea [(ngModel)]="metadataJson" rows="8"></textarea>
      </label>
      <div class="toolbar">
        <button class="btn btn-primary" (click)="saveHeader()" [disabled]="busy">Speichern</button>
        <button class="btn btn-outline" (click)="validate()" [disabled]="busy">Validieren</button>
      </div>
    </div>

    <div class="card">
      <h3>Konformität und Veröffentlichung</h3>
      @if (validation) {
        <p>
          Schema: <strong>{{ validation.valid ? 'gültig' : 'ungültig' }}</strong> ·
          Veröffentlichung: <strong>{{ validation.publishable ? 'möglich' : 'blockiert' }}</strong>
        </p>
        @for (issue of validation.issues; track issue.code + issue.path) {
          <div class="issue" [class.error]="issue.severity === 'error'">
            <code>{{ issue.path }}</code> — {{ issue.message }}
          </div>
        }
        @for (check of validation.externalChecks; track check.url) {
          <div class="issue">
            <code>{{ check.url }}</code> — {{ check.status }}
          </div>
        }
      }
      <div class="toolbar">
        @if (isReleased) {
          <button class="btn btn-outline" (click)="reopen()" [disabled]="busy">
            Wieder öffnen
          </button>
        } @else {
          <button class="btn btn-primary" (click)="publish('RELEASED_PUBLIC')" [disabled]="busy">
            Öffentlich veröffentlichen
          </button>
          <button
            class="btn btn-outline"
            (click)="publish('RELEASED_CONFIDENTIAL')"
            [disabled]="busy"
          >
            Vertraulich veröffentlichen
          </button>
        }
      </div>
    </div>

    <div class="card">
      <h3>Legacy-Migration</h3>
      <div class="toolbar">
        <button class="btn btn-outline" (click)="previewMigration()" [disabled]="busy">
          Migration prüfen
        </button>
        <button
          class="btn btn-primary"
          (click)="applyMigration()"
          [disabled]="busy || !migration?.validation?.valid"
        >
          Migration übernehmen
        </button>
      </div>
      @if (migration) {
        @for (change of migration.changes; track change.path + change.message) {
          <div class="issue">
            <code>{{ change.path }}</code> — {{ change.message }}
          </div>
        }
        @for (issue of migration.unresolved; track issue.code + issue.path) {
          <div class="issue error">
            <code>{{ issue.path }}</code> — {{ issue.message }}
          </div>
        }
      }
    </div>

    <div class="card">
      <h3>Index aus Dateien erzeugen</h3>
      <div class="toolbar">
        <button class="btn btn-outline" (click)="previewGeneration()" [disabled]="busy">
          Vorschau erzeugen
        </button>
        <button
          class="btn btn-primary"
          (click)="applyGeneration()"
          [disabled]="busy || !generation?.canApply"
        >
          Übernehmen
        </button>
      </div>
      @if (generation) {
        @for (path of generation.unassignedUnitPaths; track path) {
          <div class="assignment">
            <code>{{ path }}</code>
            <input [(ngModel)]="partAssignments[path]" placeholder="Part-ID" />
            <label><input type="checkbox" [(ngModel)]="omitted[path]" /> bewusst auslassen</label>
          </div>
        }
        @for (booklet of generation.ambiguousBooklets; track booklet.path) {
          <div class="assignment">
            <code>{{ booklet.path }}</code>
            <select [(ngModel)]="partAssignments[booklet.path]">
              <option value="">Part wählen</option>
              @for (part of booklet.possibleParts; track part) {
                <option [value]="part">{{ part }}</option>
              }
            </select>
          </div>
        }
        @for (warning of generation.warnings; track warning) {
          <div class="issue">{{ warning }}</div>
        }
        <details>
          <summary>JSON-Diff ({{ generation.diff.length }} Änderungen)</summary>
          <pre>{{ generation.diff | json }}</pre>
        </details>
      }
    </div>

    <div class="card">
      <h3>Komplexe Struktur als validiertes JSON</h3>
      <p>
        Assessment-Parts, Skalen und Coding-Parameter können hier vollständig importiert werden.
      </p>
      <textarea [(ngModel)]="fullIndexJson" rows="18"></textarea>
      <button class="btn btn-primary" (click)="saveFullJson()" [disabled]="busy">
        JSON validieren und speichern
      </button>
    </div>
  `,
  styles: [
    `
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 5px;
        font-size: 0.85rem;
      }
      input,
      textarea,
      select {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
      }
      textarea {
        font-family: monospace;
      }
      .card {
        margin-bottom: 18px;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .issue {
        padding: 7px 9px;
        margin: 5px 0;
        background: var(--color-bg);
        border-left: 3px solid #d7a11e;
      }
      .issue.error {
        border-left-color: #b42318;
      }
      .assignment {
        display: grid;
        grid-template-columns: minmax(250px, 1fr) minmax(140px, 240px) auto;
        gap: 10px;
        align-items: center;
        margin: 8px 0;
      }
      .assignment label {
        flex-direction: row;
        align-items: center;
      }
      .assignment label input {
        width: auto;
      }
      pre {
        max-height: 320px;
        overflow: auto;
        background: var(--color-bg);
        padding: 12px;
      }
    `,
  ],
})
export class AcpIndexManagerComponent implements OnInit {
  acpId = '';
  acp: Acp | null = null;
  busy = false;
  error = '';
  message = '';
  validation: AcpIndexValidationReport | null = null;
  migration: AcpIndexMigrationPreview | null = null;
  generation: AcpIndexGenerationPreview | null = null;
  partAssignments: Record<string, string> = {};
  omitted: Record<string, boolean> = {};
  metadataJson = '';
  fullIndexJson = '';
  header = {
    packageId: '',
    version: '',
    nameDe: '',
    descriptionDe: '',
    maintainerName: '',
    maintainerUrl: '',
  };

  get isReleased() {
    return ['RELEASED_PUBLIC', 'RELEASED_CONFIDENTIAL'].includes(
      String(this.acp?.acpIndex?.['status'] || ''),
    );
  }

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.acpId = this.route.snapshot.paramMap.get('acpId') || '';
    this.load();
  }

  load() {
    this.api.getAcp(this.acpId).subscribe({
      next: (acp) => {
        this.acp = acp;
        const index = acp.acpIndex || {};
        this.header = {
          packageId: acp.packageId,
          version: typeof index['version'] === 'string' ? index['version'] : '',
          nameDe: this.localized(index['name'], 'de'),
          descriptionDe: this.localized(index['description'], 'de'),
          maintainerName:
            typeof index['maintainerName'] === 'string' ? index['maintainerName'] : '',
          maintainerUrl: typeof index['maintainerUrl'] === 'string' ? index['maintainerUrl'] : '',
        };
        this.metadataJson = index['metadata'] ? JSON.stringify(index['metadata'], null, 2) : '';
        this.fullIndexJson = JSON.stringify(index, null, 2);
      },
      error: (error) => this.fail(error),
    });
  }

  saveHeader() {
    if (!this.acp) return;
    try {
      const index = { ...this.acp.acpIndex };
      index['version'] = this.header.version;
      index['name'] = this.upsertLocalized(index['name'], 'de', this.header.nameDe);
      if (this.header.descriptionDe)
        index['description'] = this.upsertLocalized(
          index['description'],
          'de',
          this.header.descriptionDe,
        );
      else delete index['description'];
      this.assignOptional(index, 'maintainerName', this.header.maintainerName);
      this.assignOptional(index, 'maintainerUrl', this.header.maintainerUrl);
      if (this.metadataJson.trim()) index['metadata'] = JSON.parse(this.metadataJson);
      else delete index['metadata'];
      this.saveIndex(index, 'Header gespeichert.');
    } catch (error) {
      this.fail(error);
    }
  }

  saveFullJson() {
    try {
      this.saveIndex(JSON.parse(this.fullIndexJson), 'Index gespeichert.');
    } catch (error) {
      this.fail(error);
    }
  }

  validate() {
    this.run(this.api.validateAcpIndex(this.acpId), (report) => {
      this.validation = report;
    });
  }
  previewMigration() {
    this.run(this.api.previewAcpIndexMigration(this.acpId), (preview) => {
      this.migration = preview;
    });
  }
  applyMigration() {
    if (!this.migration) return;
    this.run(this.api.migrateAcpIndex(this.acpId, this.migration.sourceUpdatedAt), () => {
      this.message = 'Migration übernommen und Snapshot erstellt.';
      this.load();
    });
  }
  previewGeneration() {
    const omittedUnitPaths = Object.entries(this.omitted)
      .filter(([, value]) => value)
      .map(([path]) => path);
    this.run(
      this.api.previewIndexGeneration(this.acpId, {
        partAssignments: this.partAssignments,
        omittedUnitPaths,
      }),
      (preview) => {
        this.generation = preview;
        this.partAssignments = { ...preview.assignments, ...this.partAssignments };
      },
    );
  }
  applyGeneration() {
    if (!this.generation) return;
    const omittedUnitPaths = Object.entries(this.omitted)
      .filter(([, value]) => value)
      .map(([path]) => path);
    this.run(
      this.api.applyIndexGeneration(this.acpId, {
        sourceRevision: this.generation.sourceRevision,
        expectedUpdatedAt: this.generation.sourceUpdatedAt,
        partAssignments: this.partAssignments,
        omittedUnitPaths,
      }),
      () => {
        this.message = 'Index erzeugt und Snapshot erstellt.';
        this.load();
      },
    );
  }
  publish(status: 'RELEASED_PUBLIC' | 'RELEASED_CONFIDENTIAL') {
    if (!this.acp) return;
    this.run(this.api.publishAcpIndex(this.acpId, status, this.acp.updatedAt), () => {
      this.message = 'ACP veröffentlicht.';
      this.load();
    });
  }
  reopen() {
    if (!this.acp) return;
    this.run(this.api.reopenAcpIndex(this.acpId, this.acp.updatedAt), () => {
      this.message = 'ACP wieder geöffnet; Snapshot wurde erstellt.';
      this.load();
    });
  }

  private saveIndex(index: Record<string, any>, message: string) {
    if (!this.acp) return;
    this.run(this.api.updateAcpIndex(this.acpId, index, this.acp.updatedAt), () => {
      this.message = message;
      this.load();
    });
  }
  private run<T>(request: Observable<T>, success: (value: T) => void) {
    this.busy = true;
    this.error = '';
    this.message = '';
    request.subscribe({
      next: (value: T) => {
        this.busy = false;
        success(value);
      },
      error: (error: unknown) => {
        this.busy = false;
        this.fail(error);
      },
    });
  }
  private fail(error: any) {
    this.error = error?.error?.message || error?.message || String(error);
  }
  private localized(value: any, lang: string) {
    return Array.isArray(value) ? value.find((entry) => entry?.lang === lang)?.value || '' : '';
  }
  private upsertLocalized(value: any, lang: string, text: string) {
    const entries = Array.isArray(value) ? [...value] : [];
    const index = entries.findIndex((entry) => entry?.lang === lang);
    if (index >= 0) entries[index] = { lang, value: text };
    else entries.push({ lang, value: text });
    return entries;
  }
  private assignOptional(target: Record<string, any>, key: string, value: string) {
    if (value.trim()) target[key] = value.trim();
    else delete target[key];
  }
}
