import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { AppSettings } from '../../core/models/api.models';
import {
  DEFAULT_THEME,
  applyLanguage,
  applyTheme,
  normalizeTheme,
} from '../../core/utils/app-settings.util';

type ThemeField = {
  key: string;
  label: string;
};

const THEME_FIELDS: ThemeField[] = [
  { key: '--color-primary', label: 'Primärfarbe' },
  { key: '--color-primary-light', label: 'Primär hell' },
  { key: '--color-accent', label: 'Akzentfarbe' },
  { key: '--color-success', label: 'Erfolg' },
  { key: '--color-danger', label: 'Fehler' },
  { key: '--color-warning', label: 'Warnung' },
  { key: '--color-bg', label: 'Hintergrund' },
  { key: '--color-surface', label: 'Fläche' },
  { key: '--color-text', label: 'Text' },
  { key: '--color-text-secondary', label: 'Text sekundär' },
  { key: '--color-border', label: 'Rahmen' },
];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-header"><h1>Einstellungen</h1></div>
    @if (saved) {
      <div class="alert alert-success">Einstellungen gespeichert.</div>
    }
    @if (error) {
      <div class="alert alert-error">{{ error }}</div>
    }

    @if (settings) {
      <div class="card">
        <h3>Grundeinstellungen</h3>
        <div class="form-group">
          <label>Sprache</label>
          <select [(ngModel)]="settings.language" name="language">
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="form-group">
          <label>Logo URL</label>
          <input [(ngModel)]="settings.logoUrl" name="logoUrl" />
        </div>

        <h3>Farbgebung / Theme</h3>
        <div class="theme-grid">
          @for (field of themeFields; track field.key) {
            <div class="theme-item">
              <label>{{ field.label }}</label>
              <div class="theme-input-row">
                <input
                  type="color"
                  [(ngModel)]="theme[field.key]"
                  [name]="'theme-color-' + field.key"
                  (change)="onThemeChange()"
                />
                <input
                  [(ngModel)]="theme[field.key]"
                  [name]="'theme-text-' + field.key"
                  (change)="onThemeChange()"
                />
              </div>
            </div>
          }
        </div>
      </div>

      <div class="card">
        <h3>Texte</h3>
        <p class="help-text">Markdown wird unterstützt. Bestehendes HTML bleibt kompatibel.</p>
        <div class="form-group">
          <label>Startseite (Markdown / HTML)</label>
          <textarea
            [(ngModel)]="settings.landingPageHtml"
            name="landingPageHtml"
            rows="8"
          ></textarea>
        </div>
        <div class="form-group">
          <label>Impressum (Markdown / HTML)</label>
          <textarea [(ngModel)]="settings.imprintHtml" name="imprintHtml" rows="6"></textarea>
        </div>
        <div class="form-group">
          <label>Datenschutz (Markdown / HTML)</label>
          <textarea [(ngModel)]="settings.privacyHtml" name="privacyHtml" rows="6"></textarea>
        </div>
        <div class="form-group">
          <label>Barrierefreiheit (Markdown / HTML)</label>
          <textarea
            [(ngModel)]="settings.accessibilityHtml"
            name="accessibilityHtml"
            rows="6"
          ></textarea>
        </div>
      </div>

      <div class="card">
        <h3>Standard-Einstellungen für ACP-Index</h3>
        <div class="form-group">
          <label>Default ACP-Index (JSON-Objekt)</label>
          <textarea
            [(ngModel)]="defaultAcpIndexJson"
            name="defaultAcpIndexJson"
            rows="12"
            class="json-editor"
          ></textarea>
          <small class="help-text"
            >Wird beim Anlegen/Import neuer ACPs als Standard verwendet.</small
          >
        </div>
      </div>

      <div class="card">
        <h3>GeoGebra</h3>
        <p class="help-text">
          Einmal hochgeladen steht das GeoGebra-Bundle global für alle ACP-Player bereit.
        </p>

        @if (settings.geoGebraBundle) {
          <div class="bundle-status">
            <div><strong>Datei:</strong> {{ settings.geoGebraBundle.sourceFileName }}</div>
            <div><strong>Dateien:</strong> {{ settings.geoGebraBundle.entryCount }}</div>
            <div><strong>Aktualisiert:</strong> {{ settings.geoGebraBundle.uploadedAt }}</div>
            <div class="bundle-link-row">
              <a [href]="settings.geoGebraBundle.deployScriptUrl" target="_blank"
                >deployggb.js prüfen</a
              >
            </div>
          </div>
        } @else {
          <div class="help-text">Aktuell ist kein GeoGebra-Bundle installiert.</div>
        }

        @if (geoGebraMessage) {
          <div class="alert alert-success">{{ geoGebraMessage }}</div>
        }

        <div class="form-group">
          <label>GeoGebra ZIP</label>
          <input
            #geoGebraFileInput
            type="file"
            accept=".zip,application/zip"
            (change)="onGeoGebraFileSelected($event)"
          />
          @if (selectedGeoGebraFile) {
            <small class="help-text">Ausgewählt: {{ selectedGeoGebraFile.name }}</small>
          }
        </div>

        <div class="geo-actions">
          <button
            class="btn btn-outline"
            [disabled]="!selectedGeoGebraFile || geoGebraBusy"
            (click)="uploadGeoGebraBundle()"
          >
            {{ geoGebraBusy ? 'Upload läuft...' : 'GeoGebra hochladen' }}
          </button>
          <button
            class="btn btn-outline"
            [disabled]="!settings.geoGebraBundle || geoGebraBusy"
            (click)="removeGeoGebraBundle()"
          >
            Bundle entfernen
          </button>
        </div>
      </div>

      <button class="btn btn-primary" (click)="save()">Speichern</button>
    }
  `,
  styles: [
    `
      .theme-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
        margin-top: 8px;
      }

      .theme-item label {
        display: block;
        margin-bottom: 4px;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
      }

      .theme-input-row {
        display: grid;
        grid-template-columns: 64px 1fr;
        gap: 8px;
        align-items: center;
      }

      .theme-input-row input[type='color'] {
        width: 64px;
        height: 36px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 2px;
        cursor: pointer;
        background: transparent;
      }

      .json-editor {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.85rem;
        line-height: 1.5;
      }

      .help-text {
        display: block;
        margin-top: 6px;
        color: var(--color-text-secondary);
        font-size: 0.8rem;
      }

      .bundle-status {
        display: grid;
        gap: 6px;
        margin-bottom: 12px;
      }

      .bundle-link-row {
        margin-top: 4px;
      }

      .geo-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  @ViewChild('geoGebraFileInput')
  geoGebraFileInput?: ElementRef<HTMLInputElement>;

  settings: AppSettings | null = null;
  saved = false;
  error = '';
  defaultAcpIndexJson = '{}';
  theme: Record<string, string> = { ...DEFAULT_THEME };
  readonly themeFields = THEME_FIELDS;
  geoGebraBusy = false;
  geoGebraMessage = '';
  selectedGeoGebraFile: File | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getSettings().subscribe({
      next: (settings) => {
        this.applySettings(settings);
      },
      error: (err) => {
        this.error = err.error?.message || 'Fehler beim Laden der Einstellungen';
      },
    });
  }

  onThemeChange() {
    applyTheme(this.theme);
  }

  save() {
    if (!this.settings) {
      return;
    }

    this.error = '';

    let parsedDefaultAcpIndex: Record<string, unknown>;
    try {
      const parsed = JSON.parse(this.defaultAcpIndexJson || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Default ACP index must be a JSON object');
      }
      parsedDefaultAcpIndex = parsed as Record<string, unknown>;
    } catch {
      this.error = 'Standard-ACP-Index muss ein gültiges JSON-Objekt sein.';
      return;
    }

    const payload: Partial<AppSettings> = {
      language: this.settings.language,
      logoUrl: this.settings.logoUrl,
      landingPageHtml: this.settings.landingPageHtml,
      imprintHtml: this.settings.imprintHtml,
      privacyHtml: this.settings.privacyHtml,
      accessibilityHtml: this.settings.accessibilityHtml,
      theme: { ...this.theme },
      defaultAcpIndex: parsedDefaultAcpIndex,
    };

    this.api.updateSettings(payload).subscribe({
      next: (settings) => {
        this.applySettings(settings);

        applyTheme(this.theme);
        applyLanguage(settings.language);
        window.dispatchEvent(
          new CustomEvent('ch-settings-updated', {
            detail: {
              logoUrl: settings.logoUrl,
              theme: this.theme,
              language: settings.language,
            },
          }),
        );

        this.saved = true;
        setTimeout(() => (this.saved = false), 3000);
      },
      error: (err) => {
        this.error = err.error?.message || 'Fehler beim Speichern';
      },
    });
  }

  onGeoGebraFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    this.selectedGeoGebraFile = input?.files?.[0] || null;
    this.geoGebraMessage = '';
  }

  uploadGeoGebraBundle() {
    if (!this.selectedGeoGebraFile) {
      return;
    }

    this.error = '';
    this.geoGebraMessage = '';
    this.geoGebraBusy = true;

    const formData = new FormData();
    formData.append('file', this.selectedGeoGebraFile);

    this.api.uploadGeoGebraBundle(formData).subscribe({
      next: (settings) => {
        this.applySettings(settings);
        this.geoGebraMessage = 'GeoGebra-Bundle installiert.';
        this.geoGebraBusy = false;
        this.clearGeoGebraSelection();
      },
      error: (err) => {
        this.error = err.error?.message || 'Fehler beim GeoGebra-Upload';
        this.geoGebraBusy = false;
      },
    });
  }

  removeGeoGebraBundle() {
    if (!this.settings?.geoGebraBundle || !window.confirm('GeoGebra-Bundle wirklich entfernen?')) {
      return;
    }

    this.error = '';
    this.geoGebraMessage = '';
    this.geoGebraBusy = true;

    this.api.deleteGeoGebraBundle().subscribe({
      next: (settings) => {
        this.applySettings(settings);
        this.geoGebraMessage = 'GeoGebra-Bundle entfernt.';
        this.geoGebraBusy = false;
        this.clearGeoGebraSelection();
      },
      error: (err) => {
        this.error = err.error?.message || 'Fehler beim Entfernen des GeoGebra-Bundles';
        this.geoGebraBusy = false;
      },
    });
  }

  private applySettings(settings: AppSettings) {
    this.settings = settings;
    this.theme = normalizeTheme(settings.theme);
    this.defaultAcpIndexJson = JSON.stringify(settings.defaultAcpIndex || {}, null, 2);
  }

  private clearGeoGebraSelection() {
    this.selectedGeoGebraFile = null;
    if (this.geoGebraFileInput?.nativeElement) {
      this.geoGebraFileInput.nativeElement.value = '';
    }
  }
}
