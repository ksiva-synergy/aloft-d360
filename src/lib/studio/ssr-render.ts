// FARGATE-ONLY — never import this from src/app/api/** (Vercel serverless).
// readFileSync at module init will break on Vercel at load time.
// Only consumer: R2 digest Fargate job. The I0 verify script may import directly.
import echarts from './echartsCore';
import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { compileSpecToOption } from './compiler';
import type { ChartDSLSpec } from './chart-dsl';
import type { ProfileResult } from './types';

const FONT_DIR = resolve(process.cwd(), 'assets/fonts');
const FONT_FILES = [
  resolve(FONT_DIR, 'ibm-plex-mono-400.ttf'),
  resolve(FONT_DIR, 'inter-tight-400.ttf'),
];

// Validate fonts exist at init time — fail loud rather than silent fallback
for (const f of FONT_FILES) {
  if (!existsSync(f)) {
    throw new Error(`[ssr-render] Required font missing: ${f}`);
  }
}

export interface RenderOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  theme?: 'aloft-dark' | 'aloft-light';
}

/**
 * Renders a ChartDSLSpec to PNG bytes via ECharts SSR → SVG → resvg-js.
 * Returns a Buffer containing the PNG image.
 */
export function renderSpecToPng(
  spec: ChartDSLSpec,
  profile: ProfileResult,
  rows: Record<string, unknown>[],
  opts?: RenderOptions,
): Buffer {
  const width = opts?.width ?? 800;
  const height = opts?.height ?? 450;
  const pixelRatio = opts?.pixelRatio ?? 2;
  const theme = opts?.theme ?? spec.themeSlot ?? 'aloft-dark';

  const option = compileSpecToOption(spec, profile, rows, theme);

  const chart = echarts.init(null, theme, {
    renderer: 'svg',
    ssr: true,
    width,
    height,
  });
  chart.setOption(option);
  const svgString = chart.renderToSVGString();
  chart.dispose();

  const background = theme === 'aloft-light' ? '#fafaf7' : '#003262';

  const resvg = new Resvg(svgString, {
    background,
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Inter Tight',
    },
    fitTo: { mode: 'width', value: width * pixelRatio },
  });

  return Buffer.from(resvg.render().asPng());
}

/**
 * Renders a raw SVG string to PNG. Useful for testing font embedding
 * without going through the full compiler path.
 */
export function renderSvgToPng(
  svgString: string,
  opts?: { width?: number; pixelRatio?: number; background?: string },
): Buffer {
  const width = opts?.width ?? 800;
  const pixelRatio = opts?.pixelRatio ?? 2;

  const resvg = new Resvg(svgString, {
    background: opts?.background ?? '#003262',
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Inter Tight',
    },
    fitTo: { mode: 'width', value: width * pixelRatio },
  });

  return Buffer.from(resvg.render().asPng());
}
