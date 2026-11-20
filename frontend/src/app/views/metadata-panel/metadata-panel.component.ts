import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UnitViewData } from '../../core/models/api.models';
import { CodingSchemeTextFactory, CodingAsText } from '@iqb/responses';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-metadata-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="panel card">
      <h3>Metadaten</h3>
      @if (unit) {
        <dl class="meta-grid">
          <dt>Aufgaben-ID</dt>
          <dd>{{ unit.id }}</dd>
          <dt>Name</dt>
          <dd>{{ unit.name }}</dd>
          @if (unit.lang) {
            <dt>Sprache</dt>
            <dd>{{ unit.lang }}</dd>
          }
          @if (unit.description) {
            <dt>Beschreibung</dt>
            <dd>{{ unit.description }}</dd>
          }
        </dl>

        @if (unit.items && unit.items.length) {
          <h4>Items</h4>
          <div class="item-list">
            @for (item of unit.items; track item.id) {
              <div class="item-row" [class.highlighted]="item.id === highlightItemId">
                <span class="item-name">{{ item.name || item.id }}</span>
                <span class="variable-refs">
                  @if (item.variableId) {
                    <code title="Player-Variable">Player: {{ item.variableId }}</code>
                  }
                  @if (item.sourceVariable) {
                    <code title="Quellvariable">Quelle: {{ item.sourceVariable }}</code>
                  }
                  @if (item.variableReadOnlyId) {
                    <code title="Interne Variablen-ID">Intern: {{ item.variableReadOnlyId }}</code>
                  }
                </span>
              </div>
            }
          </div>
        }

        @if (codingSchemeAsText) {
          <h4>Kodierschema</h4>
          <div class="coding-scheme-view">
            @for (coding of codingSchemeAsText; track coding.id) {
              <div class="coding-item">
                <div class="coding-item-header">
                  <strong>{{ coding.label || coding.id }}</strong>
                </div>
                @if ($any(coding).manualInstructionText) {
                  <div class="global-manual-instruction">
                    <strong>📖 Variable-Instruktion:</strong>
                    <div
                      class="html-content"
                      [innerHTML]="
                        sanitizer.bypassSecurityTrustHtml($any(coding).manualInstructionText)
                      "
                    ></div>
                  </div>
                }
                <div class="codes-list">
                  @for (code of coding.codes; track code.id) {
                    <div class="code-row-container">
                      <div class="code-row">
                        <span class="code-id">{{ code.id }}</span>
                        <span class="code-score">({{ code.score }})</span>
                        <span class="code-label">{{ code.label }}</span>
                        @if (code.hasManualInstruction) {
                          <span class="manual-icon-tiny" title="Manuelle Prüfung erforderlich"
                            >📝</span
                          >
                        }
                      </div>
                      @if ($any(code).manualInstructionText) {
                        <div class="code-manual-instruction">
                          <strong>Instruktion:</strong>
                          <div
                            class="html-content"
                            [innerHTML]="
                              sanitizer.bypassSecurityTrustHtml($any(code).manualInstructionText)
                            "
                          ></div>
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }

        @if (unit.dependencies && unit.dependencies.length) {
          <h4>Abhängigkeiten</h4>
          @for (dep of unit.dependencies; track dep.fileId) {
            <div class="dep-item">
              <span class="badge badge-info">{{ dep.type }}</span>
              <a [href]="dep.downloadUrl" target="_blank">{{ dep.originalName }}</a>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .panel {
        max-height: 80vh;
        overflow-y: auto;
      }
      h4 {
        margin: 16px 0 8px;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        border-top: 1px solid var(--color-border);
        padding-top: 12px;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 16px;
        font-size: 0.9rem;
      }
      dt {
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .item-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .item-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .item-row.highlighted {
        background: rgba(41, 128, 185, 0.12);
        border-left: 3px solid var(--color-primary-light);
      }
      .variable-refs {
        display: inline-flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 0.35rem;
      }
      .variable-refs code {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }
      .json-view {
        background: var(--color-bg);
        padding: 12px;
        border-radius: var(--radius);
        font-size: 0.75rem;
        max-height: 200px;
        overflow: auto;
      }
      .coding-scheme-view {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 8px;
      }
      .coding-item {
        padding: 12px;
        background: rgba(0, 0, 0, 0.02);
        border-radius: 8px;
        border: 1px solid var(--color-border);
      }
      .coding-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 0.85rem;
        color: var(--color-primary);
      }
      .global-manual-instruction {
        font-size: 0.8rem;
        color: #7e5109;
        background: rgba(243, 156, 18, 0.05);
        padding: 4px 8px;
        border-radius: 4px;
        margin-bottom: 8px;
        border-left: 3px solid #f39c12;
      }
      .html-content {
        margin-top: 4px;
      }
      .html-content ul,
      .html-content ol {
        margin: 4px 0;
        padding-left: 20px;
      }
      .html-content p {
        margin: 2px 0;
      }
      .manual-icon-small {
        font-size: 0.8rem;
      }
      .manual-icon-tiny {
        font-size: 0.7rem;
        margin-left: 4px;
      }
      .codes-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .code-row-container {
        display: flex;
        flex-direction: column;
      }
      .code-row {
        display: flex;
        gap: 8px;
        font-size: 0.8rem;
        align-items: baseline;
      }
      .code-manual-instruction {
        font-size: 0.75rem;
        color: #d35400;
        margin-left: 28px;
        font-style: italic;
      }
      .code-id {
        font-weight: bold;
        color: var(--color-text-secondary);
        min-width: 20px;
      }
      .code-score {
        color: #27ae60;
        font-weight: bold;
        min-width: 25px;
      }
      .code-label {
        color: var(--color-text);
      }
      .dep-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class MetadataPanelComponent implements OnChanges {
  @Input() unit: UnitViewData | null = null;
  @Input() highlightItemId: string = '';
  codingScheme: any = null;
  codingSchemeAsText: CodingAsText[] | null = null;

  constructor(public sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['unit'] || changes['highlightItemId']) && this.unit) {
      // Extract coding scheme from AP-Index item metadata if available
      const highlighted = this.unit.items?.find((i: any) => i.id === this.highlightItemId);
      this.codingScheme = highlighted?.codingScheme || null;
      if (this.codingScheme) {
        const codings = Array.isArray(this.codingScheme)
          ? this.codingScheme
          : this.codingScheme.variableCodings || [];
        this.codingSchemeAsText = CodingSchemeTextFactory.asText(codings);
        // Enrich with manual instruction texts from raw JSON
        this.codingSchemeAsText.forEach((cat) => {
          const rawVariable = codings.find((v: any) => v.id === cat.id);
          if (rawVariable) {
            (cat as any).manualInstructionText = rawVariable.manualInstruction;
            cat.codes.forEach((c) => {
              const rawCode = rawVariable.codes?.find(
                (rc: any) => (rc.id === null ? 'null' : rc.id.toString(10)) === c.id,
              );
              if (rawCode) {
                (c as any).manualInstructionText = rawCode.manualInstruction;
              }
            });
          }
        });
      } else {
        this.codingSchemeAsText = null;
      }
    }
  }
}
