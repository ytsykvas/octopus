/**
 * Which icon a file or folder gets, by the rules VS Code applies to the same
 * manifest — so a tree here looks like the one the user already reads.
 */

import type { TreeEntryKind } from '@core/fileTree.js'

import { languageFor } from '../diff/language.js'
import { type IconManifest, loadIconManifest } from './iconManifest.js'

/**
 * The icon for each theme — as names while the rules decide, as URLs once
 * resolved. `light` is null when the theme draws the same icon on both
 * grounds, which is nearly always.
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
function lookUp(
  tables: Pick<
    IconManifest,
    'fileNames' | 'fileExtensions' | 'languageIds' | 'folderNames' | 'folderNamesExpanded'
  >,
  subject: IconSubject
): string | undefined {
  const name = subject.name.toLowerCase()

  if (subject.kind === 'directory') {
    return (subject.expanded ? tables.folderNamesExpanded : tables.folderNames)[name]
  }

  const named = tables.fileNames[name]
  if (named !== undefined) return named

  for (const extension of extensionsOf(name)) {
    const found = tables.fileExtensions[extension]
    if (found !== undefined) return found
  }

  const language = languageFor(subject.path)
  return language === null ? undefined : tables.languageIds[language]
}

/**
 * The icon names for a subject.
 *
 * The manifest's own tables are the dark ones; its `light` block overrides a
 * few for a light ground, where a white glyph would vanish.
 */
export function iconNamesFor(manifest: IconManifest, subject: IconSubject): IconPair {
  const fallback =
    subject.kind === 'file'
      ? manifest.file
      : subject.expanded
        ? manifest.folderExpanded
        : manifest.folder

  return {
    dark: lookUp(manifest, subject) ?? fallback,
    light: lookUp(manifest.light, subject) ?? null
  }
}

/** The file part of a path, which is what the URL table is keyed by. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export type IconResolver = (subject: IconSubject) => IconPair | null

/**
 * Turns names into URLs.
 *
 * Null when the manifest names an icon the package did not ship — a version
 * mismatch, never expected, answered by the plain icon rather than a broken
 * image.
 */
export function makeResolver(
  manifest: IconManifest,
  urls: Readonly<Record<string, string>>
): IconResolver {
  const byFile = new Map(Object.entries(urls).map(([path, url]) => [fileName(path), url]))
  const urlOf = (icon: string): string | undefined => {
    const definition = manifest.iconDefinitions[icon]
    return definition === undefined ? undefined : byFile.get(fileName(definition.iconPath))
  }

  return (subject) => {
    const names = iconNamesFor(manifest, subject)
    const dark = urlOf(names.dark)
    if (dark === undefined) return null
    return { dark, light: names.light === null ? null : (urlOf(names.light) ?? null) }
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
    const [manifest, { ICON_URLS }] = await Promise.all([
      loadIconManifest(),
      import('./iconUrls.js')
    ])
    loaded = makeResolver(manifest, ICON_URLS)
    return loaded
  })()

  return loading
}
