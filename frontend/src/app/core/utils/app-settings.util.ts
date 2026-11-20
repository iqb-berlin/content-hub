export const DEFAULT_THEME: Record<string, string> = {
  '--color-primary': '#5B21B6',
  '--color-primary-light': '#6D28D9',
  '--color-accent': '#e67e22',
  '--color-success': '#27ae60',
  '--color-danger': '#e74c3c',
  '--color-warning': '#f39c12',
  '--color-bg': '#f5f7fa',
  '--color-surface': '#ffffff',
  '--color-text': '#2c3e50',
  '--color-text-secondary': '#566573',
  '--color-border': '#dfe6e9',
};

const MIN_TEXT_CONTRAST = 4.5;

function parseHexColor(value: string): [number, number, number] | null {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((character) => character + character)
          .join('')
      : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(value: string): number | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return 0;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function pickAccessibleColor(candidates: string[], backgrounds: string[]): string {
  const uniqueCandidates = Array.from(new Set(candidates));
  const accessible = uniqueCandidates.find((candidate) =>
    backgrounds.every((background) => contrastRatio(candidate, background) >= MIN_TEXT_CONTRAST),
  );
  if (accessible) return accessible;
  return uniqueCandidates.reduce((best, candidate) => {
    const candidateContrast = Math.min(
      ...backgrounds.map((background) => contrastRatio(candidate, background)),
    );
    const bestContrast = Math.min(
      ...backgrounds.map((background) => contrastRatio(best, background)),
    );
    return candidateContrast > bestContrast ? candidate : best;
  });
}

export function normalizeTheme(
  theme: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const normalized = { ...DEFAULT_THEME };
  if (theme && typeof theme === 'object') {
    for (const [key, value] of Object.entries(theme)) {
      if (
        Object.prototype.hasOwnProperty.call(DEFAULT_THEME, key) &&
        typeof value === 'string' &&
        value.trim()
      ) {
        normalized[key] = value;
      }
    }
  }

  const primary = normalized['--color-primary'];
  const background = normalized['--color-bg'];
  const surface = normalized['--color-surface'];
  normalized['--color-on-primary'] = pickAccessibleColor(['#ffffff', '#000000'], [primary]);
  normalized['--color-link'] = pickAccessibleColor(
    [
      normalized['--color-primary-light'],
      primary,
      DEFAULT_THEME['--color-primary'],
      '#000000',
      '#ffffff',
    ],
    [background, surface],
  );
  normalized['--color-text-secondary'] = pickAccessibleColor(
    [
      normalized['--color-text-secondary'],
      DEFAULT_THEME['--color-text-secondary'],
      normalized['--color-text'],
      '#000000',
      '#ffffff',
    ],
    [background, surface],
  );
  normalized['--color-danger-text'] = pickAccessibleColor(
    [normalized['--color-danger'], '#a93226', '#922b21', '#000000'],
    [surface],
  );

  return normalized;
}

export function applyTheme(theme: Record<string, unknown> | null | undefined): void {
  if (typeof document === 'undefined') {
    return;
  }

  const normalized = normalizeTheme(theme);
  const root = document.documentElement;

  for (const [key, value] of Object.entries(normalized)) {
    root.style.setProperty(key, value);
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', normalized['--color-primary']);
}

export function applyLanguage(language: string | null | undefined): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = language?.trim() || 'de';
}
