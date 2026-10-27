import { cn } from '@/lib/utils';

/**
 * Synergy Group emblem (the ship mark from /synergy-group-logo.png, cropped to
 * /synergy-mark.png) on a white tile, so it reads on dark and light surfaces.
 * Use `variant="full"` where there is room for the complete badge with wordmark.
 */
export function BrandMark({
  size = 44,
  variant = 'mark',
  className,
}: {
  size?: number;
  variant?: 'mark' | 'full';
  className?: string;
}) {
  const src = variant === 'full' ? '/synergy-group-logo.png' : '/synergy-mark.png';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-[0_1px_2px_rgba(16,12,40,.12),0_0_0_1px_rgba(16,12,40,.06)]',
        className,
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      <img
        src={src}
        alt="Synergy Group"
        width={size}
        height={size}
        loading="eager"
        className="h-full w-full object-contain"
        style={{ padding: variant === 'full' ? 0 : Math.round(size * 0.1) }}
      />
    </span>
  );
}
