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
        'scripts/player-coverage',
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
    if (
      !/\/synthetic-(?:aspect|players|generations)(?:-media)?\.spec\.ts$/.test(test.location.file)
    )
      return;
    const browser = test.parent.project()!.name;
    const id = `${createHash('sha256').update(test.titlePath().join('/')).digest('hex').slice(0, 12)}-repeat-${test.repeatEachIndex}-attempt-${result.retry}`;
    const media: CaseResult['media'] = [];
    for (const attachment of result.attachments) {
      if (
        (!attachment.path && !attachment.body) ||
        !['image/png', 'video/webm'].includes(attachment.contentType)
      )
        continue;
      const destination = resolve(
        output,
        browser,
        id,
        attachment.path ? basename(attachment.path) : `attachment-${media.length}.png`,
      );
      mkdirSync(resolve(output, browser, id), { recursive: true });
      if (attachment.path) copyFileSync(attachment.path, destination);
      else writeFileSync(destination, attachment.body!);
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
    const generations = JSON.parse(
      readFileSync(resolve(root, 'test-fixtures/player-generations/pool.json'), 'utf8'),
    );
    for (const file of [
      'pool.json',
      'release-index.json',
      'catalogue.json',
      'authoring/coverage.json',
      'authoring/ui-controls.json',
      'authoring/ui-created-tasks.json',
      'authoring/ui-control-mapping.json',
      'authoring/content-presets.json',
      ...[0, 1, 2, 3].map((major) => `authoring/aspect-${major}.json`),
      ...generations.editors.map((editor: { file: string }) => editor.file),
      ...generations.players.map((p: { file: string }) => p.file),
      ...generations.units.map((u: { file: string }) => u.file),
    ]) {
      fixtureHashes[`player-generations/${file}`] = createHash('sha256')
        .update(readFileSync(resolve(root, 'test-fixtures/player-generations', file)))
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
      generationCoverage: generations.players.map(
        (player: { id: string; integrationStatus?: string }) => ({
          ...player,
          verifiedIn: [
            ...new Set(
              cases
                .filter(
                  (entry) =>
                    entry.status === 'passed' &&
                    (entry.title === `runs an authored task in ${player.id}` ||
                      (player.id === 'ib-m0' &&
                        entry.title ===
                          'serves every original generation and the ItemBuilder task through the real API')),
                )
                .map((entry) => entry.browser),
            ),
          ],
          diagnosedIn: player.integrationStatus
            ? [
                ...new Set(
                  cases
                    .filter(
                      (entry) =>
                        entry.status === 'passed' &&
                        entry.title === 'records the upstream ABI 2 development-build limitation',
                    )
                    .map((entry) => entry.browser),
                ),
              ]
            : [],
        }),
      ),
      uiAssistantCoverage: [
        ...new Set(
          generations.units
            .filter((unit: { uiAuthoring?: { wizard: string } }) => unit.uiAuthoring)
            .map((unit: { uiAuthoring: { wizard: string } }) => unit.uiAuthoring.wizard),
        ),
      ].map((wizard) => ({
        wizard,
        units: generations.units.filter(
          (unit: { uiAuthoring?: { wizard: string } }) => unit.uiAuthoring?.wizard === wizard,
        ).length,
        verifiedIn: [
          ...new Set(
            cases
              .filter(
                (entry) =>
                  entry.status === 'passed' &&
                  entry.title === `renders every UI-created ${wizard} task through the app`,
              )
              .map((entry) => entry.browser),
          ),
        ],
      })),
      authoringCoverage: generations.units
        .filter(
          (unit: { player: string; element?: string }) =>
            unit.player === 'aspect-m3' && unit.element,
        )
        .map((unit: { id: string; element: string; authoringCases: unknown[] }) => ({
          unit: unit.id,
          element: unit.element,
          cases: unit.authoringCases.length,
          roundTrippedIn: [
            ...new Set(
              cases
                .filter(
                  (entry) =>
                    entry.status === 'passed' &&
                    entry.title ===
                      `round-trips every authored ${unit.element} setting through ASPECT 3.1 UI`,
                )
                .map((entry) => entry.browser),
            ),
          ],
        })),
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
    const generationRows = report.generationCoverage
      .map(
        (entry: { id: string; verifiedIn: string[]; diagnosedIn: string[] }) =>
          `<tr><td>${escapeHtml(entry.id)}</td><td>${escapeHtml(entry.verifiedIn.join(', ') || 'keine bestätigte Aufgabeninteraktion')}</td><td>${escapeHtml(entry.diagnosedIn.length ? 'Einschränkung bestätigt: ' + entry.diagnosedIn.join(', ') : '')}</td></tr>`,
      )
      .join('');
    const settingRows = report.authoringCoverage
      .map(
        (entry: { element: string; cases: number; roundTrippedIn: string[] }) =>
          `<tr><td>${escapeHtml(entry.element)}</td><td>${entry.cases}</td><td>${escapeHtml(entry.roundTrippedIn.join(', '))}</td></tr>`,
      )
      .join('');
    writeFileSync(
      resolve(output, 'index.html'),
      `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetischer Formate- und Player-Testpool</title><style>body{font:16px/1.5 system-ui;margin:2rem auto;padding:0 1rem;max-width:1100px;color:#163247;background:#f4f7fa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:.5rem;border:1px solid #ccd6df;text-align:left}.media{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}figure{margin:0;padding:1rem;background:white}img,video{width:100%;height:auto}h2{margin-top:2rem}code{overflow-wrap:anywhere}</style><h1>Synthetischer Formate- und Player-Testpool</h1><p>Status: <strong>${escapeHtml(report.status)}</strong> · ${cases.length} ausgeführte Tests · ${playerPool.players.length} Playerfamilien · ausschließlich synthetische Daten</p><p>Revision: <code>${escapeHtml(report.revision)}</code> · <a href="manifest.json">Ergebnisse, Abdeckungsmatrix und Prüfsummen</a></p><p>Die Aufnahmen zeigen feste, automatisch geprüfte Abläufe. Laufzeit, Browser-Rendering und Videolänge können zwischen Betriebssystemen variieren; es werden keine pixelgleichen Dateien zugesichert.</p><h2>Playergenerationen</h2><p>ABI 1 wird im Legacy-Testhost geprüft. ABI 2.0.1 startet nur seine interne Demo; die bestätigte Einschränkung ist keine erfolgreiche Aufgabeninteraktion.</p><table><thead><tr><th>Generation</th><th>Aufgabe bedient in</th><th>Diagnose</th></tr></thead><tbody>${generationRows}</tbody></table><h2>ASPECT-Einstellungen im Originaleditor</h2><p>Import, echte Änderung und Export prüfen den Erhalt der Werte. Die Laufzeitwirkung aller Kombinationen wird damit nicht behauptet.</p><table><thead><tr><th>Element</th><th>Varianten</th><th>UI-Rundlauf</th></tr></thead><tbody>${settingRows}</tbody></table><h2>Ausgeführte Prüfungen</h2><table><thead><tr><th>Browser</th><th>Prüfung</th><th>Versuch</th><th>Ergebnis</th></tr></thead><tbody>${rows}</tbody></table>${media}</html>`,
    );
    for (const error of missingMedia) process.stderr.write(`${error}\n`);
    return { status: report.status };
  }
}
