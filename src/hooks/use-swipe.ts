import { useEffect, useRef } from 'react'

interface SwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  threshold?: number
  preventDefault?: boolean
}

export function useSwipe(
  elementRef: React.RefObject<HTMLElement>,
  options: SwipeOptions
) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    preventDefault = false
  } = options

  const touchStart = useRef({ x: 0, y: 0 })
  const touchEnd = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const handleTouchStart = (e: TouchEvent) => {
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      }
      touchEnd.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      touchEnd.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      }
      
      if (preventDefault) {
        e.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      const deltaX = touchEnd.current.x - touchStart.current.x
      const deltaY = touchEnd.current.y - touchStart.current.y
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      // Determine if it's a horizontal or vertical swipe
      if (Math.max(absX, absY) < threshold) {
        return // Not a swipe
      }

      if (absX > absY) {
        // Horizontal swipe
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight()
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft()
        }
      } else {
        // Vertical swipe
        if (deltaY > 0 && onSwipeDown) {
          onSwipeDown()
        } else if (deltaY < 0 && onSwipeUp) {
          onSwipeUp()
        }
      }
    }

    element.addEventListener('touchstart', handleTouchStart, { passive: !preventDefault })
    element.addEventListener('touchmove', handleTouchMove, { passive: !preventDefault })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
    }
  }, [elementRef, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, preventDefault])
}

// Swipeable item hook for list items
interface SwipeToActionOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  threshold?: number
  rubberBandEffect?: boolean
}

export function useSwipeToAction(
  elementRef: React.RefObject<HTMLElement>,
  options: SwipeToActionOptions
) {
  const {
    onSwipeLeft,
    onSwipeRight,
    threshold = 75,
    rubberBandEffect = true
  } = options

  const startX = useRef(0)
  const currentX = useRef(0)
  const isDragging = useRef(false)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const handleTouchStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX
      currentX.current = e.touches[0].clientX
      isDragging.current = true
      
      if (rubberBandEffect) {
        element.style.transition = 'none'
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return
      
      currentX.current = e.touches[0].clientX
      const deltaX = currentX.current - startX.current
      
      if (rubberBandEffect) {
        // Apply rubber band effect
        const resistance = 0.3
        const resistedDelta = deltaX * resistance
        element.style.transform = `translateX(${resistedDelta}px)`
      }
    }

    const handleTouchEnd = () => {
      if (!isDragging.current) return
      
      isDragging.current = false
      const deltaX = currentX.current - startX.current
      
      if (rubberBandEffect) {
        element.style.transition = 'transform 0.2s ease-out'
        element.style.transform = 'translateX(0)'
      }
      
      if (Math.abs(deltaX) >= threshold) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight()
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft()
        }
      }
    }

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: true })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
    }
  }, [elementRef, onSwipeLeft, onSwipeRight, threshold, rubberBandEffect])
}