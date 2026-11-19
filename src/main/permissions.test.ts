import { describe, expect, it } from 'vitest'

import { allowsPermission, guardPermissions, type PermissionSession } from './permissions.js'

const APP = 'file:///Applications/Octopus.app/Contents/Resources/app.asar/out/renderer/index.html'
const WRITE = 'clipboard-sanitized-write'
const OTHER = 'https://attacker.example/'

type RequestHandler = (
  contents: null,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string }
) => void
type CheckHandler = (
  contents: null,
  permission: string,
  origin: string,
  details: { requestingUrl?: string }
) => boolean

function guarded(): {
  readonly request: (permission: string, requestingUrl: string) => boolean[]
  readonly check: (permission: string, details: { requestingUrl?: string }) => boolean | undefined
} {
  let onRequest: RequestHandler | undefined
  let onCheck: CheckHandler | undefined
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler) => {
      onRequest = handler
    },
    setPermissionCheckHandler: (handler: CheckHandler) => {
      onCheck = handler
    }
  } as unknown as PermissionSession
  guardPermissions(session, APP)
  return {
    request: (permission, requestingUrl) => {
      const answers: boolean[] = []
      onRequest?.(null, permission, (granted) => answers.push(granted), { requestingUrl })
      return answers
    },
    check: (permission, details) => onCheck?.(null, permission, 'file:///', details)
  }
}

describe('allowsPermission', () => {
  it('lets the application write to the clipboard', () => {
    expect(allowsPermission(WRITE, APP, APP)).toBe(true)
  })

  it('refuses the same write to another document', () => {
    expect(allowsPermission(WRITE, OTHER, APP)).toBe(false)
  })

  it.each(['media', 'notifications', 'geolocation', 'openExternal', 'clipboard-read'])(
    'refuses %s even to the application',
    (permission) => {
      expect(allowsPermission(permission, APP, APP)).toBe(false)
    }
  )

  it('refuses an address that does not parse', () => {
    expect(allowsPermission(WRITE, 'not a url', APP)).toBe(false)
  })
})

describe('guardPermissions', () => {
  it('answers a request by that rule', () => {
    const { request } = guarded()

    expect(request(WRITE, APP)).toEqual([true])
    expect(request(WRITE, OTHER)).toEqual([false])
    expect(request('media', APP)).toEqual([false])
  })

  it('answers a check by that rule, and refuses one that names no document', () => {
    const { check } = guarded()

    expect(check(WRITE, { requestingUrl: APP })).toBe(true)
    expect(check(WRITE, { requestingUrl: OTHER })).toBe(false)
    expect(check(WRITE, {})).toBe(false)
  })
})
