import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTaskContentComponent } from './public-task-content.component';
import { PublicTaskSnapshot } from './public-tasks.service';

export const publicTaskSnapshot: PublicTaskSnapshot = {
  version: 1,
  unitId: 'u1',
  title: 'Öffentliche Aufgabe',
  description: 'Mit Stimulus',
  copyrightNotice: '© Rechteinhaber',
  publicComments: 'Freigegebener Kommentar',
  playerHtml: '<html><body>Player</body></html>',
  definition: '{"pages":[]}',
  codingScheme: {
    variableCodings: [
      {
        id: 'v1',
        sourceType: 'BASE',
        label: 'Antwort',
        manualInstruction: '<strong>Bewertungsregel</strong><script>bad()</script>',
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            label: 'Richtig',
            score: 1,
            manualInstruction: '<em>Code-Anweisung</em>',
            ruleSets: [],
          },
        ],
      },
    ],
  },
  metadata: [{ label: 'Aufgabe', entries: [{ label: 'Fach', value: '<b>Deutsch</b>' }] }],
};

describe('PublicTaskContentComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function setup(snapshot = publicTaskSnapshot) {
    await TestBed.configureTestingModule({
      imports: [PublicTaskContentComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const fixture = TestBed.createComponent(PublicTaskContentComponent);
    fixture.componentRef.setInput('snapshot', structuredClone(snapshot));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('displays copyright, metadata, coding instructions and only explicitly public comments without downloads', async () => {
    const fixture = await setup();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('aside')?.textContent).toContain('© Rechteinhaber');
    expect(element.textContent).toContain('Freigegebener Kommentar');
    expect(element.textContent).toContain('<b>Deutsch</b>');
    expect(element.querySelector('strong')?.textContent).toBe('Bewertungsregel');
    expect(element.querySelector('em')?.textContent).toBe('Code-Anweisung');
    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('keeps manual instructions when a valid manual-only code omits ruleSets', async () => {
    const snapshot = structuredClone(publicTaskSnapshot);
    snapshot.codingScheme = {
      variableCodings: [
        {
          id: 'manual',
          sourceType: 'MANUAL',
          codeModel: 'MANUAL_ONLY',
          manualInstruction: '<strong>Antwort bewerten</strong>',
          codes: [
            {
              id: 1,
              type: 'FULL_CREDIT',
              score: 1,
              manualInstruction: '<em>Vollständige Lösung</em>',
            },
          ],
        },
      ],
    };
    const fixture = await setup(snapshot);
    const element: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.codingError).toBe('');
    expect(element.querySelector('article')).not.toBeNull();
    expect(element.querySelector('strong')?.textContent).toBe('Antwort bewerten');
    expect(element.querySelector('em')?.textContent).toBe('Vollständige Lösung');
  });

  it('renders the residual answer rule when ruleSets are omitted', async () => {
    const snapshot = structuredClone(publicTaskSnapshot);
    snapshot.codingScheme = {
      variableCodings: [
        {
          id: 'residual',
          sourceType: 'BASE',
          codes: [{ id: 0, type: 'RESIDUAL_AUTO', score: 0 }],
        },
      ],
    };
    const fixture = await setup(snapshot);
    expect(fixture.componentInstance.codingError).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Alle anderen Antworten.');
  });

  it('accepts resize and ready messages only from its player and does not collect responses', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;
    const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, 'postMessage');
    component.onPlayerMessage(
      new MessageEvent('message', {
        source: window,
        data: { type: 'vopResizeNotification', height: 2000 },
      }),
    );
    expect(component.playerHeight).toBe(700);
    component.onPlayerMessage(
      new MessageEvent('message', {
        source: frame.contentWindow!,
        data: { type: 'vopResizeNotification', height: 25000 },
      }),
    );
    expect(component.playerHeight).toBe(20000);
    component.onPlayerMessage(
      new MessageEvent('message', {
        source: frame.contentWindow!,
        data: { type: 'vopReadyNotification' },
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vopStartCommand',
        unitDefinition: publicTaskSnapshot.definition,
        playerConfig: expect.objectContaining({ stateReportPolicy: 'none', logPolicy: 'disabled' }),
      }),
      '*',
    );
  });
});
