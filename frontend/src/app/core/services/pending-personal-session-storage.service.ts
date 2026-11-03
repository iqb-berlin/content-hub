import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PendingPersonalSessionStorageService {
  private readonly snapshotKeyPrefix = 'ch_item_explorer_pending_personal:';
  private readonly memoryFallback = new Map<string, string | null>();

  resolveIdentityFromToken(token: string | null): string | null {
    if (!token) return null;
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;

    try {
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const payload = JSON.parse(atob(paddedBase64)) as Record<string, unknown>;
      const sub = typeof payload['sub'] === 'string' ? payload['sub'].trim() : '';
      if (!sub) return null;
      if (typeof payload['exp'] === 'number' && payload['exp'] * 1000 <= Date.now()) {
        return null;
      }
      if (payload['type'] === 'credential') {
        return JSON.stringify([
          'credential',
          sub,
          typeof payload['acpId'] === 'string' ? payload['acpId'] : '',
        ]);
      }
      return JSON.stringify(['user', sub, '']);
    } catch {
      return null;
    }
  }

  activateIdentityFromToken(token: string | null): void {
    const identity = this.resolveIdentityFromToken(token);
    if (!identity) return;

    for (const key of this.snapshotKeys()) {
      const raw = this.get(key);
      if (!raw || this.snapshotIdentity(raw) !== identity) {
        this.remove(key);
      }
    }
  }

  set(key: string, value: string): void {
    this.memoryFallback.set(key, value);
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // The in-memory copy survives route changes in the current application session.
    }
  }

  get(key: string): string | null {
    if (this.memoryFallback.has(key)) {
      return this.memoryFallback.get(key) ?? null;
    }
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) return stored;
    } catch {
      // Fall through to the in-memory copy.
    }
    return this.memoryFallback.get(key) ?? null;
  }

  remove(key: string): void {
    try {
      sessionStorage.removeItem(key);
      this.memoryFallback.delete(key);
    } catch {
      this.memoryFallback.set(key, null);
    }
  }

  private snapshotKeys(): Set<string> {
    const keys = new Set(
      Array.from(this.memoryFallback.keys()).filter((key) =>
        key.startsWith(this.snapshotKeyPrefix),
      ),
    );
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(this.snapshotKeyPrefix)) keys.add(key);
      }
    } catch {
      // The in-memory keys remain available when session storage cannot be enumerated.
    }
    return keys;
  }

  private snapshotIdentity(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw) as { identity?: unknown };
      return typeof parsed.identity === 'string' ? parsed.identity : null;
    } catch {
      return null;
    }
  }
}
