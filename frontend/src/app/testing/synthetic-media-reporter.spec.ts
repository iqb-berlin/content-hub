import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SyntheticMediaReporter from '../../../e2e/synthetic-media-reporter';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'synthetic-media-reporter-'));
  directories.push(directory);
  const outputDir = join(directory, 'gallery');
  const reporter = new SyntheticMediaReporter({ outputDir });
  reporter.onBegin();
  return { directory, outputDir, reporter };
}

function testCase(title: string, file = '/e2e/synthetic-aspect-media.spec.ts') {
  return {
    title,
    titlePath: () => ['chromium', title],
    location: { file },
    parent: { project: () => ({ name: 'chromium' }) },
  } as unknown as TestCase;
}
const fullResult = (status: FullResult['status']) => ({ status }) as FullResult;
const testResult = (
  attachments: TestResult['attachments'],
  status: TestResult['status'] = 'passed',
) => ({ status, duration: 123, attachments }) as TestResult;

describe('Synthetic media reporter', () => {
  it('rejects a passing walkthrough with incomplete recordings', async () => {
    const { reporter, outputDir } = setup();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    reporter.onTestEnd(testCase('records a verified walkthrough'), testResult([]));
    expect(await reporter.onEnd(fullResult('passed'))).toEqual({ status: 'failed' });
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('failed');
    expect(manifest.mediaErrors).toHaveLength(1);
    expect(readFileSync(join(outputDir, 'index.html'), 'utf8')).toContain(
      '<strong>failed</strong>',
    );
  });

  it('copies only gallery media, escapes titles and retains the failing run status', async () => {
    const { reporter, directory, outputDir } = setup();
    const image = join(directory, 'state.png');
    const trace = join(directory, 'trace.zip');
    writeFileSync(image, 'synthetic image');
    writeFileSync(trace, 'sensitive diagnostic contents');
    reporter.onTestEnd(
      testCase('<script>alert(1)</script>', '/e2e/synthetic-aspect.spec.ts'),
      testResult(
        [
          { name: '<img onerror=alert(1)>', contentType: 'image/png', path: image },
          { name: 'trace', contentType: 'application/zip', path: trace },
        ],
        'failed',
      ),
    );
    expect(await reporter.onEnd(fullResult('failed'))).toEqual({ status: 'failed' });
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    expect(manifest.cases[0].media).toHaveLength(1);
    expect(manifest.cases[0].media[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(outputDir, manifest.cases[0].media[0].file), 'utf8')).toBe(
      'synthetic image',
    );
    const html = readFileSync(join(outputDir, 'index.html'), 'utf8');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('sensitive diagnostic contents');
  });

  it('removes stale results and ignores unrelated browser tests', async () => {
    const { reporter, outputDir } = setup();
    writeFileSync(join(outputDir, 'stale-video.webm'), 'old recording');
    reporter.onBegin();
    expect(readdirSync(outputDir)).toEqual([]);
    reporter.onTestEnd(testCase('other feature', '/e2e/other.spec.ts'), testResult([]));
    await reporter.onEnd(fullResult('passed'));
    expect(JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).cases).toEqual([]);
  });
});
