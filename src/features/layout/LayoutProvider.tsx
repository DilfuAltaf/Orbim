import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  MAX_LEFT_WIDTH,
  MAX_RIGHT_WIDTH,
  MIN_LEFT_WIDTH,
  MIN_RIGHT_WIDTH,
  readStoredWidth,
  STORAGE_KEY_LEFT,
  STORAGE_KEY_RIGHT,
} from './layout-constants'
import { LayoutContext } from './layout-context'

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [leftWidth, setLeftWidth] = useState(() =>
    readStoredWidth(STORAGE_KEY_LEFT, DEFAULT_LEFT_WIDTH, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH),
  )
  const [rightWidth, setRightWidth] = useState(() =>
    readStoredWidth(STORAGE_KEY_RIGHT, DEFAULT_RIGHT_WIDTH, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH),
  )

  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)

  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 1024px)').matches
  })

  const leftWidthRef = useRef(leftWidth)
  const rightWidthRef = useRef(rightWidth)

  useEffect(() => {
    leftWidthRef.current = leftWidth
  }, [leftWidth])

  useEffect(() => {
    rightWidthRef.current = rightWidth
  }, [rightWidth])

  // Watch for desktop breakpoint (1024px)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const mql = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches)
    }

    mql.addEventListener('change', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
    }
  }, [])

  // Drag left sidebar
  const startDraggingLeft = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setIsDraggingLeft(true)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    let animationFrameId: number | null = null

    const handlePointerMove = (event: PointerEvent) => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(() => {
        const clamped = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, event.clientX))
        setLeftWidth(clamped)
      })
    }

    const handlePointerUp = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      setIsDraggingLeft(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)

      try {
        window.localStorage.setItem(STORAGE_KEY_LEFT, String(leftWidthRef.current))
      } catch {
        // Non-blocking
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [])

  // Drag right sidebar / panel
  const startDraggingRight = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setIsDraggingRight(true)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    let animationFrameId: number | null = null

    const handlePointerMove = (event: PointerEvent) => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(() => {
        const distanceFromRight = window.innerWidth - event.clientX
        const clamped = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, distanceFromRight))
        setRightWidth(clamped)
      })
    }

    const handlePointerUp = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      setIsDraggingRight(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)

      try {
        window.localStorage.setItem(STORAGE_KEY_RIGHT, String(rightWidthRef.current))
      } catch {
        // Non-blocking
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [])

  const resetLeftWidth = useCallback(() => {
    setLeftWidth(DEFAULT_LEFT_WIDTH)
    try {
      window.localStorage.setItem(STORAGE_KEY_LEFT, String(DEFAULT_LEFT_WIDTH))
    } catch {
      // Non-blocking
    }
  }, [])

  const resetRightWidth = useCallback(() => {
    setRightWidth(DEFAULT_RIGHT_WIDTH)
    try {
      window.localStorage.setItem(STORAGE_KEY_RIGHT, String(DEFAULT_RIGHT_WIDTH))
    } catch {
      // Non-blocking
    }
  }, [])

  return (
    <LayoutContext.Provider
      value={{
        leftWidth,
        rightWidth,
        isDraggingLeft,
        isDraggingRight,
        isDesktop,
        setLeftWidth,
        setRightWidth,
        startDraggingLeft,
        startDraggingRight,
        resetLeftWidth,
        resetRightWidth,
      }}
    >
      {children}
    </LayoutContext.Provider>
  )
}
