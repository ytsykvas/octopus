import { describe, expect, it } from 'vitest'

import {
  type IconSubject,
  iconNamesFor,
  loadedIconResolver,
  loadIconResolver,
  makeResolver
} from './fileIcons.js'
import type { IconManifest } from './iconManifest.js'

const MANIFEST: IconManifest = {
  iconDefinitions: {
    file: { iconPath: './../icons/file.svg' },
    folder: { iconPath: './../icons/folder.svg' },
    'folder-open': { iconPath: './../icons/folder-open.svg' },
    'folder-src': { iconPath: './../icons/folder-src.svg' },
    'folder-src-open': { iconPath: './../icons/folder-src-open.svg' },
    nodejs: { iconPath: './../icons/nodejs.svg' },
    typescript: { iconPath: './../icons/typescript.svg' },
    'test-ts': { iconPath: './../icons/test-ts.svg' },
    python: { iconPath: './../icons/python.svg' },
    toml: { iconPath: './../icons/toml.svg' },
    toml_light: { iconPath: './../icons/toml_light.svg' },
    unshipped: { iconPath: './../icons/unshipped.svg' }
  },
  fileNames: { 'package.json': 'nodejs', 'ghost.txt': 'unshipped', 'nameless.txt': 'undefined' },
  fileExtensions: { ts: 'typescript', 'test.ts': 'test-ts', toml: 'toml', odd: 'unshipped' },
  languageIds: { python: 'python' },
  folderNames: { src: 'folder-src' },
  folderNamesExpanded: { src: 'folder-src-open' },
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  light: {
    fileNames: {},
    fileExtensions: { toml: 'toml_light', odd: 'unshipped' },
    languageIds: {},
    folderNames: {},
    folderNamesExpanded: {}
  }
}

const file = (path: string): IconSubject => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'file',
  expanded: false
})

const folder = (name: string, expanded = false): IconSubject => ({
  name,
  path: name,
  kind: 'directory',
  expanded
})

describe('iconNamesFor', () => {
  it('prefers the whole name, ignoring case', () => {
    expect(iconNamesFor(MANIFEST, file('Package.JSON')).dark).toBe('nodejs')
  })

  // The longer extension is what tells a test file from any other.
  it('tries the longest extension first', () => {
    expect(iconNamesFor(MANIFEST, file('src/a.test.ts')).dark).toBe('test-ts')
    expect(iconNamesFor(MANIFEST, file('src/a.ts')).dark).toBe('typescript')
  })

  it('falls back to the language the file would be highlighted as', () => {
    // `pyw` is not in the extension table; `py` would be, but this checks the
    // language path — `languageFor` maps `.py` to `python`.
    expect(iconNamesFor({ ...MANIFEST, fileExtensions: {} }, file('tool.py')).dark).toBe('python')
  })

  it('falls back to the plain file icon, and treats a leading dot as part of the name', () => {
    expect(iconNamesFor(MANIFEST, file('.ts')).dark).toBe('file')
    expect(iconNamesFor(MANIFEST, file('notes.unknown')).dark).toBe('file')
    expect(iconNamesFor(MANIFEST, file('Makefile')).dark).toBe('file')
  })

  it('picks a folder icon by name, open or closed, with the plain ones behind it', () => {
    expect(iconNamesFor(MANIFEST, folder('src')).dark).toBe('folder-src')
    expect(iconNamesFor(MANIFEST, folder('SRC', true)).dark).toBe('folder-src-open')
    expect(iconNamesFor(MANIFEST, folder('misc')).dark).toBe('folder')
    expect(iconNamesFor(MANIFEST, folder('misc', true)).dark).toBe('folder-open')
  })

  it('names a light variant only where the theme has one', () => {
    expect(iconNamesFor(MANIFEST, file('Cargo.toml'))).toEqual({
      dark: 'toml',
      light: 'toml_light'
    })
    expect(iconNamesFor(MANIFEST, file('a.ts')).light).toBeNull()
  })
})

describe('makeResolver', () => {
  const urls = {
    '../node_modules/material-icon-theme/icons/file.svg': '/assets/file.svg',
    '../node_modules/material-icon-theme/icons/typescript.svg': '/assets/typescript.svg',
    '../node_modules/material-icon-theme/icons/toml.svg': '/assets/toml.svg',
    '../node_modules/material-icon-theme/icons/toml_light.svg': '/assets/toml_light.svg'
  }
  const resolve = makeResolver(MANIFEST, urls)

  it('turns the names into the URLs the build gave them', () => {
    expect(resolve(file('a.ts'))).toEqual({ dark: '/assets/typescript.svg', light: null })
    expect(resolve(file('Cargo.toml'))).toEqual({
      dark: '/assets/toml.svg',
      light: '/assets/toml_light.svg'
    })
  })

  // A manifest from a newer version naming an icon this package lacks.
  it('answers null for an icon that was never shipped, so the plain one is drawn', () => {
    expect(resolve(file('ghost.txt'))).toBeNull()
    expect(resolve(file('nameless.txt'))).toBeNull()
    expect(resolve(folder('src'))).toBeNull()
  })

  it('drops a light variant that was never shipped, keeping the dark one', () => {
    expect(resolve(file('a.odd'))).toBeNull()
    expect(
      makeResolver({ ...MANIFEST, fileExtensions: { odd: 'typescript' } }, urls)(file('a.odd'))
    ).toEqual({ dark: '/assets/typescript.svg', light: null })
  })
})

describe('loadIconResolver', () => {
  // The real package: the manifest parses and the build's URL table holds the
  // icons it names.
  it('loads the installed theme once and resolves real names', async () => {
    expect(loadedIconResolver()).toBeNull()
    const [resolve, again] = await Promise.all([loadIconResolver(), loadIconResolver()])

    expect(loadedIconResolver()).toBe(resolve)
    expect(again).toBe(resolve)
    expect(resolve(file('src/main.ts'))?.dark).toMatch(/typescript\.svg/)
    expect(resolve(folder('src'))?.dark).toMatch(/folder-src\.svg/)
  })
})
