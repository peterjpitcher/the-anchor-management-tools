'use client'

/**
 * Stepper Component
 * 
 * Step-by-step navigation for multi-step forms and processes.
 * Supports linear/non-linear flow, validation, and various layouts.
 */

import { ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { CheckIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { Button } from '../forms/Button'

export interface StepItem {
  key: string
  title: string
  description?: string
  content?: ReactNode
  icon?: ReactNode
  status?: 'pending' | 'active' | 'complete' | 'error'
  disabled?: boolean
  optional?: boolean
}

export interface StepperProps {
  /**
   * Step items
   */
  steps: StepItem[]
  
  /**
   * Current step index (controlled mode)
   */
  current?: number
  
  /**
   * Default step index (uncontrolled mode)
   * @default 0
   */
  defaultCurrent?: number
  
  /**
   * Callback when step changes
   */
  onChange?: (step: number) => void
  
  /**
   * Layout direction
   * @default 'horizontal'
   */
  direction?: 'horizontal' | 'vertical'
  
  /**
   * Step type
   * @default 'default'
   */
  type?: 'default' | 'navigation' | 'dot' | 'simple'
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether steps are clickable
   * @default true
   */
  clickable?: boolean
  
  /**
   * Whether to show step numbers
   * @default true
   */
  showNumber?: boolean
  
  /**
   * Whether to show progress bar (horizontal only)
   * @default true
   */
  showProgress?: boolean
  
  /**
   * Label placement (vertical only)
   * @default 'right'
   */
  labelPlacement?: 'right' | 'bottom'
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Additional step classes
   */
  stepClassName?: string
  
  /**
   * Custom step renderer
   */
  renderStep?: (step: StepItem, index: number, status: string) => ReactNode
  
  /**
   * Whether to render content
   * @default true
   */
  renderContent?: boolean
  
  /**
   * Navigation component
   */
  navigation?: ReactNode
  
  /**
   * Callback before step change (for validation)
   */
  onBeforeChange?: (from: number, to: number) => boolean | Promise<boolean>
}

export function Stepper({
  steps,
  current: controlledCurrent,
  defaultCurrent = 0,
  onChange,
  direction = 'horizontal',
  type = 'default',
  size = 'md',
  clickable = true,
  showNumber = true,
  showProgress = true,
  labelPlacement = 'right',
  className,
  stepClassName,
  renderStep,
  renderContent = true,
  navigation,
  onBeforeChange,
}: StepperProps) {
  const [uncontrolledCurrent, setUncontrolledCurrent] = useState(defaultCurrent)
  const current = controlledCurrent ?? uncontrolledCurrent
  
  // Handle step change
  const handleStepChange = async (stepIndex: number) => {
    if (!clickable || stepIndex === current) return
    
    // Validate before change
    if (onBeforeChange) {
      const canChange = await onBeforeChange(current, stepIndex)
      if (!canChange) return
    }
    
    setUncontrolledCurrent(stepIndex)
    onChange?.(stepIndex)
  }
  
  // Get step status
  const getStepStatus = (step: StepItem, index: number): string => {
    if (step.status) return step.status
    if (index === current) return 'active'
    if (index < current) return 'complete'
    return 'pending'
  }
  
  // Size classes
  const sizeClasses = {
    sm: {
      container: 'text-sm',
      icon: 'h-6 w-6',
      dot: 'h-2 w-2',
      number: 'text-xs',
    },
    md: {
      container: 'text-base',
      icon: 'h-8 w-8',
      dot: 'h-3 w-3',
      number: 'text-sm',
    },
    lg: {
      container: 'text-lg',
      icon: 'h-10 w-10',
      dot: 'h-4 w-4',
      number: 'text-base',
    },
  }
  
  const currentSize = sizeClasses[size]
  
  // Render step icon/number
  const renderStepIcon = (step: StepItem, index: number, status: string) => {
    if (type === 'dot') {
      return (
        <div className={cn(
          'rounded-full transition-colors',
          currentSize.dot,
          status === 'complete' && 'bg-green-600',
          status === 'active' && 'bg-green-600',
          status === 'error' && 'bg-red-600',
          status === 'pending' && 'bg-gray-300'
        )} />
      )
    }
    
    const iconClasses = cn(
      'rounded-full flex items-center justify-center transition-colors',
      currentSize.icon,
      status === 'complete' && 'bg-green-600 text-white',
      status === 'active' && 'bg-green-600 text-white',
      status === 'error' && 'bg-red-600 text-white',
      status === 'pending' && 'bg-gray-200 text-gray-600'
    )
    
    if (step.icon) {
      return <div className={iconClasses}>{step.icon}</div>
    }
    
    if (status === 'complete') {
      return (
        <div className={iconClasses}>
          <CheckIcon className="h-2/3 w-2/3" />
        </div>
      )
    }
    
    if (status === 'error') {
      return (
        <div className={iconClasses}>
          <XMarkIcon className="h-2/3 w-2/3" />
        </div>
      )
    }
    
    if (showNumber) {
      return (
        <div className={iconClasses}>
          <span className={currentSize.number}>{index + 1}</span>
        </div>
      )
    }
    
    return <div className={iconClasses} />
  }
  
  // Render connector line
  const renderConnector = (status: string, nextStatus: string) => {
    const isComplete = status === 'complete' && nextStatus !== 'pending'
    
    return (
      <div
        className={cn(
          'flex-1 transition-colors',
          direction === 'horizontal'
            ? 'h-0.5 min-w-[2rem]'
            : 'w-0.5 min-h-[2rem]',
          isComplete ? 'bg-green-600' : 'bg-gray-200'
        )}
      />
    )
  }
  
  // Render steps
  const renderSteps = () => {
    return steps.map((step, index) => {
      const status = getStepStatus(step, index)
      const isClickable = clickable && !step.disabled && type !== 'simple'
      
      if (renderStep) {
        return renderStep(step, index, status)
      }
      
      const stepContent = (
        <>
          {renderStepIcon(step, index, status)}
          
          {type !== 'dot' && (
            <div className={cn(
              direction === 'horizontal' && labelPlacement === 'bottom' && 'mt-2',
              direction === 'vertical' && labelPlacement === 'right' && 'ml-3',
              direction === 'vertical' && labelPlacement === 'bottom' && 'mt-2'
            )}>
              <div className={cn(
                'font-medium',
                status === 'active' && 'text-gray-900',
                status === 'complete' && 'text-gray-900',
                status === 'pending' && 'text-gray-500',
                status === 'error' && 'text-red-600'
              )}>
                {step.title}
                {step.optional && (
                  <span className="text-gray-400 text-sm ml-1">(Optional)</span>
                )}
              </div>
              {step.description && (
                <div className="text-sm text-gray-500 mt-0.5">
                  {step.description}
                </div>
              )}
            </div>
          )}
        </>
      )
      
      return (
        <div
          key={step.key}
          className={cn(
            'flex items-center',
            direction === 'horizontal' && 'flex-col',
            direction === 'vertical' && labelPlacement === 'bottom' && 'flex-col',
            index < steps.length - 1 && direction === 'horizontal' && 'flex-1'
          )}
        >
          <div
            onClick={() => isClickable && handleStepChange(index)}
            className={cn(
              'flex items-center',
              direction === 'vertical' && labelPlacement === 'right' && 'flex-1',
              isClickable && 'cursor-pointer',
              stepClassName
            )}
          >
            {stepContent}
          </div>
          
          {index < steps.length - 1 && (
            <div className={cn(
              'flex items-center',
              direction === 'horizontal' ? 'flex-1 px-2' : 'py-2'
            )}>
              {renderConnector(status, getStepStatus(steps[index + 1], index + 1))}
            </div>
          )}
        </div>
      )
    })
  }
  
  // Render simple type
  const renderSimpleSteps = () => {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <span className="font-medium text-gray-900">
          Step {current + 1}
        </span>
        <span>of {steps.length}:</span>
        <span className="font-medium text-gray-900">
          {steps[current]?.title}
        </span>
      </div>
    )
  }
  
  return (
    <div className={cn(currentSize.container, className)}>
      {/* Steps */}
      <div
        className={cn(
          'flex',
          direction === 'horizontal' ? 'items-start' : 'flex-col',
          type === 'simple' && 'justify-center'
        )}
      >
        {type === 'simple' ? renderSimpleSteps() : renderSteps()}
      </div>
      
      {/* Progress bar (horizontal only) */}
      {showProgress && direction === 'horizontal' && type !== 'simple' && type !== 'dot' && (
        <div className="mt-4 bg-gray-200 rounded-full h-1">
          <div
            className="bg-green-600 h-1 rounded-full transition-all duration-300"
            style={{
              width: `${((current + 1) / steps.length) * 100}%`
            }}
          />
        </div>
      )}
      
      {/* Content */}
      {renderContent && steps[current]?.content && (
        <div className="mt-6">
          {steps[current].content}
        </div>
      )}
      
      {/* Navigation */}
      {navigation && (
        <div className="mt-6">
          {navigation}
        </div>
      )}
    </div>
  )
}

/**
 * StepperNavigation - Navigation buttons for stepper
 */
export function StepperNavigation({
  current,
  total,
  onPrevious,
  onNext,
  onFinish,
  previousText = 'Previous',
  nextText = 'Next',
  finishText = 'Finish',
  loading = false,
  canGoNext = true,
  canGoPrevious = true,
  className,
}: {
  current: number
  total: number
  onPrevious?: () => void
  onNext?: () => void
  onFinish?: () => void
  previousText?: string
  nextText?: string
  finishText?: string
  loading?: boolean
  canGoNext?: boolean
  canGoPrevious?: boolean
  className?: string
}) {
  const isFirst = current === 0
  const isLast = current === total - 1
  
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <Button
        variant="secondary"
        onClick={onPrevious}
        disabled={isFirst || !canGoPrevious || loading}
      >
        {previousText}
      </Button>
      
      <span className="text-sm text-gray-600">
        {current + 1} / {total}
      </span>
      
      <Button
        variant="primary"
        onClick={isLast ? onFinish : onNext}
        disabled={!canGoNext || loading}
        loading={loading}
      >
        {isLast ? finishText : nextText}
      </Button>
    </div>
  )
}

/**
 * useStepper - Hook for managing stepper state
 */
export function useStepper(steps: number, defaultStep = 0) {
  const [currentStep, setCurrentStep] = useState(defaultStep)
  
  const goToStep = (step: number) => {
    if (step >= 0 && step < steps) {
      setCurrentStep(step)
    }
  }
  
  const nextStep = () => {
    if (currentStep < steps - 1) {
      setCurrentStep(currentStep + 1)
    }
  }
  
  const previousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }
  
  const reset = () => {
    setCurrentStep(0)
  }
  
  return {
    currentStep,
    setCurrentStep,
    goToStep,
    nextStep,
    previousStep,
    reset,
    isFirst: currentStep === 0,
    isLast: currentStep === steps - 1,
    progress: ((currentStep + 1) / steps) * 100,
  }
}