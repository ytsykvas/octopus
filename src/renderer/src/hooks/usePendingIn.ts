import { useState } from 'react'

export interface PendingIn<A extends string> {
  readonly isPending: (workspaceId: string, action: A) => boolean
  readonly start: (workspaceId: string, action: A) => void
  readonly finish: (workspaceId: string, action: A) => void
}

const keyOf = (workspaceId: string, action: string): string => `${workspaceId}\u0000${action}`

export function usePendingIn<A extends string>(): PendingIn<A> {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())

  return {
    isPending: (workspaceId, action) => pending.has(keyOf(workspaceId, action)),
    start: (workspaceId, action) => {
      setPending((current) => new Set(current).add(keyOf(workspaceId, action)))
    },
    finish: (workspaceId, action) => {
      setPending((current) => {
        const next = new Set(current)
        next.delete(keyOf(workspaceId, action))
        return next
      })
    }
  }
}
