'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

export interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  emptyMessage?: string
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  disabled = false,
  className,
  triggerClassName,
  emptyMessage = 'No results found.',
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const filtered = React.useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase()
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(q))
    )
  }, [options, search])

  const selectedOption = options.find((o) => o.value === value)

  React.useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            'h-10 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white',
            'hover:border-gray-400 dark:hover:border-slate-500 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2',
            !value && 'text-gray-500 dark:text-slate-400',
            triggerClassName,
            className
          )}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <div className="flex items-center border-b border-gray-200 dark:border-slate-600 px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 text-gray-400 dark:text-slate-400" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex h-10 w-full bg-transparent py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-500 dark:placeholder:text-slate-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="ml-1 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-slate-600"
            >
              <X className="h-3.5 w-3.5 text-gray-400 dark:text-slate-400" />
            </button>
          )}
        </div>
        <div
          ref={listRef}
          className="max-h-[300px] overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500 dark:text-slate-400">
              {emptyMessage}
            </div>
          ) : (
            filtered.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none',
                  'hover:bg-orange-50 dark:hover:bg-slate-600 hover:text-orange-900 dark:hover:text-white',
                  'transition-colors',
                  value === option.value && 'bg-orange-50 dark:bg-slate-600'
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  {value === option.value && (
                    <Check className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                  )}
                </span>
                <div className="flex flex-col items-start">
                  <span className="text-gray-900 dark:text-white font-medium">
                    {option.label}
                  </span>
                  {option.sublabel && (
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {option.sublabel}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
