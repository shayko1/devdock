import { useState, useCallback, useRef, useEffect } from 'react'

interface UseGridNavigationOptions {
  itemCount: number
  enabled: boolean
  onSelect?: (index: number) => void
}

export function useGridNavigation({ itemCount, enabled, onSelect }: UseGridNavigationOptions) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const gridRef = useRef<HTMLDivElement>(null)

  // Reset focus when items change
  useEffect(() => {
    if (focusedIndex >= itemCount) {
      setFocusedIndex(itemCount > 0 ? 0 : -1)
    }
  }, [itemCount, focusedIndex])

  const getColumnsCount = useCallback((): number => {
    const grid = gridRef.current
    if (!grid || grid.children.length === 0) return 1
    const firstChild = grid.children[0] as HTMLElement
    const gridWidth = grid.clientWidth
    const cardWidth = firstChild.offsetWidth
    // Account for gap
    const style = getComputedStyle(grid)
    const gap = parseInt(style.columnGap || style.gap || '12', 10)
    return Math.max(1, Math.floor((gridWidth + gap) / (cardWidth + gap)))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!enabled || itemCount === 0) return

    const cols = getColumnsCount()
    let nextIndex = focusedIndex

    switch (e.key) {
      case 'ArrowRight':
        nextIndex = Math.min(focusedIndex + 1, itemCount - 1)
        break
      case 'ArrowLeft':
        nextIndex = Math.max(focusedIndex - 1, 0)
        break
      case 'ArrowDown':
        nextIndex = Math.min(focusedIndex + cols, itemCount - 1)
        break
      case 'ArrowUp':
        nextIndex = Math.max(focusedIndex - cols, 0)
        break
      case 'Enter':
      case ' ':
        if (focusedIndex >= 0) {
          e.preventDefault()
          onSelect?.(focusedIndex)
        }
        return
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = itemCount - 1
        break
      default:
        return
    }

    if (nextIndex !== focusedIndex) {
      e.preventDefault()
      setFocusedIndex(nextIndex)
      // Scroll the focused card into view
      const card = gridRef.current?.children[nextIndex] as HTMLElement | undefined
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [enabled, itemCount, focusedIndex, getColumnsCount, onSelect])

  const handleFocus = useCallback(() => {
    if (focusedIndex < 0 && itemCount > 0) {
      setFocusedIndex(0)
    }
  }, [focusedIndex, itemCount])

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Only reset if focus leaves the grid entirely
    if (!gridRef.current?.contains(e.relatedTarget as Node)) {
      setFocusedIndex(-1)
    }
  }, [])

  return {
    gridRef,
    focusedIndex,
    gridProps: {
      ref: gridRef,
      tabIndex: 0,
      role: 'grid' as const,
      'aria-label': 'Project cards',
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
  }
}
