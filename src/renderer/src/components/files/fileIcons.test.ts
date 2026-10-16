import { describe, expect, it } from 'vitest'

import {
  type IconSubject,
  iconNameFor,
  loadedIconResolver,
  loadIconResolver,
  makeResolver
} from './fileIcons.js'
import type { IconManifest } from './iconManifest.js'

const MANIFEST: IconManifest = {
  iconDefinitions: {
    _file: { iconPath: './icons/_file.svg' },
    _folder: { iconPath: './icons/_folder.svg' },
    _folder_open: { iconPath: './icons/_folder_open.svg' },
    folder_src: { iconPath: './icons/folder_src.svg' },
    folder_src_open: { iconPath: './icons/folder_src_open.svg' },
    'package-json': { iconPath: './icons/package-json.svg' },
    typescript: { iconPath: './icons/typescript.svg' },
    'typescript-test': { iconPath: './icons/typescript-test.svg' },
    python: { iconPath: './icons/python.svg' },
    toml: { iconPath: './icons/toml.svg' },
    unshipped: { iconPath: './icons/unshipped.svg' }
  },
  fileNames: {
    'package.json': 'package-json',
    'ghost.txt': 'unshipped',
    'nameless.txt': 'undefined'
  },
  fileExtensions: { ts: 'typescript', 'test.ts': 'typescript-test', toml: 'toml' },
  languageIds: { python: 'python' },
  folderNames: { src: 'folder_src' },
  folderNamesExpanded: { src: 'folder_src_open' },
  file: '_file',
  folder: '_folder',
  folderExpanded: '_folder_open'
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

describe('iconNameFor', () => {
  it('prefers the whole name, ignoring case', () => {
    expect(iconNameFor(MANIFEST, file('Package.JSON'))).toBe('package-json')
  })

  // The longer extension is what tells a test file from any other.
  it('tries the longest extension first', () => {
    expect(iconNameFor(MANIFEST, file('src/a.test.ts'))).toBe('typescript-test')
    expect(iconNameFor(MANIFEST, file('src/a.ts'))).toBe('typescript')
  })

  it('falls back to the language the file would be highlighted as', () => {
    // With no extension table, only the language can name it — `languageFor`
    // maps `.py` to `python`.
    expect(iconNameFor({ ...MANIFEST, fileExtensions: {} }, file('tool.py'))).toBe('python')
  })

  it('falls back to the plain file icon, and treats a leading dot as part of the name', () => {
    expect(iconNameFor(MANIFEST, file('.ts'))).toBe('_file')
    expect(iconNameFor(MANIFEST, file('notes.unknown'))).toBe('_file')
    expect(iconNameFor(MANIFEST, file('Makefile'))).toBe('_file')
  })

  it('picks a folder icon by name, open or closed, with the plain ones behind it', () => {
    expect(iconNameFor(MANIFEST, folder('src'))).toBe('folder_src')
    expect(iconNameFor(MANIFEST, folder('SRC', true))).toBe('folder_src_open')
    expect(iconNameFor(MANIFEST, folder('misc'))).toBe('_folder')
    expect(iconNameFor(MANIFEST, folder('misc', true))).toBe('_folder_open')
  })
})

describe('makeResolver', () => {
  const urls = {
    light: {
      '../vendor/catppuccin-icons/latte/_file.svg': '/assets/latte/_file.svg',
      '../vendor/catppuccin-icons/latte/typescript.svg': '/assets/latte/typescript.svg'
    },
    dark: {
      '../vendor/catppuccin-icons/mocha/_file.svg': '/assets/mocha/_file.svg',
      '../vendor/catppuccin-icons/mocha/typescript.svg': '/assets/mocha/typescript.svg',
      '../vendor/catppuccin-icons/mocha/toml.svg': '/assets/mocha/toml.svg'
    }
  }
  const resolve = makeResolver(MANIFEST, urls)

  // One name, two pictures: the flavours differ only in their colours.
  it('gives each flavour its own picture of the same icon', () => {
    expect(resolve(file('a.ts'))).toEqual({
      dark: '/assets/mocha/typescript.svg',
      light: '/assets/latte/typescript.svg'
    })
    expect(resolve(file('README'))).toEqual({
      dark: '/assets/mocha/_file.svg',
      light: '/assets/latte/_file.svg'
    })
  })

  // A manifest from a newer version naming an icon this copy lacks.
  it('answers null for an icon that was never shipped, so the plain one is drawn', () => {
    expect(resolve(file('ghost.txt'))).toBeNull()
    expect(resolve(file('nameless.txt'))).toBeNull()
    expect(resolve(folder('src'))).toBeNull()
  })

  it('draws the dark picture on both grounds when the light flavour lacks it', () => {
    expect(resolve(file('Cargo.toml'))).toEqual({ dark: '/assets/mocha/toml.svg', light: null })
  })
})

describe('loadIconResolver', () => {
  // The real copy in vendor/: the manifest parses and the build's URL tables
  // hold the icons it names, in both flavours.
  it('loads the theme once and resolves real names', async () => {
    expect(loadedIconResolver()).toBeNull()
    const [resolve, again] = await Promise.all([loadIconResolver(), loadIconResolver()])

    expect(loadedIconResolver()).toBe(resolve)
    expect(again).toBe(resolve)
    expect(resolve(file('src/main.ts'))).toEqual({
      dark: expect.stringMatching(/mocha\/typescript\.svg\b/) as string,
      light: expect.stringMatching(/latte\/typescript\.svg\b/) as string
    })
    expect(resolve(folder('src'))?.dark).toMatch(/mocha\/folder_src\.svg\b/)
  })
})
