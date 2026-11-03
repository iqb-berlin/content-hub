import { Component, ElementRef, HostListener, Inject, OnDestroy, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { getPlayerFrameSession, PLAYER_FRAME_RELEASED } from '../../core/utils/player-protocol';

const WIDGETS: Record<string, { title: string; file: string }> = {
  PERIODIC_TABLE: { title: 'Periodensystem', file: 'periodic-table.html' },
  MOLECULE_EDITOR: { title: 'Molekül-Editor', file: 'molecule-editor.html' },
};
interface WidgetCall {
  player: Window;
  playerSession: string;
  callId: string;
  widgetSession: string;
  title: string;
  url: SafeResourceUrl;
  parameters: { key: string; value: string }[];
  state?: string;
  started: boolean;
}

@Component({
  selector: 'app-verona-widget-host',
  standalone: true,
  template: `
    @if (active; as call) {
      <dialog #dialog aria-labelledby="verona-widget-title" (cancel)="cancel($event)">
        <header>
          <h2 id="verona-widget-title">{{ call.title }}</h2>
          <button type="button" (click)="finish(false)" aria-label="Werkzeug schließen">×</button>
        </header>
        @if (!call.started) {
          <p role="status">Werkzeug wird geladen …</p>
        }
        <iframe #widgetFrame [src]="call.url" [title]="call.title"></iframe>
        <footer>
          <button type="button" class="btn btn-outline" (click)="finish(false)">Abbrechen</button>
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="!call.started"
            (click)="finish(true)"
          >
            Übernehmen
          </button>
        </footer>
      </dialog>
    }
  `,
  styles: [
    `
      dialog {
        width: min(1100px, calc(100vw - 24px));
        max-width: none;
        max-height: calc(100dvh - 24px);
        padding: 12px;
        border: 1px solid #bcc7d0;
        border-radius: 8px;
        box-sizing: border-box;
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 45%);
      }
      header,
      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 1.25rem;
      }
      header button {
        font-size: 1.5rem;
        background: none;
        border: 0;
      }
      iframe {
        width: 100%;
        height: min(72dvh, 720px);
        border: 0;
        display: block;
      }
      footer {
        justify-content: flex-end;
        padding-top: 8px;
      }
    `,
  ],
})
export class VeronaWidgetHostComponent implements OnDestroy {
  active: WidgetCall | null = null;
  @ViewChild('widgetFrame') private frame?: ElementRef<HTMLIFrameElement>;
  @ViewChild('dialog') set dialog(value: ElementRef<HTMLDialogElement> | undefined) {
    value?.nativeElement.showModal?.();
  }
  private readonly released = (event: Event) => {
    if ((event as CustomEvent<Window>).detail === this.active?.player) this.active = null;
  };
  constructor(@Inject(DomSanitizer) private readonly sanitizer: DomSanitizer) {
    window.addEventListener(PLAYER_FRAME_RELEASED, this.released);
  }
  ngOnDestroy(): void {
    window.removeEventListener(PLAYER_FRAME_RELEASED, this.released);
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'vopWidgetCall') {
      const source = event.source as Window | null;
      if (
        !source ||
        typeof data.sessionId !== 'string' ||
        getPlayerFrameSession(source) !== data.sessionId ||
        typeof data.callId !== 'string' ||
        !data.callId ||
        typeof data.widgetType !== 'string' ||
        !Object.hasOwn(WIDGETS, data.widgetType)
      )
        return;
      if (this.active) return;
      const widget = WIDGETS[data.widgetType];
      this.active = {
        player: source,
        playerSession: data.sessionId,
        callId: data.callId,
        widgetSession: `widget-${crypto.randomUUID()}`,
        title: widget.title,
        url: this.sanitizer.bypassSecurityTrustResourceUrl(
          `/api/shared-assets/widgets/${widget.file}`,
        ),
        started: false,
        parameters: Array.isArray(data.parameters)
          ? data.parameters
              .filter(
                (p: unknown): p is { key: string; value: string } =>
                  !!p &&
                  typeof p === 'object' &&
                  typeof (p as { key?: unknown }).key === 'string' &&
                  typeof (p as { value?: unknown }).value === 'string',
              )
              .map((p: { key: string; value: string }) => ({ key: p.key, value: p.value }))
          : [],
        ...(typeof data.state === 'string' ? { state: data.state } : {}),
      };
      return;
    }
    const call = this.active;
    const widgetWindow = this.frame?.nativeElement.contentWindow;
    if (!call || !widgetWindow || event.source !== widgetWindow) return;
    if (getPlayerFrameSession(call.player) !== call.playerSession) {
      this.active = null;
      return;
    }
    if (data.type === 'vowReadyNotification' && !call.started) {
      call.started = true;
      widgetWindow.postMessage(
        {
          type: 'vowStartCommand',
          sessionId: call.widgetSession,
          parameters: call.parameters,
          ...(call.state !== undefined ? { state: call.state } : {}),
        },
        '*',
      );
    } else if (data.sessionId === call.widgetSession) {
      if (data.type === 'vowStateChangedNotification' && typeof data.state === 'string')
        call.state = data.state;
      if (data.type === 'vowReturnRequested') this.finish(data.saveState !== false);
    }
  }

  cancel(event: Event): void {
    event.preventDefault();
    this.finish(false);
  }
  finish(save: boolean): void {
    const call = this.active;
    this.active = null;
    if (!call || getPlayerFrameSession(call.player) !== call.playerSession) return;
    call.player.postMessage(
      {
        type: 'vopWidgetReturn',
        sessionId: call.playerSession,
        callId: call.callId,
        ...(save && call.state !== undefined ? { state: call.state } : {}),
      },
      '*',
    );
  }
}
