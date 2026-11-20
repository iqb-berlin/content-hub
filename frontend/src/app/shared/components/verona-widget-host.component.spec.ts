import { ElementRef } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { VeronaWidgetHostComponent } from './verona-widget-host.component';
import { postPlayerMessage, releasePlayerFrame } from '../../core/utils/player-protocol';

function setup() {
  const player = { postMessage: vi.fn() } as unknown as Window;
  const widget = { postMessage: vi.fn() } as unknown as Window;
  const host = new VeronaWidgetHostComponent({
    bypassSecurityTrustResourceUrl: (url: string) => url,
  } as DomSanitizer);
  host['frame'] = new ElementRef({ contentWindow: widget } as HTMLIFrameElement);
  const message = (source: Window, data: object) =>
    host.onMessage({ source, data } as MessageEvent);
  postPlayerMessage(player, { type: 'vopStartCommand', sessionId: 'player-session' });
  const call = {
    type: 'vopWidgetCall',
    sessionId: 'player-session',
    callId: 'one',
    widgetType: 'PERIODIC_TABLE',
    parameters: [{ key: 'MAX_NUMBER_OF_SELECTIONS', value: '2' }],
    state: 'H',
  };
  return {
    player,
    widget,
    host,
    message,
    call,
    close: () => {
      host.ngOnDestroy();
      releasePlayerFrame(player);
    },
  };
}
describe('real Verona widget host', () => {
  it('starts only a registered player call and correlates both widget window and session', () => {
    const s = setup();
    s.message(s.widget, s.call);
    expect(s.host.active).toBeNull();
    s.message(s.player, { ...s.call, sessionId: 'foreign' });
    expect(s.host.active).toBeNull();
    s.message(s.player, { ...s.call, widgetType: 'constructor' });
    expect(s.host.active).toBeNull();
    s.message(s.player, s.call);
    const sessionId = s.host.active!.widgetSession;
    s.message(s.player, { type: 'vowReadyNotification' });
    expect(s.widget.postMessage).not.toHaveBeenCalled();
    s.message(s.widget, { type: 'vowReadyNotification' });
    expect(s.widget.postMessage).toHaveBeenLastCalledWith(
      { type: 'vowStartCommand', sessionId, parameters: s.call.parameters, state: 'H' },
      '*',
    );
    s.message(s.widget, { type: 'vowStateChangedNotification', sessionId: 'wrong', state: 'O' });
    expect(s.host.active!.state).toBe('H');
    s.message(s.widget, { type: 'vowStateChangedNotification', sessionId, state: '' });
    s.host.finish(true);
    expect(s.player.postMessage).toHaveBeenLastCalledWith(
      { type: 'vopWidgetReturn', sessionId: 'player-session', callId: 'one', state: '' },
      '*',
    );
    s.close();
  });
  it('cancels without replacing an existing answer', () => {
    const s = setup();
    s.message(s.player, s.call);
    s.host.active!.state = 'O';
    s.host.finish(false);
    expect(s.player.postMessage).toHaveBeenLastCalledWith(
      { type: 'vopWidgetReturn', sessionId: 'player-session', callId: 'one' },
      '*',
    );
    s.close();
  });
  it('discards a widget when the player navigates to another session', () => {
    const s = setup();
    s.message(s.player, s.call);
    postPlayerMessage(s.player, { type: 'vopStartCommand', sessionId: 'new-session' });
    expect(s.host.active).toBeNull();
    s.host.finish(true);
    expect(s.player.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vopWidgetReturn' }),
      '*',
    );
    s.close();
  });
});
