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
    repeatEachIndex: 0,
    location: { file },
    parent: { project: () => ({ name: 'chromium' }) },
  } as unknown as TestCase;
}
const fullResult = (status: FullResult['status']) => ({ status }) as FullResult;
const testResult = (
  attachments: TestResult['attachments'],
  status: TestResult['status'] = 'passed',
) => ({ status, duration: 123, attachments, retry: 0 }) as TestResult;

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

  it('keeps recordings and checksums distinct across retries of the same test', async () => {
    const { reporter, directory, outputDir } = setup();
    const path = join(directory, 'video.webm');
    const entry = testCase('retryable case', '/e2e/synthetic-aspect.spec.ts');
    writeFileSync(path, 'first attempt');
    reporter.onTestEnd(
      entry,
      testResult([{ name: 'video', contentType: 'video/webm', path }], 'failed'),
    );
    writeFileSync(path, 'second attempt');
    reporter.onTestEnd(entry, {
      ...testResult([{ name: 'video', contentType: 'video/webm', path }]),
      retry: 1,
    });
    await reporter.onEnd(fullResult('passed'));
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    const [first, second] = manifest.cases;
    expect(first.media[0].file).not.toBe(second.media[0].file);
    expect(first.media[0].sha256).not.toBe(second.media[0].sha256);
    expect(readFileSync(join(outputDir, first.media[0].file), 'utf8')).toBe('first attempt');
    expect(readFileSync(join(outputDir, second.media[0].file), 'utf8')).toBe('second attempt');
    expect([first.retry, second.retry]).toEqual([0, 1]);
  });

  it('keeps recordings distinct when repeating a test with repeat-each', async () => {
    const { reporter, directory, outputDir } = setup();
    const path = join(directory, 'state.png');
    const entry = testCase('repeated case', '/e2e/synthetic-aspect.spec.ts');
    writeFileSync(path, 'first repetition');
    reporter.onTestEnd(entry, testResult([{ name: 'state', contentType: 'image/png', path }]));
    writeFileSync(path, 'second repetition');
    reporter.onTestEnd(
      { ...entry, repeatEachIndex: 1 },
      testResult([{ name: 'state', contentType: 'image/png', path }]),
    );
    await reporter.onEnd(fullResult('passed'));
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    const [first, second] = manifest.cases;
    expect(first.media[0].file).not.toBe(second.media[0].file);
    expect(readFileSync(join(outputDir, first.media[0].file), 'utf8')).toBe('first repetition');
    expect(readFileSync(join(outputDir, second.media[0].file), 'utf8')).toBe('second repetition');
    expect([first.repetition, second.repetition]).toEqual([0, 1]);
  });
});
