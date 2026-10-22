/**
 * `next/image` for the Vite UI: a plain <img>. Only BrandMark uses it (src, alt, width, height, priority,
 * className, style). Image optimisation is dropped; the images are small static files in /public.
 */
import type { CSSProperties, ImgHTMLAttributes } from 'react';

type StaticImport = { src: string };

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height' | 'loading'> {
  src: string | StaticImport;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
}

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  priority,
  quality: _quality,
  unoptimized: _unoptimized,
  placeholder: _placeholder,
  blurDataURL: _blur,
  style,
  ...rest
}: ImageProps) {
  const resolved = typeof src === 'string' ? src : src.src;
  const fillStyle: CSSProperties | undefined = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : undefined;
  return (
    <img
      src={resolved}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? 'eager' : 'lazy'}
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}
