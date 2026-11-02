import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-label whitespace-nowrap transition-colors duration-hover focus:outline-none focus-visible:shadow-[var(--focus-ring)]",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink)]",
        secondary:
          "border-transparent bg-[var(--surface-2)] text-[var(--ink-2)]",
        destructive:
          "border-transparent bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-[var(--bad)]",
        outline: "border-[var(--line-2)] text-[var(--ink-2)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  // Safeguard: Ensure we never render objects directly (React error #130)
  let safeChildren: React.ReactNode = children
  if (children !== null && children !== undefined) {
    if (typeof children === 'object') {
      if (React.isValidElement(children)) {
        // Valid React element - allow it
        safeChildren = children
      } else if (Array.isArray(children)) {
        // Validate array items - React can render arrays of elements
        safeChildren = children.map((child, idx) => {
          if (child === null || child === undefined || child === false) {
            return child
          }
          if (typeof child === 'object' && !React.isValidElement(child)) {
            // Plain object in array - convert to string
            if (process.env.NODE_ENV === 'development') {
              console.warn(`[Badge] Array item at index ${idx} is a plain object. This will cause React error #130.`, child)
            }
            return JSON.stringify(child)
          }
          return child
        })
      } else {
        // Plain object (not a React element) - convert to string
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Badge] Received a plain object as children. This will cause React error #130.', children)
        }
        safeChildren = JSON.stringify(children)
      }
    }
    // Primitives (string, number, boolean) are fine as-is
  }
  
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {safeChildren}
    </div>
  )
}

export { Badge, badgeVariants }
