import { useRef, useState } from 'react'

/**
 * One submission at a time. The lock is taken before validation starts (a mutation's pending
 * state arrives one render later, so a double click or repeated Enter would slip through) and
 * is kept after `succeed()`, so a closing modal cannot send again during its exit animation.
 * `reset()` reopens it for components that outlive the submission (e.g. a reopened modal).
 */
export function useSingleSubmission() {
  const locked = useRef(false)
  const succeeded = useRef(false)
  const [submitted, setSubmitted] = useState(false)
  return {
    submitted,
    run: async (attempt: () => Promise<unknown>) => {
      if (locked.current) return
      locked.current = true
      try {
        await attempt()
      } finally {
        if (!succeeded.current) locked.current = false
      }
    },
    succeed: () => {
      succeeded.current = true
      setSubmitted(true)
    },
    reset: () => {
      locked.current = false
      succeeded.current = false
      setSubmitted(false)
    },
  }
}
