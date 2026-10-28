import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const root = resolve(__dirname, '../..');
const fixtureRoot = resolve(root, 'test-fixtures/synthetic-aspect');
const playerFixtureRoot = resolve(root, 'test-fixtures/synthetic-players');
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

interface CaseResult {
  browser: string;
  title: string;
  status: string;
  durationMs: number;
  retry: number;
  repetition: number;
  media: { name: string; file: string; type: string; sha256: string }[];
}

/** A portable gallery containing only synthetic media, never traces or auth state. */
export default class SyntheticMediaReporter implements Reporter {
  private cases: CaseResult[] = [];
  private readonly output: string;
  // Capture provenance before execution; a developer may commit while tests run.
  private readonly revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  private readonly workingTreeModified = Boolean(
    execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=normal',
        '--',
        'frontend',
        'backend/test',
        'test-fixtures',
        'scripts/run-browser-e2e.sh',
        '.github/workflows/ci.yml',
      ],
      { cwd: root, encoding: 'utf8' },
    ).trim(),
  );

  constructor(options: { outputDir?: string } = {}) {
    this.output = options.outputDir || resolve(root, 'frontend/synthetic-review-report');
  }

  onBegin() {
    const output = this.output;
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const output = this.output;
    if (!/\/synthetic-(?:aspect|players)(?:-media)?\.spec\.ts$/.test(test.location.file)) return;
    const browser = test.parent.project()!.name;
    const id = `${createHash('sha256').update(test.titlePath().join('/')).digest('hex').slice(0, 12)}-repeat-${test.repeatEachIndex}-attempt-${result.retry}`;
    const media: CaseResult['media'] = [];
    for (const attachment of result.attachments) {
      if (!attachment.path || !['image/png', 'video/webm'].includes(attachment.contentType))
        continue;
      const destination = resolve(output, browser, id, basename(attachment.path));
      mkdirSync(resolve(output, browser, id), { recursive: true });
      copyFileSync(attachment.path, destination);
      media.push({
        name: attachment.name,
        file: relative(output, destination).split('\\').join('/'),
        type: attachment.contentType,
        sha256: createHash('sha256').update(readFileSync(destination)).digest('hex'),
      });
    }
    this.cases.push({
      browser,
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
      repetition: test.repeatEachIndex,
      media,
    });
  }

  async onEnd(result: FullResult) {
    const output = this.output;
    const pool = JSON.parse(readFileSync(resolve(fixtureRoot, 'pool.json'), 'utf8'));
    const fixtureFiles = [
      'pool.json',
      pool.player.file,
      ...pool.units.map((unit: { file: string }) => unit.file),
    ];
    const fixtureHashes = Object.fromEntries(
      fixtureFiles.map((file: string) => [
        file,
        createHash('sha256')
          .update(readFileSync(resolve(fixtureRoot, file)))
          .digest('hex'),
      ]),
    );
    const playerPool = JSON.parse(readFileSync(resolve(playerFixtureRoot, 'pool.json'), 'utf8'));
    const playerFiles = [
      'pool.json',
      'catalogue.json',
      'resources.json',
      ...playerPool.media.map((media: { file: string }) => media.file),
      'ib/config.json',
      'ib/ib-runtime.9.9.0.html',
      ...playerPool.players.map((player: { file: string }) => player.file),
      ...playerPool.units.map((unit: { file: string }) => unit.file),
    ];
    for (const file of playerFiles) {
      fixtureHashes[`synthetic-players/${file}`] = createHash('sha256')
        .update(readFileSync(resolve(playerFixtureRoot, file)))
        .digest('hex');
    }
    const cases = this.cases.sort((left, right) =>
      `${left.browser}/${left.title}`.localeCompare(`${right.browser}/${right.title}`),
    );
    const missingMedia = cases
      .filter(
        (entry) =>
          entry.status === 'passed' &&
          entry.title.startsWith('records a verified walkthrough') &&
          (entry.media.filter((item) => item.type === 'image/png').length !== 7 ||
            !entry.media.some((item) => item.type === 'video/webm')),
      )
      .map((entry) => `Incomplete review media for ${entry.browser}.`);
    for (const entry of cases.filter((item) => item.status === 'passed')) {
      if (
        (entry.title.startsWith('covers ') || entry.title.startsWith('keeps readable coding')) &&
        !entry.media.some((item) => item.type === 'image/png')
      ) {
        missingMedia.push(`Missing format image: ${entry.browser} / ${entry.title}.`);
      }
      if (
        entry.title.startsWith('keeps readable coding') &&
        !entry.media.some((item) => item.type === 'video/webm')
      ) {
        missingMedia.push(`Missing player-family video: ${entry.browser} / ${entry.title}.`);
      }
    }
    const report = {
      status: missingMedia.length ? ('failed' as const) : result.status,
      mediaErrors: missingMedia,
      revision: this.revision,
      workingTreeModified: this.workingTreeModified,
      playerVersion: pool.player.version,
      definitionVersion: pool.definitionVersion,
      players: playerPool.players,
      resources: JSON.parse(readFileSync(resolve(playerFixtureRoot, 'resources.json'), 'utf8')),
      formatCoverage: playerPool.units.map(
        (unit: { id: string; player: string; formats: string[] }) => ({
          ...unit,
          verifiedIn: [
            ...new Set(
              cases
                .filter(
                  (entry) =>
                    entry.status === 'passed' &&
                    entry.title.startsWith(`covers ${unit.player} / ${unit.id}:`),
                )
                .map((entry) => entry.browser),
            ),
          ],
        }),
      ),
      data: pool.data,
      fixtureHashes,
      cases,
    };
    writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
    const rows = cases
      .map(
        (entry) =>
          `<tr><td>${escapeHtml(entry.browser)}</td><td>${escapeHtml(entry.title)}</td><td>${entry.retry + 1}</td><td>${escapeHtml(entry.status)}</td></tr>`,
      )
      .join('');
    const media = cases
      .filter((entry) => entry.media.length)
      .map(
        (entry) =>
          `<section><h2>${escapeHtml(entry.browser)} · ${escapeHtml(entry.title)}</h2><p>Status: ${escapeHtml(entry.status)} · Versuch ${entry.retry + 1}</p><div class="media">${entry.media.map((item) => `<figure>${item.type.startsWith('video/') ? `<video controls preload="metadata" src="${item.file}"></video>` : `<a href="${item.file}"><img loading="lazy" src="${item.file}" alt="${escapeHtml(item.name)}"></a>`}<figcaption>${escapeHtml(item.name)}</figcaption></figure>`).join('')}</div></section>`,
      )
      .join('');
    writeFileSync(
      resolve(output, 'index.html'),
      `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetischer Formate- und Player-Testpool</title><style>body{font:16px/1.5 system-ui;margin:2rem auto;padding:0 1rem;max-width:1100px;color:#163247;background:#f4f7fa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:.5rem;border:1px solid #ccd6df;text-align:left}.media{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}figure{margin:0;padding:1rem;background:white}img,video{width:100%;height:auto}h2{margin-top:2rem}code{overflow-wrap:anywhere}</style><h1>Synthetischer Formate- und Player-Testpool</h1><p>Status: <strong>${escapeHtml(report.status)}</strong> · ${cases.length} ausgeführte Tests · ${playerPool.players.length} Playerfamilien · ausschließlich synthetische Daten</p><p>Revision: <code>${escapeHtml(report.revision)}</code> · <a href="manifest.json">Ergebnisse, Abdeckungsmatrix und Prüfsummen</a></p><p>Die Aufnahmen zeigen feste, automatisch geprüfte Abläufe. Laufzeit, Browser-Rendering und Videolänge können zwischen Betriebssystemen variieren; es werden keine pixelgleichen Dateien zugesichert.</p><table><thead><tr><th>Browser</th><th>Prüfung</th><th>Versuch</th><th>Ergebnis</th></tr></thead><tbody>${rows}</tbody></table>${media}</html>`,
    );
    for (const error of missingMedia) process.stderr.write(`${error}\n`);
    return { status: report.status };
  }
}
