'use client'

import { useEffect, useRef, useState } from 'react'

/** Observe the element that clips the text, including changes in available width. */
export function useTextTruncation<T extends HTMLElement>(text: string | null | undefined) {
  const ref = useRef<T>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  return { ref, truncated }
}
