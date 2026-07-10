'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { routeLabels, noBreadcrumbRoutes } from '@/lib/breadcrumb-config'

export interface AppBreadcrumbProps {
  /**
   * Override labels for dynamic path segments.
   * e.g. { 'abc-123': 'Job #42' } will replace the raw segment 'abc-123'
   * with 'Job #42' in the breadcrumb trail.
   */
  dynamicLabels?: Record<string, string>
  /** Additional className for the wrapper */
  className?: string
}

interface BreadcrumbSegment {
  label: string
  href: string
  isLast: boolean
}

function buildSegments(
  pathname: string,
  dynamicLabels: Record<string, string>
): BreadcrumbSegment[] {
  const parts = pathname.split('/').filter(Boolean)

  return parts.map((segment, idx) => {
    const href = '/' + parts.slice(0, idx + 1).join('/')
    const label =
      dynamicLabels[segment] ??
      routeLabels[segment] ??
      // Capitalise unknown segments as a fallback
      segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

    return {
      label,
      href,
      isLast: idx === parts.length - 1,
    }
  })
}

const MAX_VISIBLE_ITEMS = 4

export function AppBreadcrumb({ dynamicLabels = {}, className }: AppBreadcrumbProps) {
  const pathname = usePathname()
  const router = useRouter()

  // Alt+ArrowUp → navigate to parent route
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length > 1) {
          const parentPath = '/' + parts.slice(0, -1).join('/')
          router.push(parentPath)
        } else if (parts.length === 1) {
          router.push('/dashboard')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pathname, router])

  if (noBreadcrumbRoutes.has(pathname)) return null

  const segments = buildSegments(pathname, dynamicLabels)

  if (segments.length === 0) return null

  // Collapse middle items when there are too many segments
  const shouldCollapse = segments.length > MAX_VISIBLE_ITEMS
  let visibleSegments: (BreadcrumbSegment | null)[] = segments
  if (shouldCollapse) {
    // Show first + ellipsis + last 2
    visibleSegments = [
      segments[0],
      null, // null = ellipsis
      ...segments.slice(-2),
    ]
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={className}
    >
      <Breadcrumb>
        <BreadcrumbList className="text-xs sm:text-sm">
          {/* Home icon anchor */}
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link
                href="/dashboard"
                className="flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                aria-label="Home"
              >
                <Home className="h-3.5 w-3.5" />
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>

          {visibleSegments.map((seg, idx) => {
            if (seg === null) {
              // Ellipsis item
              return (
                <span key="ellipsis" className="flex items-center gap-1.5">
                  <BreadcrumbSeparator className="text-[var(--text-tertiary)]" />
                  <BreadcrumbItem>
                    <BreadcrumbEllipsis className="h-4 w-4" />
                  </BreadcrumbItem>
                </span>
              )
            }

            return (
              <span key={seg.href} className="flex items-center gap-1.5">
                <BreadcrumbSeparator className="text-[var(--text-tertiary)]" />
                <BreadcrumbItem>
                  {seg.isLast ? (
                    <BreadcrumbPage className="text-[var(--foreground)] font-medium max-w-[240px] truncate">
                      {seg.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link
                        href={seg.href}
                        className="text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors max-w-[180px] truncate"
                      >
                        {seg.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </motion.div>
  )
}
