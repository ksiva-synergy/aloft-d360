import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the project's custom scales (tailwind.config.js). Without this,
// a type token such as `text-size-ui` is mistaken for a text colour and dropped when a
// colour class follows it, and custom radius/duration/easing classes never merge.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{
        text: [
          'size-caption', 'size-ui', 'size-body', 'size-body-lg', 'size-title-section', 'size-kpi-lg', 'size-display',
          'display', 'title-page', 'title-section', 'title-card', 'body-lg', 'body', 'ui-lg', 'ui', 'ui-regular',
          'label', 'caption', 'eyebrow', 'kpi-lg', 'kpi-md', 'kpi-sm', 'code',
        ],
      }],
      rounded: [{ rounded: ['xs', 'ctl', 'card', 'dialog', 'brand'] }],
      duration: [{ duration: ['press', 'hover', 'pop', 'dialog', 'drawer'] }],
      ease: [{ ease: ['sidebar', 'out-strong', 'in-out-strong', 'drawer'] }],
      shadow: [{ shadow: ['card', 'pop', 'nav', 'dialog'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type MaritimeLoadingType =
  | 'dolphin-dance'
  | 'compass-spin'
  | 'ship-wheel'
  | 'treasure-chest'
  | 'sailboat-regatta'

/**
 * Get a random maritime loading animation type
 * @param exclude - Optional array of types to exclude from random selection
 * @returns A random MaritimeLoadingType
 */
export function getRandomMaritimeLoadingType(excludeTypes: MaritimeLoadingType[] = []): MaritimeLoadingType {
  const allTypes: MaritimeLoadingType[] = [
    'dolphin-dance',
    'compass-spin',
    'ship-wheel',
    'treasure-chest',
    'sailboat-regatta'
  ]

  const availableTypes = allTypes.filter(type => !excludeTypes.includes(type))

  if (availableTypes.length === 0) {
    return 'dolphin-dance' // Fallback to default
  }

  const randomIndex = Math.floor(Math.random() * availableTypes.length)
  return availableTypes[randomIndex]
}

/**
 * Get a random maritime loading animation configuration
 * @param baseMessage - Base message for the loading animation
 * @param baseSubMessage - Optional base sub-message
 * @param excludeTypes - Optional array of types to exclude
 * @returns Object with type and message configuration
 */
export function getRandomMaritimeLoadingConfig(
  baseMessage: string,
  baseSubMessage?: string,
  excludeTypes: MaritimeLoadingType[] = []
) {
  const type = getRandomMaritimeLoadingType(excludeTypes)

  const contextualMessages: Record<string, { message: string; subMessage: string }> = {
    'dolphin-dance': {
      message: baseMessage,
      subMessage: baseSubMessage || 'Dancing through maritime data with playful dolphins...'
    },
    'compass-spin': {
      message: baseMessage,
      subMessage: baseSubMessage || 'Charting the course for your maritime information...'
    },
    'ship-wheel': {
      message: baseMessage,
      subMessage: baseSubMessage || 'Steering through maritime operations smoothly...'
    },
    'treasure-chest': {
      message: baseMessage,
      subMessage: baseSubMessage || 'Uncovering maritime treasures in the data...'
    },
    'sailboat-regatta': {
      message: baseMessage,
      subMessage: baseSubMessage || 'Racing through maritime records at full sail...'
    }
  }

  return {
    type,
    ...contextualMessages[type]
  }
}
