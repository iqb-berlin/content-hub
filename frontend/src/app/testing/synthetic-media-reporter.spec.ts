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
  it('does not claim coverage for an unexecuted player format', async () => {
    const { reporter, outputDir } = setup();
    await reporter.onEnd(fullResult('passed'));
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    expect(manifest.players).toHaveLength(6);
    expect(manifest.generationCoverage).toHaveLength(20);
    expect(
      manifest.generationCoverage.every(
        (entry: { verifiedIn: string[] }) => entry.verifiedIn.length === 0,
      ),
    ).toBe(true);
    expect(manifest.acceptanceCoverage).toHaveLength(15);
    expect(
      manifest.acceptanceCoverage.every(
        (entry: { results: unknown[] }) => entry.results.length === 0,
      ),
    ).toBe(true);
    expect(manifest.compatibilityCoverage).toEqual([]);
    expect(manifest.widgetRuntimes.version).toBe('1.1.0');
    expect(manifest.formatCoverage).toHaveLength(44);
    expect(
      manifest.formatCoverage.every(
        (unit: { verifiedIn: string[] }) => unit.verifiedIn.length === 0,
      ),
    ).toBe(true);
    expect(
      manifest.formatCoverage.find((unit: { id: string }) => unit.id === 'aspect-periodic')
        .coverage,
    ).toBe('widget-runtime-open');
  });

  it('keeps a diagnosed development build separate from successful task coverage', async () => {
    const { reporter, outputDir } = setup();
    reporter.onTestEnd(
      testCase(
        'records the upstream ABI 2 development-build limitation',
        '/e2e/synthetic-generations.spec.ts',
      ),
      testResult([]),
    );
    await reporter.onEnd(fullResult('passed'));
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    const abi = manifest.generationCoverage.find((entry: { id: string }) => entry.id === 'abi-m2');
    expect(abi.verifiedIn).toEqual([]);
    expect(abi.diagnosedIn).toEqual(['chromium']);
  });

  it('records executed acceptance and repaired ABI coverage without changing raw release evidence', async () => {
    const { reporter, outputDir } = setup();
    reporter.onTestEnd(
      testCase('accepts ASPECT read-only at 390px', '/e2e/synthetic-aspect-acceptance.spec.ts'),
      testResult([{ name: 'acceptance', contentType: 'image/png', body: Buffer.from('image') }]),
    );
    reporter.onTestEnd(
      testCase(
        'runs ABI 2 through the real application compatibility host',
        '/e2e/synthetic-generations-compatibility.spec.ts',
      ),
      testResult([]),
    );
    await reporter.onEnd(fullResult('passed'));
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    expect(
      manifest.acceptanceCoverage.find((entry: { kind: string }) => entry.kind === 'read-only')
        .results,
    ).toEqual([{ browser: 'chromium', viewport: 390, status: 'passed' }]);
    const abi = manifest.generationCoverage.find((entry: { id: string }) => entry.id === 'abi-m2');
    expect(abi.verifiedIn).toEqual([]);
    expect(abi.diagnosedIn).toEqual([]);
    expect(abi.compatibilityVerifiedIn).toEqual(['chromium']);
  });

  it('copies screenshots attached as buffers in generation tests', async () => {
    const { reporter, outputDir } = setup();
    const body = Buffer.from('synthetic screenshot');
    reporter.onTestEnd(
      testCase('runs an authored task in aspect-m3', '/e2e/synthetic-generations.spec.ts'),
      testResult([{ name: 'generation', contentType: 'image/png', body }]),
    );
    await reporter.onEnd(fullResult('passed'));
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    expect(manifest.cases).toHaveLength(1);
    expect(readFileSync(join(outputDir, manifest.cases[0].media[0].file))).toEqual(body);
  });

  it('rejects a passing player-family review without its video', async () => {
    const { reporter, directory } = setup();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const path = join(directory, 'state.png');
    writeFileSync(path, 'synthetic image');
    reporter.onTestEnd(
      testCase(
        'keeps readable coding and navigation in review for abi',
        '/e2e/synthetic-players-media.spec.ts',
      ),
      testResult([{ name: 'review', contentType: 'image/png', path }]),
    );
    expect(await reporter.onEnd(fullResult('passed'))).toEqual({ status: 'failed' });
  });

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
