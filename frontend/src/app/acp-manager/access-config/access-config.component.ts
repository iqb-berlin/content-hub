import {
  CapabilitiesComponent,
  capabilityLabels,
} from '../../shared/capabilities/capabilities.component';
import { Component, Inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import {
  AccessModel,
  Credential,
  CredentialEntry,
  CredentialUploadMode,
  FeatureConfig,
  UpdateAccessConfigRequest,
} from '../../core/models/api.models';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';

@Component({
  selector: 'app-access-config',
  standalone: true,
  imports: [CapabilitiesComponent, FormsModule, RouterLink, AcpManagerContextComponent],
  template: `
    <app-acp-manager-context />

    <div class="page-header"><h1>Zugriff &amp; Funktionen</h1></div>

    @if (configLoaded) {
      <p class="settings-overview" aria-live="polite">
        <strong>{{
          hasUnsavedChanges
            ? 'Ausgewählte Einstellungen (noch nicht gespeichert):'
            : 'Gespeicherte Einstellungen:'
        }}</strong>
        {{
          accessModel === 'PUBLIC'
            ? 'Öffentlich ohne Anmeldung.'
            : accessModel === 'PRIVATE'
              ? 'Zugriff nur für zugewiesene Personen und App-Admins.'
              : 'Zugang mit befristeten ACP-Zugangsdaten sowie über zugewiesene Rollen.'
        }}
        Item-Explorer {{ featureConfig['enableItemList'] ? 'aktiviert' : 'deaktiviert' }}.
        Kommentare {{ featureConfig['enableCommenting'] ? 'aktiviert' : 'deaktiviert' }}.
      </p>
    }
    <!-- Access Model -->
    <div class="card">
      <h2>Wer darf diesen ACP öffnen?</h2>
      <p class="help-text">
        Wählen Sie eine Zugangsart. Änderungen werden erst mit „Änderungen speichern“ übernommen.
      </p>

      <div class="radio-group">
        <label class="radio-option" [class.active]="accessModel === 'PRIVATE'">
          <input
            type="radio"
            name="accessModel"
            value="PRIVATE"
            [(ngModel)]="accessModel"
            (ngModelChange)="onAccessModelChange()"
          />
          <div>
            <strong>Nur zugewiesene Personen</strong>
            <span class="radio-desc"
              >Nur App-Admins und Personen mit zugewiesener ACP-Rolle haben Zugriff</span
            >
          </div>
        </label>
        <label class="radio-option" [class.active]="accessModel === 'PUBLIC'">
          <input
            type="radio"
            name="accessModel"
            value="PUBLIC"
            [(ngModel)]="accessModel"
            (ngModelChange)="onAccessModelChange()"
          />
          <div>
            <strong>Öffentlich – ohne Anmeldung</strong>
            <span class="radio-desc">Jede Person hat ohne Anmeldung Zugriff</span>
          </div>
        </label>
        <label class="radio-option" [class.active]="accessModel === 'CREDENTIALS_LIST'">
          <input
            type="radio"
            name="accessModel"
            value="CREDENTIALS_LIST"
            [(ngModel)]="accessModel"
            (ngModelChange)="onAccessModelChange()"
          />
          <div>
            <strong>Zugang mit ACP-Zugangsdaten</strong>
            <span class="radio-desc"
              >Benutzername/Kennwort-Paare, zeitlich begrenzt (max. 3 Monate)</span
            >
          </div>
        </label>
      </div>

      <p class="help-text">
        App-Admins und Personen mit zugewiesener ACP-Rolle haben unabhängig von der Zugangsart
        Zugriff. Eine Registrierung allein reicht nicht aus.
        <a [routerLink]="['/manage', acpId]" fragment="roles-heading"
          >Personen und Rollen verwalten</a
        >
      </p>
      @if (accessModel === 'PRIVATE') {
        <p class="help-text">
          Dieser ACP ist nicht öffentlich gelistet und nicht anonym erreichbar.
        </p>
      }

      <!-- Credentials section -->
      @if (accessModel === 'CREDENTIALS_LIST') {
        <div class="sub-section">
          <div class="form-row">
            <div class="form-group">
              <label>Gültig von</label>
              <input type="datetime-local" [(ngModel)]="validFrom" />
            </div>
            <div class="form-group">
              <label>Gültig bis (max. 3 Monate)</label>
              <input type="datetime-local" [(ngModel)]="validUntil" />
            </div>
          </div>
          @if (dateError) {
            <div class="alert alert-error">{{ dateError }}</div>
          }

          <!-- Manual add form -->
          <div
            class="manual-add-form"
            style="margin-top: 16px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius);"
          >
            <h4 style="margin: 0 0 12px 0; font-size: 0.95rem;">ACP-Zugang hinzufügen</h4>
            <div class="form-row">
              <div class="form-group">
                <label for="new-credential-username">Benutzername</label>
                <input
                  id="new-credential-username"
                  type="text"
                  [(ngModel)]="newUsername"
                  [disabled]="addingCredential()"
                  placeholder="Benutzername"
                  maxlength="50"
                />
              </div>
              <div class="form-group">
                <label for="new-credential-password">Kennwort</label>
                <input
                  id="new-credential-password"
                  type="password"
                  [(ngModel)]="newPassword"
                  [disabled]="addingCredential()"
                  aria-describedby="credential-password-hint"
                  autocomplete="new-password"
                  placeholder="Kennwort"
                  minlength="12"
                />
                <span id="credential-password-hint" class="help-text">{{
                  strongPasswordHint
                }}</span>
              </div>
            </div>
            <app-capabilities [(value)]="newCapabilities" [disabled]="addingCredential()" />
            @if (addError) {
              <div class="alert alert-error" role="alert" style="margin-top: 8px;">
                {{ addError }}
              </div>
            }
            @if (addSuccess()) {
              <div class="alert alert-success" role="status" style="margin-top: 8px;">
                {{ addSuccess() }}
              </div>
            }
            <button
              class="btn btn-accent"
              type="button"
              style="margin-top: 8px;"
              (click)="addCredential()"
              [disabled]="addingCredential()"
              [attr.aria-busy]="addingCredential()"
            >
              {{ addingCredential() ? 'Wird hinzugefügt …' : 'Hinzufügen' }}
            </button>
          </div>

          <!-- CSV Upload with mode selection -->
          <div
            style="margin-top: 16px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius);"
          >
            <h4 style="margin: 0 0 12px 0; font-size: 0.95rem;">CSV-Import</h4>
            <div class="form-group" style="margin-bottom: 12px;">
              <label>Import-Modus</label>
              <select
                [disabled]="importBusy"
                [(ngModel)]="csvMode"
                (ngModelChange)="cancelCSVPreview()"
                style="width: 100%; padding: 6px; border: 1px solid var(--color-border); border-radius: var(--radius);"
              >
                <option value="replace">Liste ersetzen (nicht enthaltene Zugänge löschen)</option>
                <option value="append">Nur neue hinzufügen (Duplikate überspringen)</option>
                <option value="upsert">
                  Aktualisieren (Passwörter und Rechte ersetzen, neue hinzufügen)
                </option>
              </select>
              <span class="help-text" style="margin-top: 4px;">
                {{
                  csvMode === 'replace'
                    ? 'Nicht enthaltene Zugänge werden gelöscht. Enthaltene Zugänge behalten ihre IDs und erhalten Passwort und Rechte aus dem Import.'
                    : csvMode === 'append'
                      ? 'Nur neue Benutzernamen werden hinzugefügt. Bereits existierende werden übersprungen.'
                      : 'Bereits existierende Benutzernamen erhalten neue Passwörter und das ausgewählte Berechtigungsprofil. Neue werden hinzugefügt.'
                }}
              </span>
            </div>
            <label
              >Importprofil
              <select
                [disabled]="importBusy"
                [(ngModel)]="importProfile"
                (ngModelChange)="cancelCSVPreview()"
              >
                <option value="REVIEW_ONLY">Nur Review (Teilnahme)</option>
                <option value="ITEM_EXPLORER_ONLY">Nur Item Explorer (Lesen)</option>
                <option value="BOTH">Beides (Teilnahme und Lesen)</option>
                <option value="CUSTOM">Benutzerdefiniert</option>
              </select>
            </label>
            @if (importProfile === 'CUSTOM') {
              <app-capabilities
                [disabled]="importBusy"
                [(value)]="importCapabilities"
                (valueChange)="cancelCSVPreview()"
              />
            }
            <div style="display: flex; gap: 12px; align-items: center;">
              <label class="btn btn-accent">
                CSV hochladen
                <input
                  type="file"
                  [disabled]="importBusy"
                  accept=".csv,.tsv,.txt"
                  (change)="previewCSV($event)"
                  hidden
                />
              </label>
              <span class="help-text"
                >UTF-8; Komma, Semikolon oder Tab; optional mit Kopfzeile</span
              >
            </div>
          </div>

          @if (importError) {
            <div class="alert alert-error" style="white-space: pre-line">{{ importError }}</div>
          }
          <!-- CSV Preview Modal -->
          @if (csvPreview) {
            <div
              class="csv-preview"
              style="margin-top: 16px; padding: 16px; background: var(--color-bg); border-radius: var(--radius); border: 1px solid var(--color-border);"
            >
              <h4 style="margin: 0 0 12px 0;">Vorschau: {{ csvPreview.filename }}</h4>
              <div
                style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; font-size: 0.9rem;"
              >
                <div
                  class="preview-stat"
                  style="text-align: center; padding: 8px; background: white; border-radius: var(--radius);"
                >
                  <div style="font-size: 1.5rem; font-weight: 600; color: var(--color-primary);">
                    {{ csvPreview.total }}
                  </div>
                  <div style="color: var(--color-text-secondary); font-size: 0.8rem;">
                    Gesamt in CSV
                  </div>
                </div>
                <div
                  class="preview-stat"
                  style="text-align: center; padding: 8px; background: rgba(46, 204, 113, 0.1); border-radius: var(--radius);"
                >
                  <div style="font-size: 1.5rem; font-weight: 600; color: var(--color-success);">
                    {{ csvPreview.toAdd }}
                  </div>
                  <div style="color: var(--color-text-secondary); font-size: 0.8rem;">
                    Neu hinzufügen
                  </div>
                </div>
                <div
                  class="preview-stat"
                  style="text-align: center; padding: 8px; background: rgba(241, 196, 15, 0.1); border-radius: var(--radius);"
                >
                  <div style="font-size: 1.5rem; font-weight: 600; color: #f39c12;">
                    {{ csvPreview.toUpdate }}
                  </div>
                  <div style="color: var(--color-text-secondary); font-size: 0.8rem;">
                    Aktualisieren
                  </div>
                </div>
                <div
                  class="preview-stat"
                  style="text-align: center; padding: 8px; background: rgba(149, 165, 166, 0.1); border-radius: var(--radius);"
                >
                  <div
                    style="font-size: 1.5rem; font-weight: 600; color: var(--color-text-secondary);"
                  >
                    {{ csvPreview.toSkip }}
                  </div>
                  <div style="color: var(--color-text-secondary); font-size: 0.8rem;">
                    Überspringen
                  </div>
                </div>
              </div>
              @if (csvPreview.duplicates.length > 0) {
                <div class="alert alert-warning" style="margin-bottom: 12px;">
                  <strong>Warnung:</strong> {{ csvPreview.duplicates.length }} Duplikate im CSV
                  gefunden: {{ csvPreview.duplicates.join(', ') }}
                </div>
              }
              @if (csvPreview.conflicts.length > 0) {
                <div class="alert alert-warning" style="margin-bottom: 12px;">
                  <strong>Bereits existierend:</strong> {{ csvPreview.conflicts.join(', ') }}
                </div>
              }
              @for (change of importChanges; track change.username) {
                <p>
                  <strong>{{ change.username }}</strong
                  >: {{ importActionLabels[change.action] }}<br />
                  Rechte: {{ capabilityLabels(change.before) }} →
                  {{ capabilityLabels(change.after) }}
                </p>
              }
              @if (importRemoved.length) {
                <p>Zu löschen: {{ importRemoved.join(', ') }}</p>
              }
              <div style="display: flex; gap: 12px;">
                <button
                  class="btn btn-primary"
                  [disabled]="importBusy"
                  (click)="confirmCSVUpload()"
                >
                  Importieren
                </button>
                <button
                  class="btn btn-outline"
                  [disabled]="importBusy"
                  (click)="cancelCSVPreview()"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          }

          @if (credentialCount > 0 || credentials.length > 0) {
            <div class="alert alert-success" style="margin-top:12px">
              {{ credentialCount || credentials.length }} Zugangsdaten vorhanden.
            </div>
          }

          <!-- Credentials list with edit -->
          @if (credentials.length > 0) {
            <div class="credentials-list" style="margin-top:16px">
              <table class="credentials-table">
                <thead>
                  <tr>
                    <th>Benutzername</th>
                    <th style="width: 120px">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  @for (cred of credentials; track cred.id) {
                    <tr>
                      <td>{{ cred.username }}</td>
                      <td>
                        <button
                          class="btn btn-outline btn-sm"
                          (click)="openEditDialog(cred)"
                          style="margin-right: 4px;"
                        >
                          Bearbeiten
                        </button>
                        <button class="btn btn-outline btn-sm" (click)="deleteCredential(cred.id)">
                          Löschen
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </div>

    <!-- Feature Configuration -->
    <div class="card">
      <h2>Verfügbare Funktionen und Darstellung</h2>
      <p class="help-text">
        Funktionsfreigaben gelten für Personen ohne Verwaltungsrechte. Darstellungseinstellungen
        gelten auch in der Verwaltung; Ausnahmen sind gekennzeichnet.
      </p>

      <!-- Start page -->
      <div class="feature-section start-page-section">
        <h3>Auf dieser Startseite anzeigen</h3>
        <p class="help-text">
          Diese Schalter steuern nur die sichtbaren Einstiege. Sie vergeben oder entziehen keine
          Funktionsrechte. Item-Explorer, Aufgabenansicht und Aufgabenfolgen werden in den
          jeweiligen Bereichen separat freigegeben; Review-Zugänge werden unter Review verwaltet.
        </p>
        @for (feat of startPageFlags; track feat.key) {
          <label class="feature-toggle">
            <input type="checkbox" [(ngModel)]="featureConfig[feat.key]" />
            <span>{{ feat.label }}</span>
          </label>
        }
      </div>

      <div class="basic-functions">
        <!-- Downloads -->
        <div class="feature-section">
          <h3>Downloads</h3>
          @for (feat of downloadFlags; track feat.key) {
            <label class="feature-toggle">
              <input type="checkbox" [(ngModel)]="featureConfig[feat.key]" />
              <span>{{ feat.label }}</span>
            </label>
          }
        </div>

        <!-- Unit View -->
        <div class="feature-section">
          <h3>Aufgabenansicht</h3>
          @for (feat of unitViewFlags; track feat.key) {
            <label class="feature-toggle">
              <input type="checkbox" [(ngModel)]="featureConfig[feat.key]" />
              <span>{{ feat.label }}</span>
            </label>
          }
        </div>

        <!-- Navigation -->
        <div class="feature-section">
          <h3>Navigation</h3>
          @for (feat of navFlags; track feat.key) {
            <label class="feature-toggle">
              <input type="checkbox" [(ngModel)]="featureConfig[feat.key]" />
              <span>{{ feat.label }}</span>
            </label>
          }
        </div>
      </div>
      <!-- Commenting -->
      <div class="feature-section">
        <h3>Kommentare</h3>
        <label class="feature-toggle">
          <input type="checkbox" [(ngModel)]="featureConfig['enableCommenting']" />
          <span>Kommentare aktivieren</span>
        </label>
        @if (featureConfig['enableCommenting']) {
          <div class="indent-section">
            <label class="help-text">Kommentierbare Elemente:</label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [checked]="commentTargets.includes('UNIT')"
                (change)="toggleCommentTarget('UNIT')"
              />
              <span>Aufgaben</span>
            </label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [checked]="commentTargets.includes('ITEM')"
                (change)="toggleCommentTarget('ITEM')"
              />
              <span>Items</span>
            </label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [checked]="commentTargets.includes('BOOKLET')"
                (change)="toggleCommentTarget('BOOKLET')"
              />
              <span>Testhefte</span>
            </label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [checked]="commentTargets.includes('CODING')"
                (change)="toggleCommentTarget('CODING')"
              />
              <span>Kodierung</span>
            </label>
            <p class="help-text">
              Sichtbarkeit, Review-Gruppen und die Aktivierung des Reviews werden unter
              <a [routerLink]="['/view', acpId, 'review', 'manage']">Review</a> verwaltet.
            </p>
          </div>
        }
      </div>

      <!-- Item List -->
      <div class="feature-section">
        <h3>Item-Explorer</h3>
        @for (feat of itemFlags; track feat.key) {
          <label class="feature-toggle">
            <input type="checkbox" [(ngModel)]="featureConfig[feat.key]" />
            <span>{{ feat.label }}</span>
          </label>
        }
        <p class="help-text">
          Die Freigabe des Item-Explorers betrifft Personen ohne Verwaltungsrechte und ohne
          gesonderte Explorer-Berechtigung. Darstellung und Datenzuordnung bleiben für die
          Verwaltung konfigurierbar. Die Hervorhebung gilt auch in der separaten Item-Ansicht.
        </p>
        <div class="explorer-options">
          <details class="settings-details">
            <summary>Inhalte und Darstellung</summary>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [(ngModel)]="featureConfig[showGeneralCodingInstructionsKey]"
              />
              <span>Allgemeine Kodierungshinweise anzeigen</span>
            </label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [(ngModel)]="featureConfig[preferManualCodingInstructionsKey]"
              />
              <span>Manuelle Kodieranweisungen bevorzugt anzeigen</span>
            </label>
            <p class="help-text">
              Wenn eine manuelle Anweisung vorliegt, werden die automatischen Kodierregeln
              ausgeblendet. Die Kodierung selbst bleibt unverändert.
            </p>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [(ngModel)]="featureConfig[enableItemExplorerConditionalVisibilityKey]"
              />
              <span>Bedingte Sichtbarkeit im Item-Explorer-Player anwenden</span>
            </label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [(ngModel)]="featureConfig[showOnlyItemsWithEmpiricalDifficultyKey]"
              />
              <span>Im Item-Explorer nur Items mit Itemschwierigkeit anzeigen</span>
            </label>
            <label class="feature-toggle">
              <input type="checkbox" [(ngModel)]="featureConfig[enablePlayerFocusHighlightKey]" />
              <span>Item im Player hervorheben (Explorer + Item-Ansicht)</span>
            </label>
          </details>
          <details class="settings-details">
            <summary>Erweiterte Einstellungen: Datenzuordnung und Player-Diagnose</summary>
            <p class="help-text">
              Für die Einrichtung importierter Daten und die Prüfung der Player-Zuordnung.
            </p>
            <div class="indent-section">
              <label class="help-text" for="item-sub-id-label">Bezeichnung der Sub-ID-Spalte</label>
              <input
                id="item-sub-id-label"
                class="tag-input"
                type="text"
                [(ngModel)]="featureConfig[itemSubIdLabelKey]"
                placeholder="Sub-ID"
              />
              <span class="help-text">
                Die zweite Spalte einer Itemschwierigkeits-CSV wird als Sub-ID/Kategorie/Stufe
                verwendet.
              </span>
              <label class="help-text" style="margin-top: 10px;"
                >Anzeigenamen der Ausprägungen</label
              >
              <div class="tags-editor">
                @for (entry of itemSubIdLabelEntries; track $index) {
                  <div class="tag-add">
                    <input
                      class="tag-input"
                      type="text"
                      [(ngModel)]="entry.value"
                      placeholder="Wert, z. B. 1"
                    />
                    <input
                      class="tag-input"
                      type="text"
                      [(ngModel)]="entry.label"
                      placeholder="Anzeigename, z. B. teilweise richtig"
                    />
                    <button class="tag-remove" type="button" (click)="removeItemSubIdLabel($index)">
                      ✕
                    </button>
                  </div>
                }
                <button class="btn btn-outline btn-sm" type="button" (click)="addItemSubIdLabel()">
                  + Ausprägung
                </button>
              </div>
            </div>
            <div class="indent-section">
              <label class="help-text">Zusätzliche Metadatenspalten</label>
              <span class="help-text">
                Diese Spalten werden im Item-Explorer auch dann angeboten, wenn sie nicht in den
                VOMD-/Importdaten definiert sind. Der Wert wird über die jeweilige Metadaten-ID
                gelesen.
              </span>
              <div class="tags-editor" style="margin-top: 8px;">
                @for (entry of metadataColumnDefinitions; track $index) {
                  <div class="tag-add">
                    <input
                      class="tag-input"
                      type="text"
                      [(ngModel)]="entry.id"
                      placeholder="Metadaten-ID"
                      [attr.aria-label]="'ID der zusätzlichen Spalte ' + ($index + 1)"
                    />
                    <input
                      class="tag-input"
                      type="text"
                      [(ngModel)]="entry.label"
                      placeholder="Anzeigename"
                      [attr.aria-label]="'Name der zusätzlichen Spalte ' + ($index + 1)"
                    />
                    <button
                      class="tag-remove"
                      type="button"
                      (click)="removeMetadataColumnDefinition($index)"
                    >
                      ✕
                    </button>
                  </div>
                }
                <button
                  class="btn btn-outline btn-sm"
                  type="button"
                  (click)="addMetadataColumnDefinition()"
                >
                  + Spalte
                </button>
              </div>
            </div>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [(ngModel)]="featureConfig[showAudioVideoCodingVariablesKey]"
              />
              <span>Kodierungsvariablen mit "audio"/"video" im Namen anzeigen</span>
            </label>
            <label class="feature-toggle">
              <input
                type="checkbox"
                [(ngModel)]="featureConfig[showItemExplorerPlayerTargetInfoKey]"
              />
              <span>
                Zusätzliche Player-Zuordnungsinfos im Item-Explorer anzeigen (für Manager/Admins)
              </span>
            </label>
          </details>
          @if (featureConfig['enableItemListTags']) {
            <div class="indent-section">
              <label class="help-text">Gemeinsam verfügbare Item-Tags:</label>
              <div class="tags-editor">
                @for (tag of availableTags; track $index) {
                  <div class="tag-item">
                    <span class="badge badge-info">{{ tag }}</span>
                    <button class="tag-remove" (click)="removeTag($index)">✕</button>
                  </div>
                }
                <div class="tag-add">
                  <input
                    type="text"
                    [(ngModel)]="newTag"
                    placeholder="Neuer Tag..."
                    (keyup.enter)="addTag()"
                    class="tag-input"
                  />
                  <button
                    class="btn btn-outline btn-sm"
                    (click)="addTag()"
                    [disabled]="!newTag.trim()"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      </div>
      <div class="feature-section">
        <h3>Persönliche Arbeit</h3>
        <p class="help-text">
          Kategorien, Markierungen, Notizen und Auswahllisten gehören jeweils der nutzenden Person.
        </p>
        <label class="feature-toggle">
          <input type="checkbox" [(ngModel)]="featureConfig[enablePersonalItemDataKey]" />
          <span>Persönliche Kategorien, Markierungen und Notizen aktivieren</span>
        </label>
        <label class="feature-toggle">
          <input type="checkbox" [(ngModel)]="featureConfig[enableItemCollectionsKey]" />
          <span>Persönliche Item-Auswahllisten aktivieren</span>
        </label>
        @if (featureConfig[enablePersonalItemDataKey]) {
          <div class="indent-section personal-data-config">
            <label class="help-text" for="personal-item-category-label">
              Bezeichnung der Kategorie
            </label>
            <input
              id="personal-item-category-label"
              class="tag-input"
              type="text"
              [(ngModel)]="featureConfig[personalItemCategoryLabelKey]"
              placeholder="Kompetenzstufe"
            />

            <label class="help-text" style="margin-top: 10px;">Mögliche Kategorien</label>
            <div class="tags-editor">
              @for (value of personalItemCategoryValues; track $index) {
                <div class="tag-add">
                  <input
                    class="tag-input"
                    type="text"
                    [(ngModel)]="personalItemCategoryValues[$index]"
                    placeholder="z. B. Stufe I"
                  />
                  <button
                    class="tag-remove"
                    type="button"
                    (click)="removePersonalItemCategoryValue($index)"
                  >
                    ✕
                  </button>
                </div>
              }
              <button
                class="btn btn-outline btn-sm"
                type="button"
                (click)="addPersonalItemCategoryValue()"
              >
                + Kategorie
              </button>
            </div>

            <label class="help-text" for="personal-item-tag-label" style="margin-top: 10px;">
              Bezeichnung der Markierungen
            </label>
            <input
              id="personal-item-tag-label"
              class="tag-input"
              type="text"
              [(ngModel)]="featureConfig[personalItemTagLabelKey]"
              placeholder="Markierungen"
            />

            <label class="help-text" style="margin-top: 10px;">Markierungen und Farben</label>
            <div class="tags-editor">
              @for (tag of personalItemTags; track $index) {
                <div class="tag-add personal-tag-config-row">
                  <input
                    class="tag-color-input"
                    type="color"
                    [(ngModel)]="tag.color"
                    [attr.aria-label]="'Farbe für ' + (tag.label || 'Markierung')"
                  />
                  <input
                    class="tag-input"
                    type="text"
                    [(ngModel)]="tag.label"
                    placeholder="z. B. Rückfrage"
                  />
                  <button class="tag-remove" type="button" (click)="removePersonalItemTag($index)">
                    ✕
                  </button>
                </div>
              }
              <button class="btn btn-outline btn-sm" type="button" (click)="addPersonalItemTag()">
                + Markierung
              </button>
            </div>
            <span class="help-text">
              Kategorien, Markierungen und Notizen sind immer persönlich und werden nicht im
              ACP-Entwurf veröffentlicht.
            </span>
          </div>
        }

        <label class="feature-toggle">
          <input type="checkbox" [(ngModel)]="featureConfig['persistUserPreferences']" />
          <span>Ansichtseinstellungen nach erneuter Anmeldung wiederherstellen</span>
        </label>
      </div>

      <div class="save-bar">
        <div aria-live="polite">
          <strong>{{
            hasUnsavedChanges ? 'Ungespeicherte Änderungen' : 'Keine ungespeicherten Änderungen'
          }}</strong>
          <span class="help-text"
            >Zugriff, Funktionen und Darstellung werden gemeinsam gespeichert.</span
          >
          @if (featuresSaved && !hasUnsavedChanges) {
            <span class="save-indicator">✓ Gespeichert</span>
          }
        </div>
        <button
          class="btn btn-primary"
          [disabled]="saving || !configLoaded || !hasUnsavedChanges"
          (click)="saveFeatures()"
        >
          {{ saving ? 'Wird gespeichert …' : 'Änderungen speichern' }}
        </button>
      </div>
      @if (saveError) {
        <p class="alert alert-error" role="alert">{{ saveError }}</p>
      }
      <!-- Edit Dialog -->
      @if (editingCredential) {
        <div class="dialog-overlay" (click)="closeEditDialog()">
          <div class="dialog-content card" (click)="$event.stopPropagation()">
            <div class="dialog-header">
              <h3>ACP-Zugang bearbeiten</h3>
              <button class="btn btn-outline btn-sm" (click)="closeEditDialog()">✕</button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label>Benutzername</label>
                <input type="text" [(ngModel)]="editUsername" maxlength="50" />
              </div>
              <div class="form-group" style="margin-top: 12px;">
                <label>
                  <input type="checkbox" [(ngModel)]="editChangePassword" /> Kennwort ändern
                </label>
              </div>
              @if (editChangePassword) {
                <div class="form-group" style="margin-top: 8px;">
                  <label
                    >Neues Kennwort (mind. 12 Zeichen, Groß-/Kleinbuchstabe, Zahl,
                    Sonderzeichen)</label
                  >
                  <input
                    type="password"
                    [(ngModel)]="editPassword"
                    minlength="12"
                    placeholder="Neues Kennwort"
                  />
                </div>
              }
              <app-capabilities [(value)]="editCapabilities" />
              @if (editError) {
                <div class="alert alert-error" style="margin-top: 12px;">{{ editError }}</div>
              }
            </div>
            <div
              class="dialog-footer"
              style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;"
            >
              <button class="btn btn-outline" (click)="closeEditDialog()">Abbrechen</button>
              <button
                class="btn btn-primary"
                (click)="saveEdit()"
                [disabled]="editChangePassword && !isStrongPassword(editPassword)"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 1120px;
        margin-inline: auto;
        padding-bottom: 24px;
      }
      h2 {
        font-size: 1.2rem;
        margin: 0 0 12px;
      }
      .settings-overview {
        line-height: 1.6;
        margin-bottom: 24px;
        color: var(--color-text-secondary);
      }
      .settings-overview strong {
        display: block;
        color: var(--color-text);
      }
      .basic-functions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 24px;
      }
      .basic-functions .feature-section {
        border-top: 0;
      }
      @media (max-width: 850px) {
        .basic-functions {
          grid-template-columns: 1fr;
          gap: 0;
        }
      }
      .settings-details {
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 12px 16px;
        margin: 12px 0;
      }
      summary {
        cursor: pointer;
        font-weight: 600;
        padding: 4px 0;
      }
      .settings-details[open] summary {
        margin-bottom: 12px;
      }
      .explorer-options {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      .save-bar {
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 16px;
        margin-top: 24px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        z-index: 2;
      }
      .save-bar .help-text {
        margin: 4px 0 0;
      }
      .tag-input {
        max-width: 100%;
      }
      @media (max-width: 640px) {
        .form-row {
          grid-template-columns: 1fr !important;
        }
        .save-bar {
          flex-direction: column;
          align-items: stretch;
        }
        .tag-add {
          flex-wrap: wrap;
        }
        .indent-section {
          margin-left: 12px;
        }
      }
      .help-text {
        color: var(--color-text-secondary);
        font-size: 0.85rem;
        display: block;
        margin-bottom: 8px;
      }
      .radio-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 12px 0;
      }
      .radio-option {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 16px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        cursor: pointer;
        transition: all 0.15s;
      }
      .radio-option:hover {
        border-color: var(--color-primary-light);
      }
      .radio-option.active {
        border-color: var(--color-primary);
        background: rgba(26, 82, 118, 0.03);
      }
      .radio-option input {
        margin-top: 3px;
      }
      .radio-option strong {
        display: block;
        font-size: 0.95rem;
      }
      .radio-desc {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }
      .sub-section {
        margin-top: 16px;
        padding: 16px;
        background: var(--color-bg);
        border-radius: var(--radius);
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .feature-section {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }
      .feature-section:first-of-type {
        border-top: none;
      }
      .feature-section h3 {
        font-size: 0.95rem;
        margin-bottom: 8px;
      }
      .feature-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 0;
        cursor: pointer;
        font-size: 0.9rem;
      }
      .feature-toggle input[type='checkbox'] {
        width: 18px;
        height: 18px;
        accent-color: var(--color-primary);
      }

      .indent-section {
        margin-left: 26px;
        padding: 8px 0;
      }
      .tags-editor {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin: 8px 0;
      }
      .personal-data-config {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }
      .personal-data-config > .tag-input,
      .personal-data-config > .tags-editor {
        width: 100%;
      }
      .personal-tag-config-row {
        align-items: center;
      }
      .tag-color-input {
        width: 42px;
        height: 32px;
        padding: 2px;
        border: 1px solid var(--color-border);
        border-radius: 4px;
        background: var(--color-surface);
      }
      .tag-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .tag-remove {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.7rem;
        color: var(--color-text-secondary);
        padding: 2px;
      }
      .tag-remove:hover {
        color: var(--color-danger);
      }
      .tag-add {
        display: flex;
        gap: 4px;
      }
      .tag-input {
        width: 120px;
        padding: 4px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-size: 0.85rem;
      }

      .save-indicator {
        margin-left: 12px;
        color: var(--color-success);
        font-size: 0.85rem;
        font-weight: 500;
      }
      .credentials-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      .credentials-table th,
      .credentials-table td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--color-border);
      }
      .credentials-table th {
        font-weight: 600;
        color: var(--color-text-secondary);
        font-size: 0.85rem;
      }
      .credentials-table tr:hover {
        background: rgba(0, 0, 0, 0.02);
      }
      .dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 24px;
      }
      .dialog-content {
        max-width: 400px;
        width: 100%;
      }
      .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .dialog-header h3 {
        margin: 0;
      }
    `,
  ],
})
export class AccessConfigComponent implements OnInit {
  readonly capabilityLabels = capabilityLabels;
  readonly importActionLabels: Record<string, string> = {
    add: 'Hinzufügen',
    update: 'Aktualisieren',
    skip: 'Unverändert lassen',
  };
  private readonly strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
  readonly strongPasswordHint =
    'Kennwort muss mindestens 12 Zeichen lang sein und Groß-/Kleinbuchstaben, Zahl und Sonderzeichen enthalten.';
  readonly showAudioVideoCodingVariablesKey = 'showAudioVideoCodingVariables';
  readonly showGeneralCodingInstructionsKey = 'showGeneralCodingInstructions';
  readonly preferManualCodingInstructionsKey = 'preferManualCodingInstructions';
  readonly enableItemExplorerConditionalVisibilityKey = 'enableItemExplorerConditionalVisibility';
  readonly showOnlyItemsWithEmpiricalDifficultyKey = 'showOnlyItemsWithEmpiricalDifficulty';
  readonly enablePlayerFocusHighlightKey = 'enablePlayerFocusHighlight';
  readonly showItemExplorerPlayerTargetInfoKey = 'showItemExplorerPlayerTargetInfo';
  readonly itemSubIdLabelKey = 'itemSubIdLabel';
  readonly itemSubIdLabelsKey = 'itemSubIdLabels';
  readonly enablePersonalItemDataKey = 'enablePersonalItemData';
  readonly enableItemCollectionsKey = 'enableItemCollections';
  readonly personalItemCategoryLabelKey = 'personalItemCategoryLabel';
  readonly personalItemCategoryValuesKey = 'personalItemCategoryValues';
  readonly personalItemTagLabelKey = 'personalItemTagLabel';
  readonly personalItemTagsKey = 'personalItemTags';

