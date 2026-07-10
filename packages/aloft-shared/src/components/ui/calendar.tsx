"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium text-gray-900 dark:text-white",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-gray-500 dark:text-gray-400 rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-gray-100 dark:bg-slate-800 [&:has([aria-selected])]:bg-gray-100 dark:bg-slate-800 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-md hover:bg-slate-100 dark:hover:bg-slate-600 hover:text-slate-900 dark:hover:text-white transition-colors"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-orange-600 dark:bg-orange-500 text-white hover:bg-orange-600 dark:hover:bg-orange-500 hover:text-white focus:bg-orange-600 dark:focus:bg-orange-500 focus:text-white",
        day_today: "bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white",
        day_outside:
          "day-outside text-gray-500 dark:text-gray-400 opacity-50 aria-selected:bg-gray-100 dark:aria-selected:bg-slate-800 aria-selected:text-gray-500 dark:aria-selected:text-gray-400",
        day_disabled: "text-gray-500 dark:text-gray-400 opacity-50",
        day_range_middle:
          "aria-selected:bg-gray-100 dark:aria-selected:bg-slate-800 aria-selected:text-gray-900 dark:aria-selected:text-white",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ...props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ...props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
