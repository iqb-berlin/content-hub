import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { AppSettings } from '../../core/models/api.models';

function createSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 'settings-1',
    theme: { '--color-primary': '#1a5276' },
    language: 'de',
    logoUrl: 'https://example.org/logo.svg',
    landingPageHtml: '<p>Start</p>',
    imprintHtml: '<p>Impressum</p>',
    privacyHtml: '<p>Datenschutz</p>',
    accessibilityHtml: '<p>Barrierefreiheit</p>',
    defaultApIndex: { quality: 'baseline' },
    geoGebraBundle: null,
    ...overrides,
  };
}

describe('SettingsComponent', () => {
  let api: {
    getSettings: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
    uploadGeoGebraBundle: ReturnType<typeof vi.fn>;
    deleteGeoGebraBundle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      uploadGeoGebraBundle: vi.fn(),
      deleteGeoGebraBundle: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads settings and initializes JSON/theme on init', () => {
    api.getSettings.mockReturnValue(of(createSettings()));

    const component = new SettingsComponent(api as any);
    component.ngOnInit();

    expect(component.settings?.language).toBe('de');
    expect(component.theme['--color-primary']).toBe('#1a5276');
    expect(component.defaultApIndexJson).toContain('"quality": "baseline"');
  });

  it('shows parse error for invalid default index JSON', () => {
    const settings = createSettings();
    api.getSettings.mockReturnValue(of(settings));
    api.updateSettings.mockReturnValue(of(settings));

    const component = new SettingsComponent(api as any);
    component.ngOnInit();
    component.defaultApIndexJson = '{invalid json';
    component.save();

    expect(component.error).toContain('gültiges JSON-Objekt');
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('saves settings with theme and default AP index', () => {
    const settings = createSettings();
    api.getSettings.mockReturnValue(of(settings));
    api.updateSettings.mockReturnValue(of(createSettings({ language: 'en' })));

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const component = new SettingsComponent(api as any);
    component.ngOnInit();

    component.theme['--color-primary'] = '#123456';
    component.defaultApIndexJson = JSON.stringify({ custom: true });
    component.settings!.language = 'en';
    component.save();

    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en',
        theme: expect.objectContaining({ '--color-primary': '#123456' }),
        defaultApIndex: { custom: true },
      }),
    );
    expect(dispatchSpy).toHaveBeenCalled();
    expect(component.saved).toBe(true);
  });

  it('uploads a GeoGebra bundle and refreshes settings', () => {
    api.getSettings.mockReturnValue(of(createSettings()));
    api.uploadGeoGebraBundle.mockReturnValue(
      of(
        createSettings({
          geoGebraBundle: {
            sourceFileName: 'GeoGebra.itcr.zip',
            deployScriptUrl: '/api/shared-assets/GeoGebra/GeoGebra/deployggb.js',
            publicBasePath: '/api/shared-assets',
            checksum: 'abc',
            entryCount: 2,
            uploadedAt: '2026-04-21T10:00:00.000Z',
          },
        }),
      ),
    );

    const component = new SettingsComponent(api as any);
    component.ngOnInit();
    component.selectedGeoGebraFile = new File(['zip'], 'GeoGebra.itcr.zip');
    component.uploadGeoGebraBundle();

    expect(api.uploadGeoGebraBundle).toHaveBeenCalled();
    expect(component.settings?.geoGebraBundle?.sourceFileName).toBe('GeoGebra.itcr.zip');
    expect(component.geoGebraMessage).toContain('installiert');
  });

  it('removes the GeoGebra bundle after confirmation', () => {
    api.getSettings.mockReturnValue(
      of(
        createSettings({
          geoGebraBundle: {
            sourceFileName: 'GeoGebra.itcr.zip',
            deployScriptUrl: '/api/shared-assets/GeoGebra/GeoGebra/deployggb.js',
            publicBasePath: '/api/shared-assets',
            checksum: 'abc',
            entryCount: 2,
            uploadedAt: '2026-04-21T10:00:00.000Z',
          },
        }),
      ),
    );
    api.deleteGeoGebraBundle.mockReturnValue(of(createSettings({ geoGebraBundle: null })));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const component = new SettingsComponent(api as any);
    component.ngOnInit();
    component.removeGeoGebraBundle();

    expect(api.deleteGeoGebraBundle).toHaveBeenCalled();
    expect(component.settings?.geoGebraBundle).toBeNull();
    expect(component.geoGebraMessage).toContain('entfernt');
  });

  it('shows load error if API fails', () => {
    api.getSettings.mockReturnValue(throwError(() => ({ error: { message: 'kaputt' } })));

    const component = new SettingsComponent(api as any);
    component.ngOnInit();

    expect(component.error).toBe('kaputt');
  });
});