  acpId = '';
  accessModel: AccessModel = 'PRIVATE';
  allowRegistered = false;
  validFrom = '';
  validUntil = '';
  private readonly DATETIME_LOCAL_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  credentialCount = 0;
  dateError = '';
  featureConfig: FeatureConfig = {};
  commentTargets: string[] = [];
  availableTags: string[] = [];
  newTag = '';
  itemSubIdLabelEntries: Array<{ value: string; label: string }> = [];
  personalItemCategoryValues: string[] = [];
  personalItemTags: Array<{ label: string; color: string }> = [];
  metadataColumnDefinitions: Array<{ id: string; label: string }> = [];
  configLoaded = false;
  saving = false;
  saveError = '';
  private savedSettings = '';

  private settingsSnapshot(): string {
    return JSON.stringify([
      this.accessModel,
      this.validFrom,
      this.validUntil,
      this.featureConfig,
      this.commentTargets,
      this.availableTags,
      this.itemSubIdLabelEntries,
      this.metadataColumnDefinitions,
      this.personalItemCategoryValues,
      this.personalItemTags,
    ]);
  }

  get hasUnsavedChanges(): boolean {
    return this.configLoaded && this.settingsSnapshot() !== this.savedSettings;
  }
  featuresSaved = false;
  credentials: Credential[] = [];

