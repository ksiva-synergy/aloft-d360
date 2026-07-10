'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { cn, getRandomMaritimeLoadingType } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

export type MaritimeLoadingType =
  | 'dolphin-dance'
  | 'compass-spin'
  | 'ship-wheel'
  | 'treasure-chest'
  | 'sailboat-regatta'

interface MaritimeLoadingProps {
  type?: MaritimeLoadingType
  message?: string
  subMessage?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xs'
  showProgress?: boolean
  estimatedDuration?: number // in seconds
  className?: string
  random?: boolean // If true, randomly selects a loading type
  excludeTypes?: MaritimeLoadingType[] // Types to exclude when using random selection
  preset?: Partial<MaritimeLoadingProps> // Preset configuration object
}

export function MaritimeLoading({
  type = 'dolphin-dance',
  message = 'Loading...',
  subMessage,
  size = 'lg',
  showProgress = false,
  estimatedDuration,
  className,
  random = false,
  excludeTypes = []
}: MaritimeLoadingProps) {
  const [progress, setProgress] = useState(0)
  const [currentTip, setCurrentTip] = useState(0)
  const animationTypeRef = useRef<MaritimeLoadingType | null>(null)

  const maritimeTips = [
    "Navigating through maritime data...",
    "Charting the course for your request...",
    "Synchronizing with port authorities...",
    "Processing seafarer documentation...",
    "Calculating voyage earnings...",
    "Updating vessel manifests...",
    "Coordinating with maritime systems...",
    "Finalizing payroll calculations...",
    // REBRAND: "portage bill calculations" → "payroll calculations"
  ]

  // Deterministic initial type for SSR; randomize only after mount to avoid hydration mismatch
  const [animationType, setAnimationType] = useState<MaritimeLoadingType>(() => {
    return type || 'dolphin-dance'
  })

  useEffect(() => {
    if (random && !animationTypeRef.current) {
      const randomType = getRandomMaritimeLoadingType(excludeTypes)
      setAnimationType(randomType)
      animationTypeRef.current = randomType
    } else if (!random) {
      setAnimationType(type)
      animationTypeRef.current = type
    }
  }, []) // Randomize only on client after mount

  useEffect(() => {
    if (showProgress && estimatedDuration) {
      const interval = setInterval(() => {
        setProgress(prev => {
          const increment = 100 / (estimatedDuration * 10) // Update every 100ms
          return Math.min(prev + increment, 95) // Cap at 95% until completion
        })
      }, 100)

      return () => clearInterval(interval)
    }
  }, [showProgress, estimatedDuration])

  useEffect(() => {
    const tipInterval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % maritimeTips.length)
    }, 3000)

    return () => clearInterval(tipInterval)
  }, [])

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24', 
    lg: 'w-32 h-32',
    xl: 'w-48 h-48'
  }

  const renderAnimation = () => {
    switch (animationType) {
      case 'dolphin-dance':
        return (
          <div className="relative bg-gradient-to-br from-blue-400 to-blue-600 rounded-full p-4">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-2 animate-bounce">🐬</div>
                <div className="text-sm text-white font-medium">Dolphin Dance</div>
              </div>
            </div>
          </div>
        )

      case 'ship-wheel':
        return (
          <div className="relative bg-gradient-to-br from-amber-500 to-amber-700 rounded-full p-4">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-2 animate-spin" style={{ animationDuration: '3s' }}>⚓</div>
                <div className="text-sm text-white font-medium">Ship Wheel</div>
              </div>
            </div>
          </div>
        )

      case 'compass-spin':
        return (
          <div className="relative bg-gradient-to-br from-amber-400 to-amber-600 rounded-full p-4">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-2 animate-spin" style={{ animationDuration: '2s' }}>🧭</div>
                <div className="text-sm text-white font-medium">Compass Navigation</div>
              </div>
            </div>
          </div>
        )

      case 'treasure-chest':
        return (
          <div className="relative bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-lg p-4">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-2 animate-bounce" style={{ animationDuration: '2s' }}>💎</div>
                <div className="text-sm text-white font-medium">Treasure Chest</div>
              </div>
            </div>
          </div>
        )

      case 'sailboat-regatta':
        return (
          <div className="relative bg-gradient-to-br from-sky-400 to-blue-600 rounded-full p-4">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-2 animate-bounce" style={{ animationDuration: '2.5s' }}>⛵</div>
                <div className="text-sm text-white font-medium">Sailboat Regatta</div>
              </div>
            </div>
          </div>
        )

      default:
        return (
          <div className="relative bg-gradient-to-br from-blue-500 to-blue-700 rounded-full p-4">
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            </div>
          </div>
        )
    }
  }

  return (
    <div className={cn("flex flex-col items-center justify-center space-y-6 p-8", className)}>
      {/* Main animation */}
      <div className={cn("relative", sizeClasses[size])}>
        {renderAnimation()}
      </div>

      {/* Main message */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
          {message}
        </h3>
        {subMessage && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {subMessage}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div className="w-full max-w-md">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-2">
            <span>Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Rotating tips */}
      <div className="text-center min-h-[2rem] flex items-center">
        <p className="text-sm text-gray-500 dark:text-gray-500 italic transition-opacity duration-500">
          {maritimeTips[currentTip]}
        </p>
      </div>
    </div>
  )
}

// Preset configurations for common loading scenarios
export const MaritimeLoadingPresets = {
  contractsLoading: {
    type: 'dolphin-dance' as MaritimeLoadingType,
    message: 'Loading Contracts',
    subMessage: 'Dancing through seafarer contract data with playful dolphins',
    showProgress: true,
    estimatedDuration: 15
  },

  randomLoading: {
    random: true,
    message: 'Loading...',
    subMessage: 'Processing maritime data...',
    showProgress: true,
    estimatedDuration: 15
  },
  
  portageCalculation: {
    type: 'compass-spin' as MaritimeLoadingType,
    message: 'Calculating Payroll', // REBRAND: "Calculating Portage Bills" → "Calculating Payroll"
    subMessage: 'Processing earnings, deductions, and maritime regulations',
    showProgress: true,
    estimatedDuration: 30
  },

  dataSync: {
    type: 'ship-wheel' as MaritimeLoadingType,
    message: 'Synchronizing Data',
    subMessage: 'Updating records with latest maritime information',
    showProgress: true,
    estimatedDuration: 45
  },

  vesselLoading: {
    type: 'ocean-sunset' as MaritimeLoadingType,
    message: 'Loading Vessel Data',
    subMessage: 'Fetching vessel information and crew details',
    showProgress: false,
    estimatedDuration: 10
  },

  reportGeneration: {
    type: 'port-loading' as MaritimeLoadingType,
    message: 'Generating Reports',
    subMessage: 'Compiling maritime documentation and analytics',
    showProgress: true,
    estimatedDuration: 60
  },

  cargoProcessing: {
    type: 'seagull-flight' as MaritimeLoadingType,
    message: 'Processing Data',
    subMessage: 'Loading and organizing maritime cargo information',
    showProgress: true,
    estimatedDuration: 20
  },

  SPINNER: {
    type: 'ship-wheel' as MaritimeLoadingType,
    message: '',
    subMessage: '',
    showProgress: false,
    estimatedDuration: 0
  },
}
