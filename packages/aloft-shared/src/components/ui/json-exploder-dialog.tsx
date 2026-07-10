'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Check if a value should be "exploded" (shown in JSON dialog)
 * Returns true for objects/arrays, false for primitives
 */
export function canExplode(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'object' && !Array.isArray(value)) {
    // Object (but not null) - check if it has properties
    return Object.keys(value).length > 0
  }
  if (Array.isArray(value)) {
    // Array - check if it has items
    return value.length > 0
  }
  // Primitive (string, number, boolean, etc.)
  return false
}

interface JsonExploderDialogProps {
  value: unknown
  fieldName: string
}

/**
 * Component that shows an info icon button which opens a dialog
 * displaying the JSON value in a formatted, readable way
 */
export function JsonExploderDialog({ value, fieldName }: JsonExploderDialogProps) {
  const [open, setOpen] = useState(false)

  // Safely stringify the value for display
  const jsonString = (() => {
    try {
      if (value === null || value === undefined) return 'null'
      if (typeof value === 'string') {
        // Try to parse if it looks like JSON
        try {
          const parsed = JSON.parse(value)
          return JSON.stringify(parsed, null, 2)
        } catch {
          return value
        }
      }
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  })()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-4 w-4 p-0 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          title={`View ${fieldName} details`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
        >
          <Info className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{fieldName}</DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <pre className="bg-slate-50 dark:bg-slate-900 p-4 rounded-md overflow-auto text-xs font-mono max-h-[70vh] border border-slate-200 dark:border-slate-700">
            {jsonString}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  )
}
