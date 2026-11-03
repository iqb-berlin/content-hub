interface PlayerFrameState {
  legacy: boolean;
  sessionId: string | null;
  ready: boolean;
  pendingStart?: unknown;
}
const frames = new WeakMap<Window, PlayerFrameState>();
export const PLAYER_FRAME_RELEASED = 'contenthub-player-frame-released';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Call only after checking that source is the view's current/retiring player window. */
export function normalizePlayerMessage(source: Window, value: unknown): unknown {
  const data = record(value);
  if (!data) return value;
  if (
    data['type'] === 'vo.FromPlayer.ReadyNotification' ||
    data['type'] === 'vopReadyNotification'
  ) {
    const legacy = data['type'] === 'vo.FromPlayer.ReadyNotification';
    const previous = frames.get(source);
    const pending = previous?.pendingStart;
    frames.set(source, { legacy, ready: true, sessionId: previous?.sessionId ?? null });
    if (legacy && pending) postPlayerMessage(source, pending);
    if (legacy) return { type: 'vopReadyNotification', apiVersion: 'legacy-vo' };
  }
  if (
    data['type'] === 'vo.FromPlayer.StartedNotification' ||
    data['type'] === 'vo.FromPlayer.ChangedDataTransfer'
  ) {
    const parts: Record<string, string> = {};
    if (typeof data['restorePoint'] === 'string')
      parts['legacyRestorePoint'] = data['restorePoint'];
    if (typeof data['response'] === 'string') parts['legacyResponses'] = data['response'];
    return {
      type: 'vopStateChangedNotification',
      sessionId: data['sessionId'],
      timeStamp: Date.now(),
      unitState: { dataParts: parts },
      playerState: { validPages: data['validPages'], currentPage: data['currentPage'] },
    };
  }
  if (data['type'] === 'vo.FromPlayer.PageNavigationRequest')
    return {
      type: 'vopPageNavigationCommand',
      sessionId: data['sessionId'],
      target: data['newPage'],
    };
  if (data['type'] === 'vo.FromPlayer.UnitNavigationRequest')
    return {
      type: 'vopUnitNavigationRequestedNotification',
      sessionId: data['sessionId'],
      target: String(data['navigationTarget'] || '').replace(/^#/, ''),
    };
  return value;
}

export function getPlayerFrameSession(source: Window): string | null {
  return frames.get(source)?.sessionId ?? null;
}

export function postPlayerMessage(source: Window | null | undefined, value: unknown): void {
  if (!source) return;
  const data = record(value);
  const state = frames.get(source) ?? { legacy: false, sessionId: null, ready: false };
  let outgoing = value;
  if (data?.['type'] === 'vopStartCommand') {
    if (state.sessionId && state.sessionId !== data['sessionId'])
      window.dispatchEvent(new CustomEvent(PLAYER_FRAME_RELEASED, { detail: source }));
    state.sessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : null;
    if (!state.ready) state.pendingStart = value;
    frames.set(source, state);
    if (state.legacy) {
      const parts = record(record(data['unitState'])?.['dataParts']);
      const config = record(data['playerConfig']);
      outgoing = {
        type: 'vo.ToPlayer.DataTransfer',
        sessionId: data['sessionId'],
        unitDefinition: data['unitDefinition'],
        ...(typeof parts?.['legacyRestorePoint'] === 'string'
          ? { restorePoint: parts['legacyRestorePoint'] }
          : {}),
        ...(config?.['unitNumber'] !== undefined
          ? { unitNumber: String(config['unitNumber']) }
          : {}),
      };
    }
  } else if (state.legacy && data?.['type'] === 'vopPageNavigationCommand') {
    outgoing = {
      type: 'vo.ToPlayer.NavigateToPage',
      sessionId: data['sessionId'],
      newPage: String(data['target']),
    };
  }
  source.postMessage(outgoing, '*');
}

export function releasePlayerFrame(source: Window | null | undefined): void {
  if (!source) return;
  frames.delete(source);
  window.dispatchEvent(new CustomEvent(PLAYER_FRAME_RELEASED, { detail: source }));
}
