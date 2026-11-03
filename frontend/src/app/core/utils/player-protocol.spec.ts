import { describe, expect, it, vi } from 'vitest';
import {
  getPlayerFrameSession,
  normalizePlayerMessage,
  postPlayerMessage,
  releasePlayerFrame,
} from './player-protocol';

describe('legacy Verona frame protocol', () => {
  it('starts, restores, navigates and retains historical response data without changing modern messages', () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    expect(
      normalizePlayerMessage(frame, { type: 'vo.FromPlayer.ReadyNotification', version: 1 }),
    ).toMatchObject({ type: 'vopReadyNotification' });
    postPlayerMessage(frame, {
      type: 'vopStartCommand',
      sessionId: 'one',
      unitDefinition: 'titel::Test',
      unitState: { dataParts: { legacyRestorePoint: '{"ANSWER":"Brot"}' } },
    });
    expect(frame.postMessage).toHaveBeenLastCalledWith(
      {
        type: 'vo.ToPlayer.DataTransfer',
        sessionId: 'one',
        unitDefinition: 'titel::Test',
        restorePoint: '{"ANSWER":"Brot"}',
      },
      '*',
    );
    const normalized = normalizePlayerMessage(frame, {
      type: 'vo.FromPlayer.ChangedDataTransfer',
      sessionId: 'one',
      validPages: ['start', 'end'],
      currentPage: 'end',
      response: 'answer',
      restorePoint: 'restore',
    });
    expect(normalized).toMatchObject({
      type: 'vopStateChangedNotification',
      sessionId: 'one',
      unitState: { dataParts: { legacyResponses: 'answer', legacyRestorePoint: 'restore' } },
      playerState: { validPages: ['start', 'end'], currentPage: 'end' },
    });
    postPlayerMessage(frame, {
      type: 'vopPageNavigationCommand',
      sessionId: 'one',
      target: 'start',
    });
    expect(frame.postMessage).toHaveBeenLastCalledWith(
      { type: 'vo.ToPlayer.NavigateToPage', sessionId: 'one', newPage: 'start' },
      '*',
    );
    normalizePlayerMessage(frame, { type: 'vopReadyNotification' });
    const modern = { type: 'vopStartCommand', sessionId: 'two', unitDefinition: '{}' };
    postPlayerMessage(frame, modern);
    expect(frame.postMessage).toHaveBeenLastCalledWith(modern, '*');
    expect(getPlayerFrameSession(frame)).toBe('two');
    releasePlayerFrame(frame);
    expect(getPlayerFrameSession(frame)).toBeNull();
  });
  it('keeps frame registrations separate', () => {
    const a = { postMessage: vi.fn() } as unknown as Window,
      b = { postMessage: vi.fn() } as unknown as Window;
    normalizePlayerMessage(a, { type: 'vo.FromPlayer.ReadyNotification' });
    postPlayerMessage(a, { type: 'vopStartCommand', sessionId: 'legacy', unitDefinition: 'test' });
    postPlayerMessage(b, { type: 'vopStartCommand', sessionId: 'modern', unitDefinition: '{}' });
    expect(b.postMessage).toHaveBeenLastCalledWith(
      { type: 'vopStartCommand', sessionId: 'modern', unitDefinition: '{}' },
      '*',
    );
    releasePlayerFrame(a);
    releasePlayerFrame(b);
  });
  it('replays an early start in the historical protocol when ready arrives after iframe load', () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    postPlayerMessage(frame, {
      type: 'vopStartCommand',
      sessionId: 'early',
      unitDefinition: 'titel::Test',
    });
    normalizePlayerMessage(frame, { type: 'vo.FromPlayer.ReadyNotification' });
    expect(frame.postMessage).toHaveBeenLastCalledWith(
      { type: 'vo.ToPlayer.DataTransfer', sessionId: 'early', unitDefinition: 'titel::Test' },
      '*',
    );
    releasePlayerFrame(frame);
  });
});
