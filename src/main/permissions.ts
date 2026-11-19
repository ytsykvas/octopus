import type { Session } from 'electron'

import { isAppDocument } from '../core/appNavigation.js'

// Anything not listed is refused; a feature that needs a permission adds it here.
const GRANTED: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

export type PermissionSession = Pick<
  Session,
  'setPermissionRequestHandler' | 'setPermissionCheckHandler'
>

export function allowsPermission(
  permission: string,
  requestingUrl: string,
  appUrl: string
): boolean {
  return GRANTED.has(permission) && isAppDocument(requestingUrl, appUrl)
}

export function guardPermissions(session: PermissionSession, appUrl: string): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowsPermission(permission, details.requestingUrl, appUrl))
  })
  // `_origin` is only `file:///` for the app; the details carry the document.
  session.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    allowsPermission(permission, details.requestingUrl ?? '', appUrl)
  )
}
