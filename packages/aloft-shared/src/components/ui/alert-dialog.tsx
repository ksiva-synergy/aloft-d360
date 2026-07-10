import * as React from "react"
import { cn } from "@/lib/utils"

export interface AlertDialogProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export interface AlertDialogTriggerProps {
  children: React.ReactNode
  asChild?: boolean
}

export interface AlertDialogContentProps {
  children: React.ReactNode
  className?: string
}

export interface AlertDialogHeaderProps {
  children: React.ReactNode
}

export interface AlertDialogTitleProps {
  children: React.ReactNode
}

export interface AlertDialogDescriptionProps {
  children: React.ReactNode
}

export interface AlertDialogFooterProps {
  children: React.ReactNode
}

export interface AlertDialogActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
  /** If true, the dialog will NOT automatically close when clicked. Default: false */
  preventClose?: boolean
}

export interface AlertDialogCancelProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

// Context for managing dialog state
const AlertDialogContext = React.createContext<{
  isOpen: boolean
  setIsOpen: (open: boolean) => void
} | null>(null)

const AlertDialog = ({ children, open, onOpenChange }: AlertDialogProps) => {
  const [internalOpen, setInternalOpen] = React.useState(false)
  
  // Use controlled state if provided, otherwise use internal state
  const isOpen = open !== undefined ? open : internalOpen
  const setIsOpen = React.useCallback((newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen)
    } else {
      setInternalOpen(newOpen)
    }
  }, [onOpenChange])
  
  // Handle escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, setIsOpen])
  
  return (
    <AlertDialogContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </AlertDialogContext.Provider>
  )
}

const AlertDialogTrigger = ({ children, asChild }: AlertDialogTriggerProps) => {
  const context = React.useContext(AlertDialogContext)
  if (!context) throw new Error("AlertDialogTrigger must be used within AlertDialog")
  
  const { setIsOpen } = context
  
  if (asChild) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>, {
      onClick: (e: React.MouseEvent) => {
        e.preventDefault()
        setIsOpen(true)
        const originalOnClick = (children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>).props.onClick
        if (originalOnClick) originalOnClick(e)
      }
    })
  }
  return (
    <button onClick={() => setIsOpen(true)}>
      {children}
    </button>
  )
}

const AlertDialogContent = React.forwardRef<HTMLDivElement, AlertDialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(AlertDialogContext)
    if (!context) throw new Error("AlertDialogContent must be used within AlertDialog")
    
    const { isOpen, setIsOpen } = context
    
    if (!isOpen) return null
    
    return (
      <div
        ref={ref}
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center",
          className
        )}
        {...props}
      >
        <div 
          className="fixed inset-0 bg-black/50" 
          onClick={() => setIsOpen(false)}
        />
        <div 
          className="relative z-50 bg-white dark:bg-gray-800 p-6 shadow-lg rounded-lg border max-w-lg w-full mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    )
  }
)
AlertDialogContent.displayName = "AlertDialogContent"

const AlertDialogHeader = ({ children }: AlertDialogHeaderProps) => (
  <div className="mb-4">{children}</div>
)

const AlertDialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
)
AlertDialogTitle.displayName = "AlertDialogTitle"

const AlertDialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
)
AlertDialogDescription.displayName = "AlertDialogDescription"

const AlertDialogFooter = ({ children }: AlertDialogFooterProps) => (
  <div className="flex justify-end space-x-2 pt-4">{children}</div>
)

const AlertDialogAction = React.forwardRef<HTMLButtonElement, AlertDialogActionProps>(
  ({ className, children, onClick, preventClose, ...props }, ref) => {
    const context = React.useContext(AlertDialogContext)
    if (!context) throw new Error("AlertDialogAction must be used within AlertDialog")
    
    const { setIsOpen } = context
    
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2",
          className
        )}
        onClick={(e) => {
          if (onClick) onClick(e)
          // Only auto-close if preventClose is not set
          if (!preventClose) {
            setIsOpen(false)
          }
        }}
        {...props}
      >
        {children}
      </button>
    )
  }
)
AlertDialogAction.displayName = "AlertDialogAction"

const AlertDialogCancel = React.forwardRef<HTMLButtonElement, AlertDialogCancelProps>(
  ({ className, children, onClick, ...props }, ref) => {
    const context = React.useContext(AlertDialogContext)
    if (!context) throw new Error("AlertDialogCancel must be used within AlertDialog")
    
    const { setIsOpen } = context
    
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2",
          className
        )}
        onClick={(e) => {
          if (onClick) onClick(e)
          setIsOpen(false)
        }}
        {...props}
      >
        {children}
      </button>
    )
  }
)
AlertDialogCancel.displayName = "AlertDialogCancel"

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
}
