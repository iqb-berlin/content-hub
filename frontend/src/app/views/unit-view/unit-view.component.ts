import {
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy,
  OnChanges,
  ElementRef,
  Inject,
  Input,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { CodingAsText, CodingSchemeTextFactory } from '@iqb/responses';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { FeatureConfig, FilePreviewVomdData, UnitViewData } from '../../core/models/api.models';
import {
  GEOGEBRA_PLAYER_RESOURCE_BASE,
  rewriteGeoGebraAssetUrls,
} from '../../core/utils/geogebra-player-html.util';
import { BreadcrumbComponent, BreadcrumbItem } from '../../shared/components/breadcrumb.component';
import { unitLabel } from '../../shared/unit-label';
import { ItemCommentThreadComponent } from '../comment-thread/item-comment-thread.component';

import { CommentThreadDrafts } from '../comment-thread/comment-thread-drafts';
import { AuthService } from '../../core/services/auth.service';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { VoudService } from '../../core/services/voud.service';
import {
  CodingVariableLike,
  mergePlayerSolutionIntoDataParts,
} from '../item-explorer/item-explorer-solution-prefill';
import { deriveReviewSolution, ReviewSolution } from './review-solution';

type ReviewCodingAsText = Omit<CodingAsText, 'codes'> & {
  manualInstructionText?: string;
  codes: (CodingAsText['codes'][number] & {
    manualInstructionText?: string;
    description?: string;
  })[];
};

type UnitPagingMode =
  | 'buttons'
  | 'separate'
  | 'concat-scroll'
  | 'concat-scroll-snap'
  | 'view-all'
  | 'print-ids';

type ReviewCommentScope = 'unit' | 'item' | 'booklet';

@Component({
  selector: 'app-unit-view',
  standalone: true,
  imports: [BreadcrumbComponent, FormsModule, ItemCommentThreadComponent, CommonModule],
  template: `
    @if (unit) {
      @if (!embedded) {
        <app-breadcrumb [items]="breadcrumbs" />
      }

      <div class="unit-header">
        <h1>{{ unitDisplayName }}</h1>
        <div class="unit-actions">
          @if (showMetadataToggle && !reviewMode) {
            <button
              class="btn btn-outline btn-sm btn-state"
              (click)="togglePanel()"
              [attr.aria-expanded]="panelVisible"
              aria-controls="unit-additional-data"
            >
              {{ panelVisible ? 'Zusatzdaten ausblenden' : 'Zusatzdaten anzeigen' }}
            </button>
          }
          @if (showMetadataToggle && panelVisible && !reviewMode) {
            <select
              class="btn btn-outline btn-sm panel-mode-select"
              [(ngModel)]="panelMode"
              [disabled]="isNarrowLayout"
            >
              <option value="split">Panel: Split</option>
              <option value="overlay">Panel: Overlay</option>
            </select>
          }
          @if (showDownloadBtn) {
            <button class="btn btn-outline btn-sm" (click)="downloadUnit()">
              ⬇️ Download Aufgabe
            </button>
          }
          @if (reviewMode) {
            <button
              class="btn btn-outline btn-sm btn-state"
              type="button"
              (click)="toggleSolution()"
              [disabled]="
                codingSchemeLoading ||
                !definitionContent ||
                !playerSessionId ||
                solutionRequestPending ||
                printMode !== 'off'
              "
              [attr.aria-pressed]="solutionVisible"
              [attr.aria-busy]="solutionRequestPending"
            >
              {{
                solutionRequestPending
                  ? 'Musterlösung wird vorbereitet …'
                  : solutionVisible
                    ? 'Musterlösung ausblenden'
                    : 'Musterlösung anzeigen'
              }}
            </button>
            <button
              class="btn btn-outline btn-sm btn-state"
              type="button"
              (click)="toggleReviewPanel()"
              [attr.aria-expanded]="!reviewPanelCollapsed"
              aria-controls="unit-additional-data"
            >
              {{ reviewPanelCollapsed ? 'Reviewbereich einblenden' : 'Reviewbereich ausblenden' }}
            </button>
          }
          <select
            class="btn btn-outline btn-sm"
            aria-label="Seitendarstellung der Aufgabe"
            [(ngModel)]="pagingMode"
            (change)="onPagingModeChange()"
          >
            <option value="buttons">Seiten mit Schaltflächen</option>
            <option value="separate">Einzelseiten</option>
            <option value="concat-scroll">Fortlaufend scrollen</option>
            <option value="concat-scroll-snap">Scrollen mit Einrasten</option>
            <option value="view-all">Alle Seiten (Druckansicht)</option>
            <option value="print-ids">Alle Seiten mit IDs (Druckansicht)</option>
          </select>
        </div>
      </div>

      @if (showCommentBtn && !reviewMode) {
        <app-item-comment-thread
          [drafts]="commentDrafts"
          [sessionToken]="commentSessionToken"
          [acpId]="acpId"
          [targetType]="'UNIT'"
          [unitId]="unitId"
          [unitName]="unit.name"
          [enabled]="showCommentBtn"
        />
      }

      <div
        class="unit-layout"
        [class.with-panel]="
          (reviewMode && !reviewPanelCollapsed) || (panelVisible && resolvedPanelMode === 'split')
        "
        [class.review-mode]="reviewMode"
        [style.--review-panel-width.px]="reviewPanelWidth"
      >
        <div class="player-area" [class.print-mode]="printMode !== 'off'">
          <div class="player-container card" [class.print-mode]="printMode !== 'off'">
            @if (playerSrcDoc) {
              <iframe
                #playerFrame
                [srcdoc]="playerSrcDoc"
                class="player-iframe"
                [style.height]="playerHeight"
                [class.print-mode]="printMode !== 'off'"
                sandbox="allow-scripts allow-same-origin allow-downloads"
                (load)="onPlayerLoaded()"
              >
              </iframe>
            } @else {
              <div class="empty-state">
                <div style="font-size:2.5rem;margin-bottom:12px">🎮</div>
                <h3>Kein Player verfügbar</h3>
                <p>Für diese Aufgabe wurde kein Verona-Player gefunden.</p>
              </div>
            }
          </div>

          @if (totalPages > 1 && pagingMode === 'buttons') {
            <div class="page-nav">
              <button
                class="btn btn-outline"
                [disabled]="currentPage <= 1"
                (click)="navigateToPage(currentPage - 1)"
              >
                ← Vorherige Seite
              </button>
              <span class="page-info">Seite {{ currentPage }} / {{ totalPages }}</span>
              <button
                class="btn btn-outline"
                [disabled]="currentPage >= totalPages"
                (click)="navigateToPage(currentPage + 1)"
              >
                Nächste Seite →
              </button>
            </div>
          }

          @if (panelVisible && resolvedPanelMode === 'overlay' && !reviewMode) {
            <div class="panel-overlay-backdrop" (click)="closeOverlayPanel()">
              <div
                id="unit-additional-data"
                class="meta-panel card overlay"
                (click)="$event.stopPropagation()"
              >
                <div class="overlay-header">
                  <strong>Zusatzdaten</strong>
                  <button class="btn btn-outline btn-sm" (click)="togglePanel()">✕</button>
                </div>
                <ng-container [ngTemplateOutlet]="panelContent"></ng-container>
              </div>
            </div>
          }
        </div>

        @if (
          (reviewMode && !reviewPanelCollapsed) || (panelVisible && resolvedPanelMode === 'split')
        ) {
          <div id="unit-additional-data" class="meta-panel card split">
            @if (reviewMode) {
              <button
                class="panel-resize-handle"
                type="button"
                aria-label="Breite des Reviewbereichs ändern"
                title="Ziehen oder mit den Pfeiltasten verschieben"
                (pointerdown)="startReviewPanelResize($event)"
                (keydown)="resizeReviewPanelWithKeyboard($event)"
              ></button>
            }
            <ng-container [ngTemplateOutlet]="panelContent"></ng-container>
          </div>
        }
      </div>

      <ng-template #panelContent>
        <div class="panel-tabs" role="group" aria-label="Zusatzdaten">
          @if (reviewMode) {
            <button
              class="tab"
              type="button"
              [class.active]="activeTab === 'comments'"
              [attr.aria-pressed]="activeTab === 'comments'"
              (click)="activeTab = 'comments'"
            >
              Kommentare
            </button>
          }
          @if (showMetadata) {
            <button
              class="tab"
              type="button"
              [class.active]="activeTab === 'metadata'"
              [attr.aria-pressed]="activeTab === 'metadata'"
              (click)="activeTab = 'metadata'"
            >
              Metadaten
            </button>
          }
          @if (showCodingScheme) {
            <button
              class="tab"
              type="button"
              [class.active]="activeTab === 'coding'"
              [attr.aria-pressed]="activeTab === 'coding'"
              (click)="activeTab = 'coding'"
            >
              Kodierung
            </button>
          }
          @if (showRichText) {
            <button
              class="tab"
              type="button"
              [class.active]="activeTab === 'richtext'"
              [attr.aria-pressed]="activeTab === 'richtext'"
              (click)="activeTab = 'richtext'"
            >
              RichText
            </button>
          }
        </div>

        <div class="panel-content">
          @if (activeTab === 'comments') {
            @if (commentScopeOptions.length) {
              @if (commentScopeOptions.length > 1) {
                <label class="comment-scope-select">
                  Kommentarziel
                  <select aria-label="Kommentarziel" [(ngModel)]="commentScope">
                    @for (scope of commentScopeOptions; track scope.value) {
                      <option [value]="scope.value">{{ scope.label }}</option>
                    }
                  </select>
                </label>
              }
              @if (commentScope === 'item' && showItemCommentBtn) {
                @if (commentItemsLoading) {
                  <p class="help-text" role="status">Items werden geladen …</p>
                } @else if (commentItemsError) {
                  <p class="alert alert-error" role="alert">{{ commentItemsError }}</p>
                  <button
                    type="button"
                    class="btn btn-outline btn-sm comment-items-retry"
                    (click)="loadCommentItems()"
                  >
                    Items erneut laden
                  </button>
                } @else if (commentItems.length) {
                  <label class="comment-item-select">
                    Item
                    <select aria-label="Item" [(ngModel)]="selectedCommentItemId">
                      @for (item of commentItems; track item.id) {
                        <option [value]="item.id">{{ item.label }}</option>
                      }
                    </select>
                  </label>
                  <app-item-comment-thread
                    [drafts]="commentDrafts"
                    [sessionToken]="commentSessionToken"
                    [acpId]="acpId"
                    [targetType]="'ITEM'"
                    [unitId]="unitId"
                    [unitName]="unit.name"
                    [itemId]="selectedCommentItemId"
                    [enabled]="showItemCommentBtn"
                    [initiallyOpen]="true"
                    [hideToggle]="true"
                  />
                } @else {
                  <p class="help-text" role="status">
                    Für diese Aufgabe sind keine kommentierbaren Items verfügbar.
                  </p>
                }
              } @else if (commentScope === 'booklet' && showBookletCommentBtn) {
                <app-item-comment-thread
                  [drafts]="commentDrafts"
                  [sessionToken]="commentSessionToken"
                  [acpId]="acpId"
                  [targetType]="'BOOKLET'"
                  [bookletId]="bookletId"
                  [bookletName]="bookletName"
                  [enabled]="showBookletCommentBtn"
                  [initiallyOpen]="true"
                  [hideToggle]="true"
                />
              } @else {
                <app-item-comment-thread
                  [drafts]="commentDrafts"
                  [sessionToken]="commentSessionToken"
                  [acpId]="acpId"
                  [targetType]="'UNIT'"
                  [unitId]="unitId"
                  [unitName]="unit.name"
                  [enabled]="showCommentBtn"
                  [initiallyOpen]="true"
                  [hideToggle]="true"
                />
              }
            } @else {
              <div class="comment-unavailable" role="status">
                <strong>Kommentare sind für dieses Konto nicht verfügbar.</strong>
                <p>
                  Die Kommentarfunktion ist deaktiviert oder es fehlt die ACP-Berechtigung „Review
                  teilnehmen“.
                </p>
              </div>
            }
          }

          @if (activeTab === 'metadata') {
            @if (metadataLoading) {
              <p class="help-text">Aufgabenmetadaten werden geladen...</p>
            } @else if (visibleUnitMetadata.length) {
              <dl class="meta-dl">
                @for (entry of visibleUnitMetadata; track entry.id) {
                  <dt>{{ entry.label || entry.id }}</dt>
                  <dd>{{ entry.value || '–' }}</dd>
                }
              </dl>
            } @else if (metadataError) {
              <p class="help-text" role="alert">{{ metadataError }}</p>
            } @else {
              <p class="help-text">Keine Aufgabenmetadaten in der VOMD-Datei verfügbar.</p>
            }
          }

          @if (activeTab === 'coding') {
            <div class="coding-content">
              @if (reviewMode && !codingSchemeLoading) {
                <div class="solution-info" role="status">
                  <strong>{{
                    solutionVisible ? 'Musterlösung eingeblendet' : 'Musterlösung'
                  }}</strong>
                  <p>{{ reviewSolution.prefill.message }}</p>
                  @if (printMode !== 'off') {
                    <p>Zum Anzeigen der Musterlösung eine interaktive Seitendarstellung wählen.</p>
                  }
                  @if (solutionRequestError) {
                    <p role="alert">{{ solutionRequestError }}</p>
                  }
                  @if (reviewSolution.unavailableVariables.length) {
                    <p>
                      Ohne eindeutige Player-Lösung:
                      {{ reviewSolution.unavailableVariables.join(', ') }}
                    </p>
                  }
                  @if (solutionVisible) {
                    <p>Beim Ausblenden werden die eigenen Eingaben wiederhergestellt.</p>
                  }
                </div>
              }
              @if (codingSchemeLoading) {
                <p class="help-text">Kodierung wird geladen...</p>
              } @else if (codingSchemeAsText?.length) {
                <label class="coding-filter">
                  <span>Kodiervariablen filtern</span>
                  <input
                    type="search"
                    aria-label="Kodiervariablen filtern"
                    placeholder="ID, Name oder Code"
                    [(ngModel)]="codingFilterText"
                  />
                </label>
                @if (!reviewMode && hiddenCodingVariableCount > 0) {
                  <label class="coding-visibility-toggle">
                    <input type="checkbox" [(ngModel)]="showAllCodingVariables" />
                    <span>
                      Alle Variablen anzeigen
                      <small>({{ hiddenCodingVariableCount }} weitere)</small>
                    </span>
                  </label>
                }
                @if (visibleCodingSchemeAsText.length) {
                  @for (coding of visibleCodingSchemeAsText; track coding.id) {
                    <section class="coding-variable">
                      <h4>
                        {{ reviewMode ? coding.id : coding.label || coding.id }}
                        @if (reviewMode && coding.label && coding.label !== coding.id) {
                          <span> – {{ coding.label }}</span>
                        }
                      </h4>
                      @if (reviewMode && coding.source) {
                        <p class="help-text">{{ coding.source }}</p>
                      }
                      @if (reviewMode && coding.processing) {
                        <p class="help-text">{{ coding.processing }}</p>
                      }
                      @if (coding.manualInstructionText) {
                        <div class="coding-instruction">
                          <strong>Variablenanweisung</strong>
                          <div [innerHTML]="coding.manualInstructionText"></div>
                        </div>
                      }
                      <div class="coding-codes">
                        @for (code of coding.codes; track code.id) {
                          <div class="coding-code">
                            <strong>{{ reviewMode ? 'Code ' : '' }}{{ code.id }}</strong>
                            <span class="coding-score"
                              >({{ code.score
                              }}{{
                                reviewMode ? (code.score === 1 ? ' Punkt' : ' Punkte') : ''
                              }})</span
                            >
                            <span>{{ code.label }}</span>
                          </div>
                          @if (reviewMode && code.description && code.description !== code.label) {
                            <p>{{ code.description }}</p>
                          }
                          @if (code.manualInstructionText) {
                            <div class="coding-instruction code-instruction">
                              <strong>Kodieranweisung</strong>
                              <div [innerHTML]="code.manualInstructionText"></div>
                            </div>
                          }
                          @if (reviewMode && code.ruleSetDescriptions.length) {
                            <div class="coding-instruction code-instruction">
                              <strong>
                                Kodierregeln:
                                {{
                                  code.ruleSetOperatorAnd
                                    ? 'Alle folgenden Bedingungen müssen'
                                    : 'Mindestens eine der folgenden Bedingungen muss'
                                }}
                                zutreffen
                              </strong>
                              <ul>
                                @for (rule of code.ruleSetDescriptions; track $index) {
                                  <li>{{ rule }}</li>
                                }
                              </ul>
                            </div>
                          }
                        }
                      </div>
                    </section>
                  }
                } @else {
                  <p class="help-text">Keine passende Kodiervariable gefunden.</p>
                }
              } @else if (codingSchemeError) {
                <p class="help-text" role="alert">{{ codingSchemeError }}</p>
              } @else {
                <p class="help-text">Keine Kodierung verfügbar.</p>
              }
            </div>
          }

          @if (activeTab === 'richtext') {
            <div class="richtext-content">
              @if (unit.richText) {
                <div [innerHTML]="unit.richText"></div>
              } @else {
                <p class="help-text">Keine Zusatztexte verfügbar.</p>
              }
            </div>
          }
        </div>
      </ng-template>
    } @else {
      <div class="empty-state"><h3>Lade Aufgabe...</h3></div>
    }
  `,
  styles: [
    `
      .unit-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .unit-header h1 {
        margin-bottom: 0;
      }
      .unit-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .solution-info {
        margin-bottom: 16px;
        padding: 12px;
        border-left: 3px solid var(--color-primary);
        background: var(--color-bg);
        overflow-wrap: anywhere;
      }
      .solution-info p {
        margin: 8px 0 0;
      }
      .panel-mode-select {
        min-width: 150px;
      }

      .unit-layout {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
      }
      .unit-layout.with-panel {
        grid-template-columns: 1fr 380px;
      }
      .unit-layout.review-mode.with-panel {
        grid-template-columns: minmax(0, 1fr) var(--review-panel-width, 420px);
        align-items: start;
      }
      .unit-layout.review-mode {
        --review-content-height: max(360px, calc(100dvh - 360px));
      }

      .player-area {
        position: relative;
      }
      .player-container {
        padding: 0;
        overflow: auto;
        min-height: 600px;
      }
      .player-container.print-mode {
        display: block;
        overflow: visible;
        flex: none;
        height: auto;
        min-height: 1000px;
        border: none;
      }
      .player-iframe {
        width: 100%;
        min-height: 550px;
        border: none;
        display: block;
      }
      .player-iframe.print-mode {
        min-height: 1000px;
        height: auto;
      }
      .review-mode .player-container {
        height: var(--review-content-height);
        min-height: var(--review-content-height);
        overflow: auto;
      }
      .review-mode .player-iframe:not(.print-mode) {
        min-height: 100%;
      }
      .review-mode .player-iframe.print-mode {
        height: 100% !important;
        min-height: 100%;
      }

      .page-nav {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-top: 12px;
      }
      .page-info {
        white-space: nowrap;
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--color-text-secondary);
      }

      .meta-panel {
        max-height: calc(100vh - 180px);
        overflow-y: auto;
      }
      .meta-panel.split {
        max-height: calc(100vh - 180px);
      }
      .review-mode .meta-panel.split {
        position: sticky;
        top: 16px;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        height: var(--review-content-height);
        max-height: var(--review-content-height);
        overflow: hidden;
      }
      .review-mode .meta-panel.split .panel-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      .review-mode .player-container.print-mode {
        height: var(--review-content-height);
        min-height: var(--review-content-height);
        max-height: var(--review-content-height);
        overflow: auto;
      }
      .review-mode .player-area.print-mode {
        height: var(--review-content-height);
        min-height: 0;
        overflow: hidden;
      }
      :host-context(.review-workspace:fullscreen) .unit-layout.review-mode,
      :host-context(.review-workspace.fullscreen-fallback) .unit-layout.review-mode {
        --review-content-height: max(360px, calc(100dvh - 220px));
      }
      .panel-resize-handle {
        position: absolute;
        inset: 0 auto 0 0;
        z-index: 2;
        width: 14px;
        min-height: 100%;
        padding: 0;
        border: 0;
        border-left: 3px solid transparent;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
        user-select: none;
      }
      .panel-resize-handle:hover,
      .panel-resize-handle:focus-visible {
        border-left-color: var(--color-primary-light);
        outline: none;
      }
      .panel-resize-handle::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 3px;
        width: 4px;
        height: 40px;
        border-radius: 4px;
        background: var(--color-border);
        transform: translateY(-50%);
      }
      .panel-resize-handle:hover::after,
      .panel-resize-handle:focus-visible::after {
        background: var(--color-primary-light);
      }

      .panel-overlay-backdrop {
        position: absolute;
        inset: 0;
        border-radius: var(--radius);
        background: rgba(15, 23, 42, 0.18);
        display: flex;
        justify-content: flex-end;
        z-index: 25;
      }
      .meta-panel.overlay {
        width: min(420px, 100%);
        height: 100%;
        max-height: none;
        margin: 0;
        border-radius: 0 var(--radius) var(--radius) 0;
        border-left: 1px solid var(--color-border);
      }
      .overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: -24px -24px 12px;
        padding: 16px 24px 8px;
        border-bottom: 1px solid var(--color-border);
        background: #fff;
        position: sticky;
        top: -24px;
        z-index: 2;
      }

      .panel-tabs {
        display: flex;
        flex: none;
        gap: 0;
        border-bottom: 1px solid var(--color-border);
        margin: -24px -24px 16px;
        padding: 0 24px;
      }
      .tab {
        background: none;
        border: none;
        padding: 10px 16px;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        color: var(--color-text-secondary);
        border-bottom: 2px solid transparent;
        font-family: inherit;
        transition: all 0.15s;
      }
      .tab:hover {
        color: var(--color-text);
      }
      .tab.active {
        color: var(--color-primary);
        border-bottom-color: var(--color-primary);
        font-weight: 700;
      }

      .meta-dl {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px 20px;
        font-size: 0.9rem;
      }
      .meta-dl dt {
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .meta-dl dd {
        margin: 0;
        overflow-wrap: anywhere;
      }

      h4 {
        font-size: 0.95rem;
        margin: 16px 0 8px;
      }
      .coding-content,
      .richtext-content {
        font-size: 0.9rem;
      }
      .coding-filter {
        display: grid;
        gap: 6px;
        margin-bottom: 12px;
        font-size: 0.82rem;
        font-weight: 600;
      }
      .coding-filter input {
        width: 100%;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font: inherit;
      }
      .coding-visibility-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: -2px 0 12px;
        color: var(--color-text-secondary);
        font-size: 0.82rem;
        cursor: pointer;
      }
      .coding-visibility-toggle input {
        margin: 0;
      }
      .coding-variable {
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.02);
      }
      .coding-variable + .coding-variable {
        margin-top: 12px;
      }
      .coding-variable h4 {
        margin-top: 0;
        color: var(--color-primary);
      }
      .coding-codes {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .coding-code {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px;
      }
      .coding-score {
        color: var(--color-success);
        font-weight: 600;
      }
      .coding-instruction {
        overflow-wrap: anywhere;
        margin: 8px 0;
        padding: 8px;
        border-left: 3px solid #f39c12;
        background: rgba(243, 156, 18, 0.06);
      }
      .code-instruction {
        margin: 0 0 6px 24px;
        font-size: 0.82rem;
      }
      .coding-content :first-child,
      .richtext-content :first-child {
        margin-top: 0;
      }
      .help-text {
        color: var(--color-text-secondary);
        font-size: 0.85rem;
      }
      .comment-unavailable {
        padding: 12px;
        border-left: 3px solid var(--color-warning, #f39c12);
        background: rgba(243, 156, 18, 0.06);
      }
      .comment-unavailable p {
        margin: 6px 0 0;
        color: var(--color-text-secondary);
        font-size: 0.85rem;
      }
      .comment-scope-select,
      .comment-item-select {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .comment-scope-select select {
        min-width: 130px;
      }
      .comment-item-select select {
        flex: 1;
        min-width: 0;
      }

      @media (max-width: 1100px) {
        .unit-layout.with-panel,
        .unit-layout.review-mode.with-panel {
          grid-template-columns: minmax(0, 1fr);
        }
        .review-mode .meta-panel.split {
          position: static;
          display: block;
          height: auto;
          max-height: none;
          overflow: visible;
        }
        .review-mode .meta-panel.split .panel-content {
          max-height: none;
        }
        .panel-resize-handle {
          display: none;
        }
        .panel-mode-select {
          opacity: 0.7;
        }
        .meta-panel.overlay {
          width: 100%;
          border-radius: var(--radius);
          border-left: none;
        }
        .overlay-header {
          position: static;
          margin-top: -24px;
        }
      }

      @media (max-width: 900px) {
        .unit-header {
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;
        }
      }
    `,
  ],
})
export class UnitViewComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('playerFrame') playerFrame!: ElementRef<HTMLIFrameElement>;

  @Input() acpId = '';
  @Input() unitId = '';
  @Input() bookletId = '';
  @Input() bookletName = '';
  @Input() embedded = false;
  @Input() reviewMode = false;
  @Input() featureConfigOverride: FeatureConfig | null = null;

  unit: UnitViewData | null = null;
  playerSrcDoc: any = null;
  breadcrumbs: BreadcrumbItem[] = [];
  playerHeight = '100%';
  pagingMode: UnitPagingMode = 'buttons';

  // Page navigation
  currentPage = 1;
  totalPages = 1;
  private playerPageIds: (string | number)[] = [];
  playerSessionId: string | null = null;
  private personalResponseSession = false;

  // Panel state
  panelVisible = false;
  panelMode: 'split' | 'overlay' = 'split';
  activeTab: 'comments' | 'metadata' | 'coding' | 'richtext' = 'metadata';
  isNarrowLayout = false;
  reviewPanelCollapsed = false;
  reviewPanelWidth = 420;

  // Feature config
  showMetadata = false;
  showCodingScheme = false;
  showRichText = false;
  showMetadataToggle = false;
  showCommentBtn = false;
  showItemCommentBtn = false;
  showBookletCommentBtn = false;
  showDownloadBtn = false;
  showAudioVideoCodingVariables = true;
  hideReviewDeveloperNames = false;
  commentScope: ReviewCommentScope = 'unit';
  commentItems: { id: string; label: string }[] = [];
  commentItemsLoading = false;
  commentItemsError = '';
  private readonly selectedCommentItems = new Map<string, string>();

  get selectedCommentItemId(): string {
    return this.selectedCommentItems.get(`${this.acpId}\u0000${this.unitId}`) || '';
  }

  set selectedCommentItemId(value: string) {
    this.selectedCommentItems.set(`${this.acpId}\u0000${this.unitId}`, value);
  }

  get commentScopeOptions(): { value: ReviewCommentScope; label: string }[] {
    const scopes: { value: ReviewCommentScope; label: string; enabled: boolean }[] = [
      { value: 'unit', label: 'Aufgabe', enabled: this.showCommentBtn },
      { value: 'item', label: 'Item', enabled: this.showItemCommentBtn },
      { value: 'booklet', label: 'Testheft', enabled: this.showBookletCommentBtn },
    ];
    return scopes.filter((scope) => scope.enabled);
  }
  readonly commentDrafts = new CommentThreadDrafts();
  commentSessionToken = 0;
  private commentIdentity: string | null = null;
  private authSubscription: Subscription | null = null;
  codingFilterText = '';
  showAllCodingVariables = false;
  unitMetadata: FilePreviewVomdData['unitProfiles'] = [];
  metadataLoading = false;
  metadataError = '';
  codingSchemeAsText: ReviewCodingAsText[] | null = null;
  codingSchemeLoading = false;
  codingSchemeError = '';
  solutionVisible = false;
  solutionRequestPending = false;
  solutionRequestError = '';
  reviewSolution: ReviewSolution = deriveReviewSolution([], [], () => undefined);
  private codingVariables: CodingVariableLike[] = [];
  private responseData: Record<string, unknown> = {};
  private responseDataTimes: Record<string, number> = {};
  private retiringResponseSource: { window: Window; sessionId: string } | null = null;
  private responseChangedAt: number | null = null;
  private playerInputDocument: Document | null = null;
  private playerDragStart: { x: number; y: number; pointerId: number } | null = null;
  private solutionRequestTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly playerInputHandler = () => {
    if (this.reviewMode && !this.solutionVisible && this.printMode === 'off')
      this.responseChangedAt = Date.now();
  };
  private readonly playerDragStartHandler = (event: PointerEvent) => {
    if (
      !(event.target as Element | null)?.closest?.(
        '[data-aspect-draggable="true"], .cdk-drag, [draggable="true"]',
      )
    )
      return;
    this.playerDragStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };
  private readonly playerDragEndHandler = (event: PointerEvent) => {
    const start = this.playerDragStart;
    this.playerDragStart = null;
    if (
      start &&
      start.pointerId === event.pointerId &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5
    ) {
      this.playerInputHandler();
    }
  };
  private readonly playerDragCancelHandler = () => {
    this.playerDragStart = null;
  };
  private readonly playerControlHandler = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (
      event.type === 'keydown' &&
      !['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)
    )
      return;
    const selector =
      '[role="option"], button[role="radio"], button[role="checkbox"], button[role="switch"]' +
      (event.type === 'keydown' ? ', [role="combobox"]' : '');
    const control = (event.target as Element | null)?.closest?.(selector);
    if (!control || control.getAttribute('aria-disabled') === 'true') return;
    const isArrow = event.type === 'keydown' && key.startsWith('Arrow');
    if (
      !isArrow &&
      (control.getAttribute('aria-selected') === 'true' ||
        (control.getAttribute('role') === 'radio' &&
          control.getAttribute('aria-checked') === 'true'))
    )
      return;
    this.playerInputHandler();
  };
  private readonly voud = new VoudService();
  private playerRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  definitionContent: string | null = null;
  private playerFrameReady = false;
  private unitLoadToken = 0;
  private initialized = false;
  private startSessionCounter = 0;
  private featureConfigRequest: Subscription | null = null;
  private unitRequest: Subscription | null = null;
  private metadataRequest: Subscription | null = null;
  private commentItemsRequest: Subscription | null = null;
  private commentItemsLoadToken = 0;
  private unitAbortController: AbortController | null = null;
  private panelResizeStartX = 0;
  private panelResizeStartWidth = 0;
  private panelResizePointerId: number | null = null;
  private panelResizeHandle: HTMLElement | null = null;

  private messageHandler = this.onPlayerMessage.bind(this);
  private resizeHandler = this.onWindowResize.bind(this);
  private panelResizeMoveHandler = (event: PointerEvent) => {
    if (event.pointerId !== this.panelResizePointerId) return;
    if (!(event.buttons & 1)) {
      this.stopReviewPanelResize();
      return;
    }
    this.reviewPanelWidth = this.clampReviewPanelWidth(
      this.panelResizeStartWidth + this.panelResizeStartX - event.clientX,
    );
    this.changeDetector.markForCheck();
  };
  private panelResizeEndHandler = (event: PointerEvent) => {
    if (event.pointerId === this.panelResizePointerId) this.stopReviewPanelResize();
  };
  private panelResizeBlurHandler = () => this.stopReviewPanelResize();
  private autoResizeInterval: any;

  constructor(
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ApiService) public api: ApiService,
    @Inject(DomSanitizer) private sanitizer: DomSanitizer,
    @Inject(ChangeDetectorRef) private changeDetector: ChangeDetectorRef,
    @Inject(AuthService) private auth: AuthService,
    @Inject(PendingPersonalSessionStorageService)
    private personalSession: PendingPersonalSessionStorageService,
  ) {}

  get printMode(): 'off' | 'on' | 'on-with-ids' {
    if (this.pagingMode === 'view-all') return 'on';
    if (this.pagingMode === 'print-ids') return 'on-with-ids';
    return 'off';
  }

  get visibleUnitMetadata(): FilePreviewVomdData['unitProfiles'] {
    if (!this.reviewMode || !this.hideReviewDeveloperNames) return this.unitMetadata;
    return this.unitMetadata.filter((entry) => {
      const normalize = (value: string) =>
        value
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z]/g, '');
      const id = normalize(entry.id);
      const label = normalize(entry.label);
      return (
        !['iqbauthor', 'author', 'developer', 'creator'].includes(id) &&
        !/^(aufgaben)?(entwickler(in(nen)?)?|autor(in(nen)?)?|author|developer)(name|kurzel)?$/.test(
          label,
        )
      );
    });
  }

  get visibleCodingSchemeAsText(): ReviewCodingAsText[] {
    const visibleCodings =
      !this.reviewMode && this.showAllCodingVariables
        ? this.availableCodingSchemeAsText
        : this.availableCodingSchemeAsText.filter((coding) =>
            this.isRelevantCodingVariable(coding),
          );
    if (this.reviewMode) {
      visibleCodings.sort((left, right) =>
        left.id.localeCompare(right.id, 'de', { numeric: true }),
      );
    }
    const term = this.codingFilterText.trim().toLowerCase();
    if (!term) return visibleCodings;
    return visibleCodings.filter((coding) => {
      const searchableText = [
        coding.id,
        coding.label,
        (coding as any).manualInstructionText,
        ...coding.codes.flatMap((code) => [
          code.id,
          code.label,
          code.description,
          (code as any).manualInstructionText,
          ...(this.reviewMode ? code.ruleSetDescriptions : []),
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchableText.includes(term);
    });
  }

  get hiddenCodingVariableCount(): number {
    return this.availableCodingSchemeAsText.filter(
      (coding) => !this.isRelevantCodingVariable(coding),
    ).length;
  }

  get unitDisplayName(): string {
    return this.unit ? (this.reviewMode ? unitLabel(this.unit) : this.unit.name) : '';
  }

  private get availableCodingSchemeAsText(): ReviewCodingAsText[] {
    const codings = this.codingSchemeAsText || [];
    const hideAudioVideoVariables = this.reviewMode || !this.showAudioVideoCodingVariables;
    return hideAudioVideoVariables
      ? codings.filter((coding) => !this.isAudioVideoCodingVariable(coding))
      : codings;
  }

  get resolvedPanelMode(): 'split' | 'overlay' {
    return this.isNarrowLayout ? 'overlay' : this.panelMode;
  }

  ngOnInit() {
    this.authSubscription = this.auth.currentUser$.subscribe(() => {
      const identity = this.personalSession.resolveIdentityFromToken(this.auth.getToken());
      if (identity !== this.commentIdentity) {
        this.commentDrafts.clear();
        this.selectedCommentItems.clear();
        this.commentIdentity = identity;
        this.commentSessionToken += 1;
        this.loadCommentItems();
        this.changeDetector.markForCheck();
      }
    });
    this.acpId = this.acpId || this.route.snapshot.paramMap.get('acpId') || '';
    this.unitId = this.unitId || this.route.snapshot.paramMap.get('unitId') || '';

    this.onWindowResize();
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('message', this.messageHandler);

    this.initialized = true;
    if (this.featureConfigOverride) {
      this.applyFeatureConfig(this.featureConfigOverride);
    } else {
      this.loadFeatureConfig();
    }
    this.loadUnit();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.initialized) return;

    if (changes['featureConfigOverride'] || changes['reviewMode'] || changes['bookletId']) {
      if (this.featureConfigOverride) {
        this.featureConfigRequest?.unsubscribe();
        this.featureConfigRequest = null;
        this.applyFeatureConfig(this.featureConfigOverride);
      } else this.loadFeatureConfig();
    }

    if (changes['acpId'] || changes['unitId']) this.loadUnit();
  }

  private loadFeatureConfig() {
    this.featureConfigRequest?.unsubscribe();
    this.featureConfigRequest = this.api.getAcpStartPage(this.acpId).subscribe((data) => {
      this.applyFeatureConfig(data?.featureConfig || {});
    });
  }

  private applyFeatureConfig(featureConfig: FeatureConfig) {
    this.showMetadata = this.reviewMode
      ? featureConfig.hideReviewMetadata !== true
      : !!featureConfig.showMetadata;
    this.showCodingScheme = this.reviewMode || !!featureConfig.showCodingScheme;
    this.showRichText = !this.reviewMode && !!featureConfig.showRichText;
    this.showMetadataToggle = this.showMetadata || this.showCodingScheme || this.showRichText;

    const commentTargets = Array.isArray(featureConfig.commentTargets)
      ? featureConfig.commentTargets
      : [];
    this.showCommentBtn = !!(featureConfig.enableCommenting && commentTargets.includes('UNIT'));
    this.showItemCommentBtn = !!(
      this.reviewMode &&
      featureConfig.enableCommenting &&
      commentTargets.includes('ITEM')
    );
    this.showBookletCommentBtn = !!(
      this.reviewMode &&
      this.bookletId &&
      featureConfig.enableCommenting &&
      commentTargets.includes('BOOKLET')
    );
    if (!this.commentScopeOptions.some((scope) => scope.value === this.commentScope)) {
      this.commentScope = this.commentScopeOptions[0]?.value || 'unit';
    }
    this.showDownloadBtn = !!featureConfig.allowUnitDownload;
    this.showAudioVideoCodingVariables = featureConfig.showAudioVideoCodingVariables !== false;
    this.hideReviewDeveloperNames = featureConfig.hideReviewDeveloperNames === true;

    if (this.reviewMode) this.activeTab = 'comments';
    else if (this.showMetadata) this.activeTab = 'metadata';
    else if (this.showCodingScheme) this.activeTab = 'coding';
    else if (this.showRichText) this.activeTab = 'richtext';
    if (!this.showMetadataToggle) this.panelVisible = false;
    this.loadCommentItems();
  }

  private resetCommentItems() {
    this.commentItemsLoadToken += 1;
    this.commentItemsRequest?.unsubscribe();
    this.commentItemsRequest = null;
    this.commentItems = [];
    this.commentItemsLoading = false;
    this.commentItemsError = '';
  }

  loadCommentItems() {
    this.resetCommentItems();
    if (!this.showItemCommentBtn || !this.unit || this.unit.id !== this.unitId) return;
    const token = this.commentItemsLoadToken;
    const unitId = this.unitId;
    const names = new Map(
      (this.unit.items || []).map((item) => [
        String(item.id || '').trim(),
        typeof item.name === 'string' ? item.name.trim() : '',
      ]),
    );
    this.commentItemsLoading = true;
    // Counts include every canonical target, even without comments, and do not
    // require Item Explorer access. Raw unit metadata alone may omit file items.
    this.commentItemsRequest = this.api.getItemCommentCounts(this.acpId).subscribe({
      next: (snapshot) => {
        if (token !== this.commentItemsLoadToken) return;
        const ids = new Set(
          snapshot.counts.filter((item) => item.unitId === unitId).map((item) => item.itemId),
        );
        this.commentItems = [...ids]
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
          .map((id) => ({
            id,
            label: names.get(id) && names.get(id) !== id ? `${names.get(id)} (${id})` : id,
          }));
        if (!ids.has(this.selectedCommentItemId)) {
          this.selectedCommentItemId = this.commentItems[0]?.id || '';
        }
        this.commentItemsLoading = false;
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (token !== this.commentItemsLoadToken) return;
        this.commentItemsLoading = false;
        this.commentItemsError = 'Items für die Kommentierung konnten nicht geladen werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  private loadUnit() {
    this.stopReviewPanelResize();
    if (!this.acpId || !this.unitId) return;
    const requestToken = ++this.unitLoadToken;
    this.unitRequest?.unsubscribe();
    this.metadataRequest?.unsubscribe();
    this.resetCommentItems();
    this.unitAbortController?.abort();
    this.unitAbortController = new AbortController();
    this.stopAutoResize();
    this.unit = null;
    this.playerSrcDoc = null;
    this.playerFrameReady = false;
    this.playerSessionId = null;
    this.playerPageIds = [];
    this.personalResponseSession = false;
    this.currentPage = 1;
    this.totalPages = 1;
    this.definitionContent = null;
    this.unitMetadata = [];
    this.metadataLoading = false;
    this.metadataError = '';
    this.codingSchemeAsText = null;
    this.codingSchemeLoading = false;
    this.codingSchemeError = '';
    this.codingVariables = [];
    this.solutionVisible = false;
    this.responseData = {};
    this.responseDataTimes = {};
    this.retiringResponseSource = null;
    this.responseChangedAt = null;
    this.solutionRequestError = '';
    this.reviewSolution = deriveReviewSolution([], [], () => undefined);
    this.clearPlayerRefresh();
    this.codingFilterText = '';
    this.showAllCodingVariables = false;
    this.unitRequest = this.api.getViewUnit(this.acpId, this.unitId).subscribe((u) => {
      if (requestToken !== this.unitLoadToken) return;
      this.unit = u;
      this.loadCommentItems();
      this.breadcrumbs = [
        { label: 'Assessment Content Pool', route: ['/'] },
        { label: 'ACP', route: ['/view', this.acpId] },
        { label: u.name },
      ];

      u.dependencies = (u.dependencies || []).map((d) => ({
        ...d,
        downloadUrl: this.api.appendAuthToken(d.downloadUrl),
      }));

      this.currentPage = 1;
      this.totalPages = 1;
      this.playerFrameReady = false;
      this.definitionContent = null;

      const signal = this.unitAbortController?.signal;
      this.loadPlayerSource(u.dependencies || [], requestToken, signal);
      this.loadDefinitionSource(u.dependencies || [], requestToken, signal);
      this.loadMetadataSource(u.dependencies || [], requestToken);
      this.loadCodingSchemeSource(u, requestToken, signal);
    });
  }

  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
    this.commentDrafts.clear();
    this.selectedCommentItems.clear();
    this.resetCommentItems();
    this.unitLoadToken += 1;
    this.retiringResponseSource = null;
    this.featureConfigRequest?.unsubscribe();
    this.unitRequest?.unsubscribe();
    this.metadataRequest?.unsubscribe();
    this.unitAbortController?.abort();
    this.clearPlayerRefresh();
    this.stopReviewPanelResize();
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('message', this.messageHandler);
    this.stopAutoResize();
  }

  onPlayerLoaded() {
    if (!this.unit || !this.playerFrame?.nativeElement?.contentWindow) return;
    this.observePlayerInputs();
    this.startPlayerIfReady();
  }

  onPagingModeChange() {
    const src = this.playerSrcDoc;
    if (!src) return;
    this.clearPlayerRefresh();
    const frameWindow = this.playerFrame?.nativeElement?.contentWindow;
    // ASPECT flushes its last response on unload. Retain this exact source/session
    // while the replacement frame starts, without accepting synthetic solution data.
    this.retiringResponseSource =
      this.personalResponseSession && frameWindow && this.playerSessionId
        ? { window: frameWindow, sessionId: this.playerSessionId }
        : null;
    if (this.printMode !== 'off') this.solutionVisible = false;
    this.playerFrameReady = false;
    this.playerSessionId = null;
    if (!this.reviewMode) this.initializePageNavigation();
    this.playerSrcDoc = null;
    this.changeDetector.markForCheck();
    this.playerRefreshTimer = setTimeout(() => {
      this.playerRefreshTimer = null;
      this.playerSrcDoc = src;
      this.changeDetector.markForCheck();
    }, 50);
  }

  toggleSolution() {
    if (
      !this.reviewMode ||
      !this.playerSessionId ||
      this.solutionRequestPending ||
      this.printMode !== 'off'
    )
      return;
    this.activeTab = 'coding';
    this.reviewPanelCollapsed = false;
    this.changeDetector.markForCheck();
    if (!this.solutionVisible && this.reviewSolution.prefill.status !== 'available') return;
    this.solutionRequestError = '';
    if (!this.solutionVisible) {
      // Material choice controls commit their form value on blur. Moving focus
      // into the parent document does not consistently blur them in every browser.
      (this.playerInputDocument?.activeElement as HTMLElement | null)?.blur?.();
    }
    if (!this.solutionVisible && this.responseChangedAt !== null) {
      // Input reports are debounced by the player. Keep the original frame until
      // it acknowledges the last interaction, including browsers without unload reports.
      this.solutionRequestPending = true;
      this.solutionRequestTimer = setTimeout(() => {
        this.cancelSolutionRequest();
        this.solutionRequestError =
          'Der aktuelle Antwortstand wurde noch nicht vom Player gemeldet. Bitte erneut versuchen.';
        this.changeDetector.markForCheck();
      }, 2500);
      return;
    }
    this.applySolutionToggle();
  }

  private applySolutionToggle() {
    this.solutionVisible = !this.solutionVisible;
    this.onPagingModeChange();
  }

  private clearPlayerRefresh() {
    this.cancelSolutionRequest();
    this.stopObservingPlayerInputs();
    if (this.playerRefreshTimer) clearTimeout(this.playerRefreshTimer);
    this.playerRefreshTimer = null;
  }

  private cancelSolutionRequest() {
    if (this.solutionRequestTimer) clearTimeout(this.solutionRequestTimer);
    this.solutionRequestTimer = null;
    this.solutionRequestPending = false;
  }

  private observePlayerInputs() {
    this.stopObservingPlayerInputs();
    if (!this.reviewMode) return;
    const doc = this.playerFrame?.nativeElement?.contentDocument;
    if (!doc) return;
    this.playerInputDocument = doc;
    doc.addEventListener('input', this.playerInputHandler, true);
    doc.addEventListener('click', this.playerControlHandler, true);
    doc.addEventListener('keydown', this.playerControlHandler, true);
    doc.addEventListener('pointerdown', this.playerDragStartHandler, true);
    doc.addEventListener('pointerup', this.playerDragEndHandler, true);
    doc.addEventListener('pointercancel', this.playerDragCancelHandler, true);
    doc.addEventListener('drop', this.playerInputHandler, true);
  }

  private stopObservingPlayerInputs() {
    this.playerInputDocument?.removeEventListener('input', this.playerInputHandler, true);
    this.playerInputDocument?.removeEventListener('click', this.playerControlHandler, true);
    this.playerInputDocument?.removeEventListener('keydown', this.playerControlHandler, true);
    this.playerInputDocument?.removeEventListener('pointerdown', this.playerDragStartHandler, true);
    this.playerInputDocument?.removeEventListener('pointerup', this.playerDragEndHandler, true);
    this.playerInputDocument?.removeEventListener(
      'pointercancel',
      this.playerDragCancelHandler,
      true,
    );
    this.playerInputDocument?.removeEventListener('drop', this.playerInputHandler, true);
    this.playerDragStart = null;
    this.playerInputDocument = null;
  }

  private onPlayerMessage(event: MessageEvent) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    const retiringSource = this.retiringResponseSource;
    if (
      retiringSource &&
      event.source === retiringSource.window &&
      msg.sessionId === retiringSource.sessionId
    ) {
      if (msg.type === 'vopStateChangedNotification') this.captureResponseData(msg);
      return;
    }
    const frameWindow = this.playerFrame?.nativeElement?.contentWindow;
    if (!frameWindow || event.source !== frameWindow) return;

    if (msg.sessionId !== undefined && msg.sessionId !== this.playerSessionId) return;

    switch (msg.type) {
      case 'vopReadyNotification': {
        this.observePlayerInputs();
        this.playerFrameReady = true;
        this.startPlayerIfReady();
        break;
      }
      case 'vopStateChangedNotification': {
        if (
          this.reviewMode &&
          this.playerSessionId &&
          msg.sessionId === this.playerSessionId &&
          !this.solutionVisible &&
          this.printMode === 'off'
        ) {
          this.captureResponseData(msg);
          if (
            this.responseChangedAt !== null &&
            typeof msg.unitState?.dataParts?.elementCodes === 'string' &&
            this.playerMessageTime(msg.timeStamp) >= this.responseChangedAt
          ) {
            this.responseChangedAt = null;
            if (this.solutionRequestPending) this.applySolutionToggle();
          }
        }
        const pages = msg.playerState?.validPages;
        if (pages && typeof pages === 'object') {
          // Verona 6 uses ordered { id, label } entries; older players use a map.
          this.playerPageIds = Array.isArray(pages)
            ? pages
                .map((page: any) => page?.id ?? page)
                .filter(
                  (id: unknown): id is string | number =>
                    typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)),
                )
            : Object.keys(pages);
          this.totalPages = this.playerPageIds.length;
        }
        this.updateCurrentPage(msg.playerState?.currentPage);
        break;
      }

      case 'vopPageNavigationCommand': {
        this.updateCurrentPage(msg.target);
        break;
      }

      case 'vopResizeNotification': {
        if (typeof msg.height === 'number') {
          this.playerHeight = `${msg.height}px`;
        }
        break;
      }
      default:
        return;
    }
    this.changeDetector.markForCheck();
  }

  private captureResponseData(msg: Record<string, any>) {
    const dataParts = msg['unitState']?.dataParts;
    if (!dataParts || typeof dataParts !== 'object' || Array.isArray(dataParts)) return;
    const time = this.playerMessageTime(msg['timeStamp']);
    for (const [key, value] of Object.entries(dataParts)) {
      if (typeof value !== 'string') continue;
      if (Number.isFinite(time) && time < (this.responseDataTimes[key] ?? -Infinity)) continue;
      this.responseData[key] = value;
      if (Number.isFinite(time)) this.responseDataTimes[key] = time;
    }
  }

  private playerMessageTime(value: unknown): number {
    return typeof value === 'number'
      ? Number.isFinite(value)
        ? value
        : Number.NaN
      : Date.parse(String(value));
  }

  private updateCurrentPage(id: unknown) {
    const index = this.playerPageIds.findIndex((pageId) => String(pageId) === String(id));
    if (index >= 0) this.currentPage = index + 1;
    else if (!this.playerPageIds.length && typeof id === 'number' && Number.isInteger(id))
      this.currentPage = this.clampPage(id + 1);
    else this.currentPage = this.clampPage(this.currentPage);
  }

  private sendToPlayer(msg: any) {
    this.playerFrame?.nativeElement?.contentWindow?.postMessage(msg, '*');
  }

  navigateToPage(page: number) {
    if (this.pagingMode !== 'buttons') return;
    if (!this.playerSessionId) return;

    const target = Math.trunc(page);
    if (!Number.isFinite(target) || target < 1 || target > this.totalPages) return;

    this.currentPage = target;
    this.sendToPlayer({
      type: 'vopPageNavigationCommand',
      sessionId: this.playerSessionId,
      target: this.playerPageIds[target - 1] ?? String(target - 1),
    });
  }

  togglePanel() {
    if (!this.showMetadataToggle) return;
    this.panelVisible = !this.panelVisible;
  }

  toggleReviewPanel() {
    this.stopReviewPanelResize();
    this.reviewPanelCollapsed = !this.reviewPanelCollapsed;
  }

  startReviewPanelResize(event: PointerEvent) {
    if (!this.reviewMode || this.isNarrowLayout || event.button !== 0 || event.isPrimary === false)
      return;
    event.preventDefault();
    this.stopReviewPanelResize();
    const handle = event.currentTarget as HTMLElement;
    handle.focus();
    this.panelResizePointerId = event.pointerId;
    this.panelResizeHandle = handle;
    this.panelResizeStartX = event.clientX;
    this.panelResizeStartWidth = this.reviewPanelWidth;
    handle.addEventListener('lostpointercapture', this.panelResizeEndHandler);
    handle.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', this.panelResizeMoveHandler, true);
    window.addEventListener('pointerup', this.panelResizeEndHandler, true);
    window.addEventListener('pointercancel', this.panelResizeEndHandler, true);
    window.addEventListener('blur', this.panelResizeBlurHandler);
  }

  resizeReviewPanelWithKeyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 24 : -24;
    this.reviewPanelWidth = this.clampReviewPanelWidth(this.reviewPanelWidth + delta);
  }

  closeOverlayPanel() {
    if (this.resolvedPanelMode === 'overlay') {
      this.panelVisible = false;
    }
  }

  downloadUnit() {
    const url = `/api/acp/${this.acpId}/files?unitId=${this.unitId}&format=zip`;
    window.open(this.api.appendAuthToken(url), '_blank');
  }

  private loadPlayerSource(dependencies: any[], token: number, signal?: AbortSignal) {
    const playerDep = dependencies.find((d: any) => {
      const type = String(d?.type || '').toLowerCase();
      return type === 'player';
    });

    if (!playerDep?.downloadUrl) {
      this.playerSrcDoc = null;
      return;
    }

    fetch(playerDep.downloadUrl, { signal })
      .then((res) => res.text())
      .then((html) => {
        if (token !== this.unitLoadToken) return;
        this.playerSrcDoc = this.sanitizer.bypassSecurityTrustHtml(rewriteGeoGebraAssetUrls(html));
        this.changeDetector.markForCheck();
      })
      .catch(() => {
        if (token !== this.unitLoadToken) return;
        this.playerSrcDoc = null;
        this.changeDetector.markForCheck();
      });
  }

  private loadDefinitionSource(dependencies: any[], token: number, signal?: AbortSignal) {
    const definitionDep = dependencies.find((d: any) => {
      const type = String(d?.type || '').toLowerCase();
      return type === 'unit_definition' || type === 'unitdefinition' || type === 'definition';
    });

    if (!definitionDep?.downloadUrl) {
      this.definitionContent = null;
      return;
    }

    fetch(definitionDep.downloadUrl, { signal })
      .then((res) => res.text())
      .then((definition) => {
        if (token !== this.unitLoadToken) return;
        this.definitionContent = definition;
        this.updateReviewSolution();
        this.initializePageNavigation();
        this.startPlayerIfReady();
        this.changeDetector.markForCheck();
      })
      .catch(() => {
        if (token !== this.unitLoadToken) return;
        this.definitionContent = null;
      });
  }

  private loadMetadataSource(dependencies: any[], token: number) {
    const metadataDep = dependencies.find(
      (dependency: any) => String(dependency?.type || '').toLowerCase() === 'metadata',
    );
    if (!metadataDep?.fileId) return;

    this.metadataLoading = true;
    this.metadataRequest = this.api.getFilePreview(this.acpId, metadataDep.fileId).subscribe({
      next: (preview) => {
        if (token !== this.unitLoadToken) return;
        const structuredData = preview.structuredData;
        if (structuredData?.type !== 'vomd') {
          this.metadataError = 'Die referenzierte Metadatendatei ist keine gültige VOMD-Datei.';
          this.metadataLoading = false;
          return;
        }
        this.unitMetadata = structuredData.unitProfiles || [];
        this.metadataError = '';
        this.metadataLoading = false;
      },
      error: () => {
        if (token !== this.unitLoadToken) return;
        this.metadataLoading = false;
        this.metadataError = 'Aufgabenmetadaten konnten nicht geladen werden.';
      },
    });
  }

  private loadCodingSchemeSource(unit: UnitViewData, token: number, signal?: AbortSignal) {
    if (unit.codingScheme) {
      this.applyCodingScheme(unit.codingScheme, token);
      return;
    }

    const codingDep = (unit.dependencies || []).find((dependency) => {
      const type = String(dependency?.type || '').toLowerCase();
      return type === 'coding_scheme' || type === 'codingscheme' || type === 'coding';
    });
    if (!codingDep?.downloadUrl) return;

    this.codingSchemeLoading = true;
    fetch(codingDep.downloadUrl, { signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((content) => {
        if (token !== this.unitLoadToken) return;
        this.applyCodingScheme(content, token);
      })
      .catch(() => {
        if (token !== this.unitLoadToken) return;
        this.codingSchemeLoading = false;
        this.codingSchemeError = 'Kodierung konnte nicht geladen werden.';
        this.changeDetector.markForCheck();
      });
  }

  private applyCodingScheme(rawCodingScheme: unknown, token: number) {
    if (token !== this.unitLoadToken) return;
    try {
      const codingScheme =
        typeof rawCodingScheme === 'string' ? JSON.parse(rawCodingScheme) : rawCodingScheme;
      const variableCodings = Array.isArray(codingScheme)
        ? codingScheme
        : Array.isArray((codingScheme as any)?.variableCodings)
          ? (codingScheme as any).variableCodings
          : [];
      const codingSchemeAsText = CodingSchemeTextFactory.asText(variableCodings);
      if (
        codingSchemeAsText.some((coding) => typeof coding.id !== 'string' || !coding.id.trim()) ||
        new Set(codingSchemeAsText.map((coding) => coding.id.toLowerCase())).size !==
          codingSchemeAsText.length
      ) {
        throw new Error('Coding variables require a non-empty ID');
      }
      codingSchemeAsText.forEach((coding, index) => {
        const rawVariable = variableCodings[index];
        if (!rawVariable) return;
        (coding as any).manualInstructionText = rawVariable.manualInstruction;
        coding.codes.forEach((code) => {
          const rawCode = rawVariable.codes?.find(
            (candidate: any) =>
              (candidate.id === null ? 'null' : candidate.id?.toString(10)) === code.id,
          );
          code.ruleSetDescriptions ??= [];
          if (rawCode) {
            (code as any).manualInstructionText = rawCode.manualInstruction;
            (code as any).description = rawCode.label;
            if (
              !code.ruleSetDescriptions.length &&
              ['RESIDUAL', 'RESIDUAL_AUTO'].includes(rawCode.type)
            ) {
              code.ruleSetDescriptions = ['Alle anderen Antworten.'];
            }
          }
        });
      });
      this.codingSchemeAsText = codingSchemeAsText;
      this.codingVariables = variableCodings;
      this.updateReviewSolution();
      this.codingSchemeError = '';
    } catch {
      this.codingSchemeAsText = null;
      this.codingVariables = [];
      this.updateReviewSolution();
      this.codingSchemeError = 'Kodierung konnte nicht gelesen werden.';
    } finally {
      this.codingSchemeLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  private updateReviewSolution() {
    const relevantVariables = this.codingVariables.filter((_, index) => {
      const coding = this.codingSchemeAsText?.[index];
      return (
        coding && !this.isAudioVideoCodingVariable(coding) && this.isRelevantCodingVariable(coding)
      );
    });
    this.reviewSolution = deriveReviewSolution(
      this.codingVariables,
      relevantVariables,
      (variable) => {
        if (!this.definitionContent) return undefined;
        for (const id of [variable.alias, variable.id]) {
          if (typeof id !== 'string' || !id.trim()) continue;
          const target = this.voud.resolvePlayerResponseTarget(this.definitionContent, id);
          // The supported ASPECT player does not reliably render scalar toggle-button
          // prefills. Keep these variables in the readable coding fallback.
          if (target && target.elementType.trim().toLowerCase() !== 'toggle-button') return target;
        }
        return undefined;
      },
    );
  }

  private startPlayerIfReady() {
    if (!this.playerFrameReady || !this.definitionContent || !this.unit || this.playerSessionId)
      return;

    this.startSessionCounter += 1;
    this.playerSessionId = `review-${this.unitId}-${this.startSessionCounter}`;
    this.personalResponseSession =
      this.reviewMode && !this.solutionVisible && this.printMode === 'off';
    this.sendToPlayer({
      type: 'vopStartCommand',
      sessionId: this.playerSessionId,
      unitDefinition: this.definitionContent,
      unitState: {
        dataParts:
          this.solutionVisible && this.reviewSolution.prefill.status === 'available'
            ? mergePlayerSolutionIntoDataParts(
                {},
                this.reviewSolution.prefill.responses,
                this.reviewSolution.prefill.dropLists,
              )
            : { ...this.responseData },
      },
      playerConfig: {
        stateReportPolicy: 'none',
        startPage: String(this.playerPageIds[this.currentPage - 1] ?? this.currentPage - 1),
        pagingMode:
          this.pagingMode === 'view-all' || this.pagingMode === 'print-ids'
            ? 'concat-scroll'
            : this.pagingMode,
        printMode: this.printMode,
        logPolicy: 'disabled',
        directDownloadUrl: GEOGEBRA_PLAYER_RESOURCE_BASE,
        enabledNavigationTargets: ['next', 'previous', 'first', 'last', 'end'],
      },
    });

    this.applyPrintModeLayout();
  }

  private initializePageNavigation() {
    this.currentPage = 1;
    this.playerPageIds = [];
    try {
      const pages = JSON.parse(this.definitionContent || '').pages;
      if (Array.isArray(pages)) {
        // ASPECT numbers scroll pages separately from always-visible pages.
        this.playerPageIds = pages
          .filter((page) => {
            const value = page?.alwaysVisible;
            return value !== true && value !== 1 && String(value).trim().toLowerCase() !== 'true';
          })
          .map((_, index) => String(index));
      }
    } catch {
      // Other players may use a different definition format and report their pages themselves.
    }
    this.totalPages = Math.max(1, this.playerPageIds.length);
  }

  private applyPrintModeLayout() {
    if (this.printMode === 'off' || this.reviewMode) {
      this.playerHeight = '100%';
      this.stopAutoResize();
      return;
    }

    this.playerHeight = '2000px';
    this.startAutoResize();
  }

  private clampPage(page: number): number {
    const max = Math.max(this.totalPages, 1);
    if (page < 1) return 1;
    if (page > max) return max;
    return page;
  }

  private onWindowResize() {
    this.stopReviewPanelResize();
    this.isNarrowLayout = window.innerWidth <= 1100;
    this.reviewPanelWidth = this.clampReviewPanelWidth(this.reviewPanelWidth);
  }

  private isAudioVideoCodingVariable(coding: CodingAsText): boolean {
    const id = coding.id?.toLowerCase() || '';
    const label = coding.label?.toLowerCase() || '';
    return (
      id.includes('audio') ||
      id.includes('video') ||
      label.includes('audio') ||
      label.includes('video')
    );
  }

  private isRelevantCodingVariable(coding: CodingAsText): boolean {
    return Boolean(
      coding.codes.length || coding.hasManualInstruction || (coding as any).manualInstructionText,
    );
  }

  private clampReviewPanelWidth(width: number): number {
    const maxWidth = Math.min(720, Math.max(320, window.innerWidth * 0.6));
    return Math.round(Math.min(maxWidth, Math.max(320, width)));
  }

  private stopReviewPanelResize() {
    const handle = this.panelResizeHandle;
    const pointerId = this.panelResizePointerId;
    this.panelResizePointerId = null;
    this.panelResizeHandle = null;
    window.removeEventListener('pointermove', this.panelResizeMoveHandler, true);
    window.removeEventListener('pointerup', this.panelResizeEndHandler, true);
    window.removeEventListener('pointercancel', this.panelResizeEndHandler, true);
    window.removeEventListener('blur', this.panelResizeBlurHandler);
    handle?.removeEventListener('lostpointercapture', this.panelResizeEndHandler);
    if (pointerId !== null && handle?.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
  }

  private startAutoResize() {
    this.stopAutoResize();
    this.autoResizeInterval = setInterval(() => {
      try {
        const frame = this.playerFrame?.nativeElement;
        const doc = frame?.contentDocument || frame?.contentWindow?.document;
        if (doc && doc.body) {
          const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 600);
          if (height > 0 && this.playerHeight !== `${height}px`) {
            this.playerHeight = `${height}px`;
          }
        }
      } catch (_e) {
        // Fallback for cross-origin or other errors
      }
    }, 500);
  }

  private stopAutoResize() {
    if (this.autoResizeInterval) {
      clearInterval(this.autoResizeInterval);
      this.autoResizeInterval = null;
    }
  }
}
