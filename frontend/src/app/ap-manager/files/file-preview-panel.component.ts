import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  ApFile,
  FilePreviewResponse,
  FileStructuredPreviewData,
} from '../../core/models/api.models';

type PreviewTab = 'render' | 'structured' | 'raw';

@Component({
  selector: 'app-file-preview-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="preview-card card">
      <div class="preview-header">
        <div>
          <div class="eyebrow">Dateivorschau</div>
          @if (file) {
            <h2>{{ file.originalName }}</h2>
            <div class="preview-meta">
              <span>{{ formatSize(file.fileSize) }}</span>
              <span>{{ file.fileType || 'Unbekannter Typ' }}</span>
            </div>
          } @else {
            <h2>Keine Datei ausgewählt</h2>
          }
        </div>
        @if (downloadUrl) {
          <a class="btn btn-outline btn-sm" [href]="downloadUrl" target="_blank">⬇ Download</a>
        }
      </div>

      @if (!file) {
        <div class="empty-state preview-empty">
          <h3>Datei auswählen</h3>
          <p>Wähle in der Tabelle eine Datei aus, um Inhalt und Struktur direkt anzusehen.</p>
        </div>
      } @else if (loading) {
        <div class="empty-state preview-empty">
          <h3>Vorschau wird geladen...</h3>
        </div>
      } @else if (error) {
        <div class="alert alert-danger">{{ error }}</div>
      } @else if (!preview) {
        <div class="empty-state preview-empty">
          <h3>Keine Vorschau verfügbar</h3>
        </div>
      } @else {
        @if (showTabs) {
          <div class="preview-tabs" role="group" aria-label="Vorschauformat">
            @if (hasRenderTab) {
              <button
                class="tab"
                type="button"
                [class.active]="activeTab === 'render'"
                [attr.aria-pressed]="activeTab === 'render'"
                (click)="activeTab = 'render'"
              >
                Medien
              </button>
            }
            @if (hasStructuredTab) {
              <button
                class="tab"
                type="button"
                [class.active]="activeTab === 'structured'"
                [attr.aria-pressed]="activeTab === 'structured'"
                (click)="activeTab = 'structured'"
              >
                Struktur
              </button>
            }
            @if (hasRawTab) {
              <button
                class="tab"
                type="button"
                [class.active]="activeTab === 'raw'"
                [attr.aria-pressed]="activeTab === 'raw'"
                (click)="activeTab = 'raw'"
              >
                Rohdaten
              </button>
            }
          </div>
        }

        @if (activeTab === 'render' && hasRenderTab) {
          <div class="render-surface">
            @switch (preview.mode) {
              @case ('image') {
                <img class="preview-image" [src]="inlineUrl" [alt]="file.originalName" />
              }
              @case ('pdf') {
                <iframe class="preview-frame" [src]="inlineUrl" title="PDF-Vorschau"></iframe>
              }
              @case ('audio') {
                <audio class="preview-audio" controls [src]="inlineUrl"></audio>
              }
              @case ('video') {
                <video class="preview-video" controls [src]="inlineUrl"></video>
              }
            }
          </div>
        }

        @if (activeTab === 'structured' && hasStructuredTab && structuredData) {
          <div class="structured-surface">
            @switch (structuredData.type) {
              @case ('unit-xml') {
                <div class="stats-grid">
                  <div class="stat-card">
                    <span class="stat-label">Aufgaben-ID</span>
                    <code>{{ structuredData.unitId }}</code>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Label</span>
                    <span>{{ structuredData.unitLabel || '–' }}</span>
                  </div>
                </div>
                @if (structuredData.description) {
                  <div class="info-block">
                    <strong>Beschreibung</strong>
                    <p>{{ structuredData.description }}</p>
                  </div>
                }
                <div class="info-block">
                  <strong>Referenzen</strong>
                  <dl class="data-list">
                    <dt>Definition</dt>
                    <dd>
                      <code>{{ structuredData.references.definition || '–' }}</code>
                    </dd>
                    <dt>Player</dt>
                    <dd>
                      <code>{{ structuredData.references.player || '–' }}</code>
                    </dd>
                    <dt>Kodierschema</dt>
                    <dd>
                      <code>{{ structuredData.references.codingScheme || '–' }}</code>
                    </dd>
                    <dt>Metadaten</dt>
                    <dd>
                      <code>{{ structuredData.references.metadata || '–' }}</code>
                    </dd>
                  </dl>
                </div>
              }
              @case ('vomd') {
                <div class="stats-grid">
                  <div class="stat-card">
                    <span class="stat-label">Items</span>
                    <strong>{{ structuredData.itemCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Aufgabenprofile</span>
                    <strong>{{ structuredData.unitProfileCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Metadaten-Spalten</span>
                    <strong>{{ structuredData.metadataColumns.length }}</strong>
                  </div>
                </div>

                @if (structuredData.unitProfiles.length) {
                  <div class="info-block">
                    <strong>Aufgabenprofile</strong>
                    <dl class="data-list">
                      @for (entry of structuredData.unitProfiles; track entry.id) {
                        <dt>{{ entry.label }}</dt>
                        <dd>{{ entry.value || '–' }}</dd>
                      }
                    </dl>
                  </div>
                }

                @if (structuredData.items.length) {
                  <div class="table-wrapper">
                    <table class="preview-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Player-Variable</th>
                          <th>Quellvariable</th>
                          <th>Interne Variablen-ID</th>
                          @for (column of structuredData.metadataColumns; track column.id) {
                            <th>{{ column.label }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (item of structuredData.items; track item.id) {
                          <tr>
                            <td>
                              <div class="cell-title">{{ item.id }}</div>
                              @if (item.description) {
                                <div class="cell-subtitle">{{ item.description }}</div>
                              }
                            </td>
                            <td>
                              <code>{{ item.variableId || '–' }}</code>
                            </td>
                            <td>
                              <code>{{ item.sourceVariable || '–' }}</code>
                            </td>
                            <td>
                              <code>{{ item.variableReadOnlyId || '–' }}</code>
                            </td>
                            @for (column of structuredData.metadataColumns; track column.id) {
                              <td>{{ item.metadata[column.id] || '–' }}</td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              }
              @case ('vocs') {
                <div class="stats-grid">
                  <div class="stat-card">
                    <span class="stat-label">Variablen</span>
                    <strong>{{ structuredData.variableCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Codes</span>
                    <strong>{{ structuredData.codeCount }}</strong>
                  </div>
                </div>

                <div class="variable-list">
                  @for (variable of structuredData.variables; track variable.id) {
                    <div class="variable-card">
                      <div class="variable-header">
                        <strong>{{ variable.label || variable.id }}</strong>
                        <code>{{ variable.id }}</code>
                      </div>
                      @if (variable.manualInstruction) {
                        <div
                          class="manual-note"
                          [innerHTML]="
                            sanitizer.bypassSecurityTrustHtml(variable.manualInstruction)
                          "
                        ></div>
                      }
                      <div class="codes-list">
                        @for (code of variable.codes; track code.id + '-' + code.score) {
                          <div class="code-row">
                            <span class="code-id">{{ code.id }}</span>
                            <span class="code-score">{{ code.score || '–' }}</span>
                            <span class="code-label">{{ code.label || '–' }}</span>
                          </div>
                          @if (code.manualInstruction) {
                            <div
                              class="code-manual"
                              [innerHTML]="
                                sanitizer.bypassSecurityTrustHtml(code.manualInstruction)
                              "
                            ></div>
                          }
                        }
                      </div>
                    </div>
                  }
                </div>
              }
              @case ('voud') {
                <div class="stats-grid">
                  <div class="stat-card">
                    <span class="stat-label">Seiten</span>
                    <strong>{{ structuredData.pageCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Variablen-Refs</span>
                    <strong>{{ structuredData.variableRefCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Top-Level Keys</span>
                    <strong>{{ structuredData.topLevelKeys.length }}</strong>
                  </div>
                </div>

                <div class="info-block">
                  <strong>Top-Level Keys</strong>
                  <div class="pill-list">
                    @for (key of structuredData.topLevelKeys; track key) {
                      <span class="pill">{{ key }}</span>
                    }
                  </div>
                </div>

                @if (structuredData.identifierPreview.length) {
                  <div class="info-block">
                    <strong>Identifier-Vorschau</strong>
                    <div class="pill-list">
                      @for (identifier of structuredData.identifierPreview; track identifier) {
                        <code class="pill">{{ identifier }}</code>
                      }
                    </div>
                  </div>
                }

                <div class="page-list">
                  @for (page of structuredData.pages; track page.pageNumber) {
                    <div class="page-card">
                      <div class="page-header">
                        <strong>Seite {{ page.pageNumber }}</strong>
                      </div>
                      <div class="page-section">
                        <span class="section-label">Variablen</span>
                        <div class="pill-list">
                          @for (ref of page.variableRefs; track ref) {
                            <code class="pill">{{ ref }}</code>
                          }
                        </div>
                      </div>
                      @if (page.alwaysVisible.length) {
                        <div class="page-section">
                          <span class="section-label">Always Visible</span>
                          <div class="pill-list">
                            @for (entry of page.alwaysVisible; track entry) {
                              <code class="pill">{{ entry }}</code>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
              @case ('csv') {
                <div class="stats-grid">
                  <div class="stat-card">
                    <span class="stat-label">Zeilen</span>
                    <strong>{{ structuredData.rowCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Spalten</span>
                    <strong>{{ structuredData.columnCount }}</strong>
                  </div>
                  <div class="stat-card">
                    <span class="stat-label">Trennzeichen</span>
                    <code>{{ structuredData.delimiter }}</code>
                  </div>
                </div>

                <div class="table-wrapper">
                  <table class="preview-table">
                    <thead>
                      <tr>
                        @for (header of structuredData.headers; track $index) {
                          <th>{{ header || 'Spalte ' + ($index + 1) }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of structuredData.rows; track $index) {
                        <tr>
                          @for (cell of row; track $index) {
                            <td>{{ cell || '–' }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            }
          </div>
        }

        @if (activeTab === 'raw' && hasRawTab) {
          @if (preview.textFormat === 'html') {
            <div class="alert alert-info">
              HTML-Dateien werden hier aus Sicherheitsgründen als Quelltext angezeigt.
            </div>
          }
          @if (preview.truncated) {
            <div class="alert alert-warning">
              Die Rohansicht ist gekürzt. Angezeigt wird nur ein Ausschnitt der Datei.
            </div>
          }
          <div class="raw-meta">
            @if (preview.lineCount) {
              <span>{{ preview.lineCount }} Zeilen</span>
            }
            @if (preview.characterCount) {
              <span>{{ preview.characterCount }} Zeichen</span>
            }
            @if (preview.textFormat) {
              <span>{{ preview.textFormat.toUpperCase() }}</span>
            }
          </div>
          <pre class="raw-content"><code>{{ preview.textContent }}</code></pre>
        }

        @if (preview.mode === 'binary') {
          <div class="empty-state preview-empty">
            <h3>Keine Inline-Vorschau</h3>
            <p>Für diesen Dateityp steht aktuell nur Download zur Verfügung.</p>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .preview-card {
        min-height: 480px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .preview-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .preview-header h2 {
        margin: 4px 0 0;
        font-size: 1.15rem;
        word-break: break-word;
      }
      .eyebrow {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
      }
      .preview-meta,
      .raw-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }
      .preview-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .tab {
        border: 1px solid var(--color-border);
        background: #fff;
        padding: 8px 12px;
        border-radius: 999px;
        cursor: pointer;
        font: inherit;
      }
      .tab.active {
        background: var(--color-primary);
        color: var(--color-on-primary);
        border-color: var(--color-primary);
        font-weight: 700;
      }
      .render-surface,
      .structured-surface {
        min-height: 320px;
      }
      .preview-image,
      .preview-video,
      .preview-frame {
        width: 100%;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: #fff;
      }
      .preview-image {
        max-height: 70vh;
        object-fit: contain;
      }
      .preview-video,
      .preview-frame {
        min-height: 420px;
      }
      .preview-audio {
        width: 100%;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 12px;
      }
      .stat-card {
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 10px 12px;
        background: var(--color-bg-soft, #f8f9fb);
      }
      .stat-label,
      .section-label {
        display: block;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-text-secondary);
        margin-bottom: 6px;
      }
      .info-block,
      .variable-card,
      .page-card {
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 12px;
        background: #fff;
      }
      .structured-surface,
      .variable-list,
      .page-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .data-list {
        display: grid;
        grid-template-columns: minmax(110px, auto) 1fr;
        gap: 8px 12px;
        margin: 8px 0 0;
      }
      .data-list dt {
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .data-list dd {
        margin: 0;
      }
      .table-wrapper {
        overflow: auto;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
      }
      .preview-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 480px;
      }
      .preview-table th,
      .preview-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--color-border);
        text-align: left;
        vertical-align: top;
        font-size: 0.9rem;
      }
      .preview-table th {
        background: var(--color-bg-soft, #f8f9fb);
        font-weight: 700;
      }
      .cell-title {
        font-weight: 600;
      }
      .cell-subtitle {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
        margin-top: 4px;
      }
      .variable-header,
      .page-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .manual-note,
      .code-manual {
        margin-top: 8px;
        padding: 8px 10px;
        background: rgba(243, 156, 18, 0.08);
        border-left: 3px solid #f39c12;
        border-radius: 6px;
        font-size: 0.85rem;
      }
      .codes-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
      }
      .code-row {
        display: grid;
        grid-template-columns: 90px 80px 1fr;
        gap: 8px;
        font-size: 0.85rem;
      }
      .code-id,
      .code-score {
        font-family: monospace;
      }
      .code-score {
        color: #1f7a45;
      }
      .pill-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--color-bg-soft, #f3f5f8);
        border: 1px solid var(--color-border);
        font-size: 0.82rem;
      }
      .page-section + .page-section {
        margin-top: 10px;
      }
      .raw-content {
        margin: 0;
        padding: 14px;
        border-radius: var(--radius);
        background: #111827;
        color: #f3f4f6;
        font-size: 0.8rem;
        line-height: 1.5;
        overflow: auto;
        max-height: 70vh;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .preview-empty {
        min-height: 280px;
      }
      @media (max-width: 900px) {
        .preview-header {
          flex-direction: column;
        }
        .code-row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class FilePreviewPanelComponent implements OnChanges {
  @Input() file: ApFile | null = null;
  @Input() preview: FilePreviewResponse | null = null;
  @Input() inlineUrl = '';
  @Input() downloadUrl = '';
  @Input() loading = false;
  @Input() error = '';

  activeTab: PreviewTab = 'raw';

  constructor(public sanitizer: DomSanitizer) {}

  ngOnChanges() {
    if (this.hasStructuredTab) {
      this.activeTab = 'structured';
      return;
    }

    if (this.hasRenderTab) {
      this.activeTab = 'render';
      return;
    }

    this.activeTab = 'raw';
  }

  get structuredData(): FileStructuredPreviewData | null {
    return this.preview?.structuredData || null;
  }

  get hasStructuredTab(): boolean {
    return !!this.preview?.structuredData;
  }

  get hasRawTab(): boolean {
    return typeof this.preview?.textContent === 'string';
  }

  get hasRenderTab(): boolean {
    return ['image', 'pdf', 'audio', 'video'].includes(this.preview?.mode || '');
  }

  get showTabs(): boolean {
    return [this.hasRenderTab, this.hasStructuredTab, this.hasRawTab].filter(Boolean).length > 1;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