  // Manual add form
  newCapabilities: string[] = [];
  editCapabilities: string[] = [];
  importCapabilities: string[] = [];
  importProfile = 'REVIEW_ONLY';
  private importPreviewVersion = 0;
  importError = '';
  importBusy = false;
  importFile: File | null = null;
  importChanges: any[] = [];
  importRemoved: string[] = [];
  newUsername = '';
  newPassword = '';
  addError = '';
  readonly addingCredential = signal(false);
  readonly addSuccess = signal('');

  // CSV upload
  csvMode: CredentialUploadMode = 'replace';
  csvPreview: {
    filename: string;
    total: number;
    toAdd: number;
    toUpdate: number;
    toSkip: number;
    duplicates: string[];
    conflicts: string[];
    credentials: CredentialEntry[];
  } | null = null;
  pendingCSVUpload: CredentialEntry[] = [];

  // Edit dialog
  editingCredential: Credential | null = null;
  editUsername = '';
  editChangePassword = false;
  editPassword = '';
  editError = '';

  downloadFlags = [
    { key: 'allowIndexDownload', label: 'ACP-Index herunterladen erlauben' },
    { key: 'allowUnitDownload', label: 'Aufgaben-Download erlauben (ZIP)' },
    { key: 'allowFileDownload', label: 'Weitere ACP-Dateien herunterladen erlauben' },
  ];

