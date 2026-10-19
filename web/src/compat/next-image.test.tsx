import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Image from './next-image';

describe('next/image shim', () => {
  it('renders an <img> with src, alt, dimensions, class and style (BrandMark usage)', () => {
    const { container } = render(
      <Image src="/synergy-mark.png" alt="Synergy Group" width={44} height={44} priority className="h-full" style={{ padding: 4 }} />,
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/synergy-mark.png');
    expect(img.alt).toBe('Synergy Group');
    expect(img.getAttribute('width')).toBe('44');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.className).toBe('h-full');
    expect(img.style.padding).toBe('4px');
  });

  it('non-priority images are lazy; static imports resolve; Next-only props do not reach the DOM', () => {
    const { container } = render(
      <Image src={{ src: '/a.png' }} alt="a" width={1} height={1} quality={80} unoptimized placeholder="blur" blurDataURL="x" />,
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/a.png');
    expect(img.getAttribute('loading')).toBe('lazy');
    for (const a of ['quality', 'unoptimized', 'placeholder', 'blurdatauri']) expect(img.hasAttribute(a)).toBe(false);
  });

  it('fill covers the parent and drops width/height', () => {
    const { container } = render(<Image src="/f.png" alt="f" fill />);
    const img = container.querySelector('img')!;
    expect(img.style.position).toBe('absolute');
    expect(img.hasAttribute('width')).toBe(false);
  });
});
