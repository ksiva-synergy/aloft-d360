import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
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