  unitViewFlags = [
    { key: 'enableUnitView', label: 'Interaktive Aufgabenansicht aktivieren' },
    { key: 'showMetadata', label: 'Metadaten anzeigen' },
    { key: 'showRichText', label: 'RichText-Inhalte anzeigen' },
    { key: 'showCodingScheme', label: 'Kodierschema anzeigen' },
  ];

  navFlags = [
    { key: 'enableSequenceNavigation', label: 'Testhefte und Aufgabenfolgen aktivieren' },
  ];

  startPageFlags = [
    { key: 'showItemExplorerOnStartPage', label: 'Item-Explorer' },
    { key: 'showUnitListOnStartPage', label: 'Aufgaben ansehen' },
    { key: 'showSequencesOnStartPage', label: 'Testhefte und Aufgabenfolgen' },
    { key: 'showIndexOnStartPage', label: 'Paketstruktur (ACP-Index)' },
  ];

  itemFlags = [
    { key: 'enableItemList', label: 'Item-Explorer aktivieren' },
    { key: 'enableItemClick', label: 'Aufgabe durch Klick auf ein Item öffnen' },
    { key: 'enableItemListFilter', label: 'Items filtern erlauben' },
    { key: 'enableItemListSort', label: 'Items sortieren erlauben' },
    { key: 'enableItemListTags', label: 'Gemeinsame Item-Tags bearbeiten erlauben' },
  ];

