import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn (tailwind-merge with project scales)', () => {
  it('keeps type tokens when a colour class follows', () => {
    expect(cn('text-size-ui', 'text-red-500')).toBe('text-size-ui text-red-500');
    expect(cn('text-caption text-muted-foreground')).toBe('text-caption text-muted-foreground');
    expect(cn('text-title-card', 'text-[var(--ink-1)]')).toBe('text-title-card text-[var(--ink-1)]');
  });

  it('lets a later type token override an earlier one', () => {
    expect(cn('text-ui', 'text-caption')).toBe('text-caption');
    expect(cn('text-size-body', 'text-sm')).toBe('text-sm');
  });

  it('merges custom radius, duration, easing and shadow scales', () => {
    expect(cn('rounded-ctl', 'rounded-full')).toBe('rounded-full');
    expect(cn('rounded-lg', 'rounded-dialog')).toBe('rounded-dialog');
    expect(cn('duration-hover', 'duration-300')).toBe('duration-300');
    expect(cn('ease-out-strong', 'ease-in')).toBe('ease-in');
    expect(cn('shadow-card', 'shadow-none')).toBe('shadow-none');
  });
});
