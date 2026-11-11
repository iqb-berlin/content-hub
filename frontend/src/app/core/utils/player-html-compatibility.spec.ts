import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_HTML_REPAIRS, preparePlayerHtml } from './player-html-compatibility';

afterEach(() => vi.unstubAllGlobals());
describe('pinned player compatibility backports', () => {
  for (const [index, file] of [
    'abi-major-2.html',
    'aspect-major-3.html',
    'aspect-editor-3.1.0.html',
  ].entries()) {
    it(`repairs only the verified original ${file} and is idempotent`, async () => {
      vi.stubGlobal('crypto', webcrypto);
      vi.stubGlobal('TextEncoder', TextEncoder);
      const bytes = readFileSync(
        resolve(__dirname, '../../../../../test-fixtures/player-generations/players', file),
      );
      const original = bytes.toString('utf8'),
        repair = PLAYER_HTML_REPAIRS[index];
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(repair.sha256);
      expect(original.length).toBe(repair.length);
      const prepared = await preparePlayerHtml(original);
      expect(prepared).toContain(repair.after);
      if ('additionalChanges' in repair)
        for (const change of repair.additionalChanges) expect(prepared).toContain(change.after);
      expect(prepared).toContain(`Content Hub compatibility: ${repair.id}`);
      expect(await preparePlayerHtml(prepared)).toBe(prepared);
      const changed = original.replace('html', 'htmL');
      expect(await preparePlayerHtml(changed)).not.toContain(
        `Content Hub compatibility: ${repair.id}`,
      );
    });
  }
});
