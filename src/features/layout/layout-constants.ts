export const DEFAULT_LEFT_WIDTH = 256
export const MIN_LEFT_WIDTH = 180
export const MAX_LEFT_WIDTH = 420

export const DEFAULT_RIGHT_WIDTH = 352
export const MIN_RIGHT_WIDTH = 260
export const MAX_RIGHT_WIDTH = 540

export const STORAGE_KEY_LEFT = 'orbim_sidebar_left_width'
export const STORAGE_KEY_RIGHT = 'orbim_sidebar_right_width'

export function readStoredWidth(key: string, defaultWidth: number, min: number, max: number): number {
  if (typeof window === 'undefined') return defaultWidth
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaultWidth
    const parsed = parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      return parsed
    }
  } catch {
    // Ignore storage errors
  }
  return defaultWidth
}

export interface LayoutContextValue {
  leftWidth: number
  rightWidth: number
  isDraggingLeft: boolean
  isDraggingRight: boolean
  isDesktop: boolean
  setLeftWidth: (width: number | ((prev: number) => number)) => void
  setRightWidth: (width: number | ((prev: number) => number)) => void
  startDraggingLeft: (e: React.PointerEvent) => void
  startDraggingRight: (e: React.PointerEvent) => void
  resetLeftWidth: () => void
  resetRightWidth: () => void
}
