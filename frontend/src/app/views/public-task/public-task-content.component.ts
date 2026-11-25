import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CodingAsText, CodingSchemeTextFactory } from '@iqb/responses';
import {
  GEOGEBRA_PLAYER_RESOURCE_BASE,
  rewriteGeoGebraAssetUrls,
} from '../../core/utils/geogebra-player-html.util';
import { PublicTaskSnapshot } from './public-tasks.service';

type PublicCoding = CodingAsText & {
  instruction?: string;
  codes: (CodingAsText['codes'][number] & { instruction?: string; description?: string })[];
};

@Component({
  selector: 'app-public-task-content',
  standalone: true,
  template: `
    @if (snapshot) {
      <h1>{{ snapshot.title }}</h1>
      @if (snapshot.description) {
        <p>{{ snapshot.description }}</p>
      }
      <aside class="copyright card" aria-label="Copyright-Hinweis zum Stimulus">
        <h2>Copyright · Stimulus</h2>
        <p>{{ snapshot.copyrightNotice }}</p>
      </aside>
      <section aria-label="Aufgabenvorschau einschließlich Stimulus" class="player card">
        <iframe
          #playerFrame
          [srcdoc]="playerHtml"
          title="Digitale Testaufgabe mit Stimulus"
          sandbox="allow-scripts"
          [style.height.px]="playerHeight"
          (load)="startPlayer()"
        ></iframe>
      </section>
      <div class="details">
        <section class="card">
          <h2>Lösungserwartung und Kodieranweisung</h2>
          @if (codingError) {
            <p role="alert">{{ codingError }}</p>
          }
          @for (coding of codings; track $index) {
            <article>
              <h3>{{ coding.label || coding.id }}</h3>
              @if (coding.source) {
                <p>{{ coding.source }}</p>
              }
              @if (coding.processing) {
                <p>{{ coding.processing }}</p>
              }
              @if (coding.instruction) {
                <div [innerHTML]="coding.instruction"></div>
              }
              @for (code of coding.codes; track $index) {
                <div class="code">
                  <strong>{{ code.label || code.id }}</strong> · {{ code.score }}
                  {{ code.score === 1 ? 'Punkt' : 'Punkte' }}
                  @if (code.description && code.description !== code.label) {
                    <p>{{ code.description }}</p>
                  }
                  @if (code.ruleSetDescriptions.length) {
                    <p>
                      {{
                        code.ruleSetOperatorAnd
                          ? 'Alle folgenden Bedingungen müssen zutreffen:'
                          : 'Mindestens eine der folgenden Bedingungen muss zutreffen:'
                      }}
                    </p>
                  }
                  @for (rule of code.ruleSetDescriptions; track $index) {
                    <p>{{ rule }}</p>
                  }
                  @if (code.instruction) {
                    <div [innerHTML]="code.instruction"></div>
                  }
                </div>
              }
            </article>
          }
        </section>
        <section class="card">
          <h2>Metadaten</h2>
          <dl>
            <dt>Aufgaben-ID</dt>
            <dd>{{ snapshot.unitId }}</dd>
          </dl>
          @for (section of snapshot.metadata; track $index) {
            @if (section.entries.length) {
              <h3>{{ section.label }}</h3>
              <dl>
                @for (entry of section.entries; track $index) {
                  <dt>{{ entry.label }}</dt>
                  <dd>{{ entry.value }}</dd>
                }
              </dl>
            }
          }
        </section>
      </div>
      <section class="card comments">
        <h2>Kommentare</h2>
        <p>{{ snapshot.publicComments || 'Keine öffentlichen Kommentare.' }}</p>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 1440px;
        margin: auto;
      }
      h1 {
        overflow-wrap: anywhere;
      }
      h2 {
        font-size: 1.15rem;
        margin-top: 0;
      }
      h3 {
        font-size: 1rem;
      }
      .card {
        padding: 20px;
        margin-bottom: 20px;
      }
      .copyright {
        border-left: 5px solid var(--color-primary);
      }
      .copyright p,
      .comments p {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .player {
        padding: 0;
        overflow: hidden;
      }
      iframe {
        width: 100%;
        min-height: 600px;
        border: 0;
        display: block;
      }
      .details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }
      .details > section {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .code {
        padding: 12px 0;
        border-bottom: 1px solid var(--color-border);
      }
      dl {
        display: grid;
        grid-template-columns: minmax(100px, 1fr) 2fr;
        gap: 8px 16px;
      }
      dd {
        margin: 0;
        white-space: pre-wrap;
      }
      @media (max-width: 800px) {
        .details {
          grid-template-columns: 1fr;
          gap: 0;
        }
      }
    `,
  ],
})
export class PublicTaskContentComponent implements OnChanges {
  @Input({ required: true }) snapshot!: PublicTaskSnapshot;
  @ViewChild('playerFrame') playerFrame?: ElementRef<HTMLIFrameElement>;
  playerHtml: SafeHtml | null = null;
  playerHeight = 700;
  codings: PublicCoding[] = [];
  codingError = '';

  private readonly sanitizer = inject(DomSanitizer);

  ngOnChanges() {
    this.playerHeight = 700;
    // Uploaded players run in an opaque sandbox, without parent origin or downloads.
    this.playerHtml = this.sanitizer.bypassSecurityTrustHtml(
      rewriteGeoGebraAssetUrls(this.snapshot.playerHtml),
    );
    this.codingError = '';
    try {
      const raw = this.snapshot.codingScheme['variableCodings'] as Parameters<
        typeof CodingSchemeTextFactory.asText
      >[0];
      this.codings = CodingSchemeTextFactory.asText(raw).map((coding, index) => ({
        ...coding,
        instruction: raw[index]?.manualInstruction,
        codes: coding.codes.map((code) => {
          const source = raw[index]?.codes?.find((candidate) => String(candidate.id) === code.id);
          const ruleSetDescriptions = code.ruleSetDescriptions ?? [];
          return {
            ...code,
            instruction: source?.manualInstruction,
            description: source?.label,
            ruleSetDescriptions:
              !ruleSetDescriptions.length &&
              ['RESIDUAL', 'RESIDUAL_AUTO'].includes(source?.type || '')
                ? ['Alle anderen Antworten.']
                : ruleSetDescriptions,
          };
        }),
      }));
    } catch {
      this.codings = [];
      this.codingError = 'Die Kodieranweisung konnte nicht dargestellt werden.';
    }
  }

  startPlayer() {
    this.playerFrame?.nativeElement.contentWindow?.postMessage(
      {
        type: 'vopStartCommand',
        sessionId: 'public-task',
        unitDefinition: this.snapshot.definition,
        unitState: { dataParts: {} },
        playerConfig: {
          stateReportPolicy: 'none',
          logPolicy: 'disabled',
          pagingMode: 'concat-scroll',
          directDownloadUrl: GEOGEBRA_PLAYER_RESOURCE_BASE,
          enabledNavigationTargets: ['next', 'previous', 'first', 'last', 'end'],
        },
      },
      '*',
    );
  }

  @HostListener('window:message', ['$event'])
  onPlayerMessage(event: MessageEvent) {
    const frameWindow = this.playerFrame?.nativeElement.contentWindow;
    if (!frameWindow || event.source !== frameWindow || !event.data) return;
    if (event.data.type === 'vopReadyNotification') this.startPlayer();
    if (event.data.type === 'vopResizeNotification') {
      const height = Number(event.data.height);
      if (Number.isFinite(height)) this.playerHeight = Math.max(600, Math.min(height, 20000));
    }
  }
}
