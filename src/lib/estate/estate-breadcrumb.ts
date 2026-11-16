import { routeLabels } from '@/lib/breadcrumb-config';

export type EstateCrumb = { label: string; href: string; isLast: boolean };

export function formatEstateSegmentLabel(segment: string, dynamicLabels: Record<string, string>): string {
  return (
    dynamicLabels[segment] ??
    routeLabels[segment] ??
    segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Trail inside Data Estate: Data Estate → section → deeper segments (no Agent Lab). */
export function buildEstateCrumbSegments(pathname: string, dynamicLabels: Record<string, string>): EstateCrumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'agent-lab' || parts[1] !== 'estate') return [];

  const tail = parts.slice(2);
  const segments: EstateCrumb[] = [{ label: 'Data Estate', href: '/agent-lab/estate', isLast: tail.length === 0 }];

  let href = '/agent-lab/estate';
  for (let i = 0; i < tail.length; i++) {
    const segment = tail[i];
    href += `/${segment}`;
    segments.push({
      label: formatEstateSegmentLabel(segment, dynamicLabels),
      href,
      isLast: i === tail.length - 1,
    });
  }
  return segments;
}