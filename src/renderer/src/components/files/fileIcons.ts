/**
 * Which icon a file or folder gets, by the rules VS Code applies to the same
 * manifest — so a tree here looks like the one the user already reads.
 */

import type { TreeEntryKind } from '@core/fileTree.js'

import { languageFor } from '../diff/language.js'
import { type IconManifest, loadIconManifest } from './iconManifest.js'

/**
 * The icon for each of the app's themes, as URLs. `light` is null when the
 * light flavour lacks the picture the dark one has — never in a release seen
 * so far, and then the dark one is drawn on both grounds.
 */
export interface IconPair {
  readonly dark: string
  readonly light: string | null
}

export interface IconSubject {
  readonly name: string
  readonly path: string
  readonly kind: TreeEntryKind
  readonly expanded: boolean
}

/**
 * Every extension a name could be said to have, longest first.
 *
 * `component.test.tsx` has three — `test.tsx`, then `tsx` — and the manifest
 * keys some icons on the longer ones, which is how a test file gets a test
 * icon rather than a React one. A leading dot is not an extension: `.env` is a
 * name.
 */
function extensionsOf(name: string): string[] {
  const found: string[] = []
  for (let dot = name.indexOf('.', 1); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    found.push(name.slice(dot + 1))
  }
  return found
}

/**
 * Looks a subject up in one table set, or answers undefined.
 *
 * VS Code's order: the whole name, then each extension from the longest, then
 * the language the editor would open the file in. The language is our own
 * guess from `languageFor`, whose names match VS Code's ids for most
 * languages; where they differ the extension tables have already answered.
 */
function lookUp(manifest: IconManifest, subject: IconSubject): string | undefined {
  const name = subject.name.toLowerCase()

  if (subject.kind === 'directory') {
    return (subject.expanded ? manifest.folderNamesExpanded : manifest.folderNames)[name]
  }

  const named = manifest.fileNames[name]
  if (named !== undefined) return named

  for (const extension of extensionsOf(name)) {
    const found = manifest.fileExtensions[extension]
    if (found !== undefined) return found
  }

  const language = languageFor(subject.path)
  return language === null ? undefined : manifest.languageIds[language]
}

/** The icon's name for a subject, with the theme's plain ones behind the rules. */
export function iconNameFor(manifest: IconManifest, subject: IconSubject): string {
  const fallback =
    subject.kind === 'file'
      ? manifest.file
      : subject.expanded
        ? manifest.folderExpanded
        : manifest.folder

  return lookUp(manifest, subject) ?? fallback
}

/** The file part of a path, which is what the URL table is keyed by. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export type IconResolver = (subject: IconSubject) => IconPair | null

/** The URL table keyed by file name, which is how the manifest names a picture. */
function byFileName(urls: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(urls).map(([path, url]) => [fileName(path), url]))
}

/**
 * Turns a subject into the URLs of its picture in each flavour.
 *
 * One name for both: the flavours share one table and differ only in the
 * colours inside the pictures. Null when the manifest names an icon the dark
 * flavour did not ship — a version mismatch, never expected, answered by the
 * plain icon rather than a broken image.
 */
export function makeResolver(
  manifest: IconManifest,
  urls: {
    readonly light: Readonly<Record<string, string>>
    readonly dark: Readonly<Record<string, string>>
  }
): IconResolver {
  const light = byFileName(urls.light)
  const dark = byFileName(urls.dark)

  return (subject) => {
    const definition = manifest.iconDefinitions[iconNameFor(manifest, subject)]
    if (definition === undefined) return null
    const picture = fileName(definition.iconPath)
    const darkUrl = dark.get(picture)
    if (darkUrl === undefined) return null
    return { dark: darkUrl, light: light.get(picture) ?? null }
  }
}

/*
 * One load for the window's life, shared by every icon that asks — a tree of
 * a few hundred rows would otherwise read the manifest a few hundred times.
 */
let loading: Promise<IconResolver> | null = null

/** The resolver once loaded, for a row mounted later to draw at once. */
let loaded: IconResolver | null = null

/**
 * The resolver if it has loaded, without waiting.
 *
 * The tree is virtualised, so rows mount as it scrolls; one that started from
 * nothing every time would show its plain icon for a frame on every scroll.
 */
export function loadedIconResolver(): IconResolver | null {
  return loaded
}

/**
 * The resolver, loaded the first time anything asks for it.
 *
 * A failure is kept like a success: the files are part of the build, so one
 * that would not load will not load on the next row either, and the tree
 * simply stays on its plain icons.
 */
export async function loadIconResolver(): Promise<IconResolver> {
  loading ??= (async () => {
    const [manifest, { LIGHT_ICON_URLS, DARK_ICON_URLS }] = await Promise.all([
      loadIconManifest(),
      import('./iconUrls.js')
    ])
    loaded = makeResolver(manifest, { light: LIGHT_ICON_URLS, dark: DARK_ICON_URLS })
    return loaded
  })()

  return loading
}