  constructor(
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ApiService) private api: ApiService,
  ) {}

  ngOnInit() {
    this.acpId = this.route.parent?.snapshot.paramMap.get('acpId') || '';
    this.loadConfig();
    this.loadCredentials();
  }

  private toDateTimeLocalString(isoDateString: string | null | undefined): string {
    if (!isoDateString) return '';
    // Parse the UTC date from backend and convert to local datetime-local format
    const utcDate = new Date(isoDateString);
    if (isNaN(utcDate.getTime())) return '';
    console.log('Loading date from backend:', { isoDateString, utcDate: utcDate.toString() });

    // Convert UTC to local time components
    const year = utcDate.getFullYear();
    const month = String(utcDate.getMonth() + 1).padStart(2, '0');
    const day = String(utcDate.getDate()).padStart(2, '0');
    const hours = String(utcDate.getHours()).padStart(2, '0');
    const minutes = String(utcDate.getMinutes()).padStart(2, '0');

    const result = `${year}-${month}-${day}T${hours}:${minutes}`;
    console.log('Converted to local:', { result });
    return result;
  }

  private getNowDateTimeLocal(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private dateTimeLocalToIso(dateTimeLocal: string): string {
    // Parse datetime-local format (YYYY-MM-DDTHH:mm) as local time and convert to UTC
    const [datePart, timePart] = dateTimeLocal.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);

    // Create date in local time (months are 0-indexed in JS)
    const localDate = new Date(year, month - 1, day, hours, minutes);

    // Convert to UTC ISO string
    const result = localDate.toISOString();
    console.log('Saving date:', { input: dateTimeLocal, localDate: localDate.toString(), result });
    return result;
  }

  loadConfig() {
    this.api.getAccessConfig(this.acpId).subscribe({
      next: (config) => {
        this.accessModel = config.accessModel;
        this.allowRegistered = config.allowRegistered || false;
        this.featureConfig = config.featureConfig || {};
        this.applyFeatureConfigDefaults();
        this.validFrom = this.toDateTimeLocalString(config.validFrom);
        this.validUntil = this.toDateTimeLocalString(config.validUntil);
        this.commentTargets = this.featureConfig['commentTargets'] || [];
        this.availableTags = this.featureConfig['availableTags'] || [];
        this.itemSubIdLabelEntries = Object.entries(
          this.featureConfig[this.itemSubIdLabelsKey] || {},
        ).map(([value, label]) => ({ value, label }));
        const categoryValues = this.featureConfig[this.personalItemCategoryValuesKey];
        this.personalItemCategoryValues = Array.isArray(categoryValues) ? [...categoryValues] : [];
        const personalTags = this.featureConfig[this.personalItemTagsKey];
        this.personalItemTags = Array.isArray(personalTags)
          ? personalTags.map((tag) => ({
              label: String(tag?.label || ''),
              color: /^#[0-9a-f]{6}$/i.test(String(tag?.color || ''))
                ? String(tag.color)
                : '#3498db',
            }))
          : [];
        const metadataColumns = this.featureConfig['metadataColumns'];
        this.metadataColumnDefinitions = Array.isArray(metadataColumns?.definitions)
          ? metadataColumns.definitions.map((entry) => ({
              id: String(entry?.id || ''),
              label: String(entry?.label || ''),
            }))
          : [];
        this.savedSettings = this.settingsSnapshot();
        this.configLoaded = true;
      },
      error: () => {
        this.saveError =
          'Die Einstellungen konnten nicht geladen werden. Bitte laden Sie die Seite erneut.';
      },
    });
  }

  loadCredentials() {
    this.api.getCredentials(this.acpId).subscribe({
      next: (creds) => {
        this.credentials = creds;
      },
      error: () => {
        this.credentials = [];
      },
    });
  }

  onAccessModelChange() {
    // Enforce mutual exclusion between the three base access models.
    this.dateError = '';
    // Auto-fill validFrom with current time when switching to CREDENTIALS_LIST
    if (this.accessModel === 'CREDENTIALS_LIST' && !this.validFrom) {
      this.validFrom = this.getNowDateTimeLocal();
    }
  }

  validateDates(): boolean {
    if (this.accessModel !== 'CREDENTIALS_LIST') return true;
    if (!this.validFrom || !this.validUntil) {
      this.dateError = 'Start- und Enddatum sind erforderlich.';
      return false;
    }
    const from = new Date(this.validFrom);
    const until = new Date(this.validUntil);
    if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
      this.dateError = 'Bitte geben Sie gültige Datumswerte ein.';
      return false;
    }
    const maxEnd = new Date(from);
    maxEnd.setMonth(maxEnd.getMonth() + 3);
    if (until > maxEnd) {
      this.dateError = 'Maximaler Zeitraum: 3 Monate.';
      return false;
    }
    if (until <= from) {
      this.dateError = 'Enddatum muss nach dem Startdatum liegen.';
      return false;
    }
    this.dateError = '';
    return true;
  }

  saveFeatures() {
    if (this.saving) return;
    this.saveError = '';
    if (!this.validateDates()) {
      this.saveError = this.dateError;
      return;
    }
    this.applyFeatureConfigDefaults();
    this.featureConfig[this.itemSubIdLabelsKey] = Object.fromEntries(
      this.itemSubIdLabelEntries
        .map((entry) => ({ value: entry.value.trim(), label: entry.label.trim() }))
        .filter((entry) => entry.value && entry.label)
        .map((entry) => [entry.value, entry.label]),
    );
    this.featureConfig[this.personalItemCategoryValuesKey] = Array.from(
      new Set(this.personalItemCategoryValues.map((value) => value.trim()).filter(Boolean)),
    );
    this.featureConfig[this.personalItemTagsKey] = this.personalItemTags
      .map((tag) => ({ label: tag.label.trim(), color: tag.color }))
      .filter((tag) => tag.label);
    const metadataColumns =
      this.featureConfig['metadataColumns'] &&
      typeof this.featureConfig['metadataColumns'] === 'object'
        ? this.featureConfig['metadataColumns']
        : {};
    this.featureConfig['metadataColumns'] = {
      ...metadataColumns,
      definitions: this.metadataColumnDefinitions
        .map((entry) => ({ id: entry.id.trim(), label: entry.label.trim() }))
        .filter((entry) => entry.id && entry.label),
    };
    this.featureConfig['commentTargets'] = this.commentTargets;
    this.featureConfig['availableTags'] = this.availableTags;
    const data: UpdateAccessConfigRequest = {
      accessModel: this.accessModel,
      allowRegistered: this.allowRegistered,
      featureConfig: this.featureConfig,
    };
    if (this.accessModel === 'CREDENTIALS_LIST' && this.validFrom && this.validUntil) {
      data.validFrom = this.dateTimeLocalToIso(this.validFrom);
      data.validUntil = this.dateTimeLocalToIso(this.validUntil);
    }
    const snapshot = this.settingsSnapshot();
    this.saving = true;
    this.featuresSaved = false;
    this.api.updateAccessConfig(this.acpId, data).subscribe({
      next: () => {
        this.savedSettings = snapshot;
        this.saving = false;
        this.featuresSaved = true;
      },
      error: () => {
        this.saving = false;
        this.saveError =
          'Die Änderungen konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.';
      },
    });
  }

  private applyFeatureConfigDefaults() {
    // Match the viewer API: existing ACPs without this flag allow the Explorer.
    if (this.featureConfig['enableItemList'] === undefined) {
      this.featureConfig['enableItemList'] = true;
    }
    this.featureConfig['showItemExplorerOnStartPage'] =
      this.featureConfig['showItemExplorerOnStartPage'] !== false;
    this.featureConfig['showUnitListOnStartPage'] =
      (this.featureConfig['showUnitListOnStartPage'] ??
        this.featureConfig['enableUnitListNavigation']) !== false;
    this.featureConfig['showSequencesOnStartPage'] =
      this.featureConfig['showSequencesOnStartPage'] !== false;
    this.featureConfig['showIndexOnStartPage'] =
      this.featureConfig['showIndexOnStartPage'] !== false;
    this.featureConfig['commentVisibilityMode'] =
      this.featureConfig['commentVisibilityMode'] === 'GROUP'
        ? 'GROUP'
        : this.featureConfig['commentVisibilityMode'] === 'SHARED'
          ? 'SHARED'
          : 'PRIVATE';
    const itemSubIdLabel = String(this.featureConfig[this.itemSubIdLabelKey] || '').trim();
    this.featureConfig[this.itemSubIdLabelKey] = itemSubIdLabel || 'Sub-ID';
    this.featureConfig[this.enablePersonalItemDataKey] =
      this.featureConfig[this.enablePersonalItemDataKey] === true;
    this.featureConfig[this.enableItemCollectionsKey] =
      this.featureConfig[this.enableItemCollectionsKey] === true;
    const personalCategoryLabel = String(
      this.featureConfig[this.personalItemCategoryLabelKey] || '',
    ).trim();
    this.featureConfig[this.personalItemCategoryLabelKey] =
      personalCategoryLabel || 'Kompetenzstufe';
    const personalTagLabel = String(this.featureConfig[this.personalItemTagLabelKey] || '').trim();
    this.featureConfig[this.personalItemTagLabelKey] = personalTagLabel || 'Markierungen';

    const showAudioVideoCodingVariables = this.featureConfig[this.showAudioVideoCodingVariablesKey];
    this.featureConfig[this.showAudioVideoCodingVariablesKey] =
      showAudioVideoCodingVariables !== false;

    this.featureConfig[this.showGeneralCodingInstructionsKey] =
      this.featureConfig[this.showGeneralCodingInstructionsKey] === true;
    this.featureConfig[this.preferManualCodingInstructionsKey] =
      this.featureConfig[this.preferManualCodingInstructionsKey] !== false;

    const enablePlayerFocusHighlight = this.featureConfig[this.enablePlayerFocusHighlightKey];
    this.featureConfig[this.enablePlayerFocusHighlightKey] = enablePlayerFocusHighlight === true;

    const showItemExplorerPlayerTargetInfo =
      this.featureConfig[this.showItemExplorerPlayerTargetInfoKey];
    this.featureConfig[this.showItemExplorerPlayerTargetInfoKey] =
      showItemExplorerPlayerTargetInfo === true;
  }

  toggleCommentTarget(target: string) {
    const idx = this.commentTargets.indexOf(target);
    if (idx >= 0) {
      this.commentTargets.splice(idx, 1);
    } else {
      this.commentTargets.push(target);
    }
  }

  addPersonalItemCategoryValue() {
    this.personalItemCategoryValues.push('');
  }

  addMetadataColumnDefinition() {
    this.metadataColumnDefinitions.push({ id: '', label: '' });
  }

  removeMetadataColumnDefinition(index: number) {
    this.metadataColumnDefinitions.splice(index, 1);
  }

  removePersonalItemCategoryValue(index: number) {
    this.personalItemCategoryValues.splice(index, 1);
  }

  addPersonalItemTag() {
    this.personalItemTags.push({ label: '', color: '#3498db' });
  }

  removePersonalItemTag(index: number) {
    this.personalItemTags.splice(index, 1);
  }

  addTag() {
    const tag = this.newTag.trim();
    if (tag && !this.availableTags.includes(tag)) {
      this.availableTags.push(tag);
      this.newTag = '';
    }
  }

  removeTag(index: number) {
    this.availableTags.splice(index, 1);
  }

  addItemSubIdLabel() {
    this.itemSubIdLabelEntries.push({ value: '', label: '' });
  }

  removeItemSubIdLabel(index: number) {
    this.itemSubIdLabelEntries.splice(index, 1);
  }

  // Manual credential management
  addCredential() {
    if (this.addingCredential()) return;
    this.addError = '';
    this.addSuccess.set('');
    const username = this.newUsername.trim();
    const password = this.newPassword;

    if (!username || !password) {
      this.addError = 'Benutzername und Kennwort sind erforderlich.';
      return;
    }
    if (!this.isStrongPassword(password)) {
      this.addError = this.strongPasswordHint;
      return;
    }
    if (this.credentials.some((c) => c.username === username)) {
      this.addError = 'Benutzername existiert bereits.';
      return;
    }

    this.addingCredential.set(true);
    this.api.createCredential(this.acpId, username, password, this.newCapabilities).subscribe({
      next: (cred) => {
        this.credentials.push(cred);
        this.newUsername = '';
        this.newPassword = '';
        this.credentialCount = this.credentials.length;
        this.addSuccess.set(`ACP-Zugang „${cred.username}“ wurde hinzugefügt.`);
        this.addingCredential.set(false);
      },
      error: (err) => {
        this.addError = err.error?.message || 'Fehler beim Hinzufügen.';
        this.addingCredential.set(false);
      },
    });
  }

  // CSV Upload with preview
  previewCSV(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!file) return;
    this.cancelCSVPreview();
    this.importError = '';
    const version = this.importPreviewVersion;
    this.importBusy = true;
    this.api
      .importCredentialFile(
        this.acpId,
        file,
        this.csvMode,
        this.importProfile,
        this.importCapabilities,
        true,
      )
      .subscribe({
        next: (result) => {
          if (version !== this.importPreviewVersion) return;
          this.importFile = file;
          this.importChanges = result.changes;
          this.importRemoved = result.removed;
          this.csvPreview = {
            filename: file.name,
            total: result.changes.length,
            toAdd: result.changes.filter((c: any) => c.action === 'add').length,
            toUpdate: result.changes.filter((c: any) => c.action === 'update').length,
            toSkip: result.changes.filter((c: any) => c.action === 'skip').length,
            duplicates: [],
            conflicts: [],
            credentials: [],
          };
          this.importBusy = false;
        },
        error: (err) => {
          if (version !== this.importPreviewVersion) return;
          this.importBusy = false;
          this.showImportError(err);
        },
      });
  }
  cancelCSVPreview() {
    this.importPreviewVersion++;
    this.importBusy = false;
    this.csvPreview = null;
    this.importFile = null;
    this.importChanges = [];
    this.importRemoved = [];
    this.pendingCSVUpload = [];
  }
  confirmCSVUpload() {
    if (!this.importFile || !this.csvPreview || this.importBusy) return;
    this.importBusy = true;
    this.api
      .importCredentialFile(
        this.acpId,
        this.importFile,
        this.csvMode,
        this.importProfile,
        this.importCapabilities,
      )
      .subscribe({
        next: () => {
          this.importBusy = false;
          this.cancelCSVPreview();
          this.loadCredentials();
        },
        error: (err) => {
          this.importBusy = false;
          this.showImportError(err);
        },
      });
  }
  private showImportError(err: any) {
    this.importError =
      err.error?.errors?.map((e: any) => `Zeile ${e.line}: ${e.message}`).join('\n') ||
      err.error?.message ||
      'Import fehlgeschlagen';
  }

  // Edit dialog
  openEditDialog(cred: Credential) {
    this.editingCredential = cred;
    this.editUsername = cred.username;
    this.editCapabilities = [...(cred.capabilities || [])];
    this.editChangePassword = false;
    this.editPassword = '';
    this.editError = '';
  }

  closeEditDialog() {
    this.editingCredential = null;
    this.editUsername = '';
    this.editChangePassword = false;
    this.editPassword = '';
    this.editError = '';
  }

  saveEdit() {
    if (!this.editingCredential) return;

    this.editError = '';
    const username = this.editUsername.trim();

    if (!username) {
      this.editError = 'Benutzername ist erforderlich.';
      return;
    }

    // Check for duplicate username (if changed)
    if (username !== this.editingCredential.username) {
      if (
        this.credentials.some((c) => c.username === username && c.id !== this.editingCredential!.id)
      ) {
        this.editError = 'Benutzername existiert bereits.';
        return;
      }
    }

    const data: { username?: string; password?: string; capabilities?: string[] } = {
      capabilities: this.editCapabilities,
    };
    if (username !== this.editingCredential.username) {
      data.username = username;
    }
    if (this.editChangePassword) {
      if (!this.isStrongPassword(this.editPassword)) {
        this.editError = this.strongPasswordHint;
        return;
      }
      data.password = this.editPassword;
    }

    if (Object.keys(data).length === 0) {
      this.closeEditDialog();
      return;
    }

    this.api.updateCredential(this.acpId, this.editingCredential.id, data).subscribe({
      next: (updated) => {
        const idx = this.credentials.findIndex((c) => c.id === updated.id);
        if (idx >= 0) {
          this.credentials[idx] = updated;
        }
        this.closeEditDialog();
      },
      error: (err) => {
        this.editError = err.error?.message || 'Fehler beim Speichern.';
      },
    });
  }

  // Legacy method - kept for backwards compatibility but not used
  uploadCSV(event: Event) {
    // This method is replaced by previewCSV + confirmCSVUpload flow
    this.previewCSV(event);
  }

  deleteCredential(credentialId: string) {
    if (!confirm('Soll dieses Zugangsdatum wirklich gelöscht werden?')) return;
    this.api.deleteCredential(this.acpId, credentialId).subscribe({
      next: () => {
        this.credentials = this.credentials.filter((c) => c.id !== credentialId);
      },
      error: () => {
        alert('Fehler beim Löschen des Zugangsdatums');
      },
    });
  }

  isStrongPassword(password: string): boolean {
    return this.strongPasswordRegex.test(password || '');
  }
}
