/**
 * Which grammar a path is highlighted with, or null for none.
 *
 * A deliberate map rather than a guess: an unknown extension is drawn plain,
 * which is honest, whereas guessing a grammar colours a file as a language it
 * is not and there is nothing on screen to say so.
 *
 * Pure and free of shiki, so what a path means can be tested without loading a
 * highlighter.
 */

import type { Language } from './grammars.js'

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  swift: 'swift',
  kt: 'kotlin',
  java: 'java',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp'
}

/** Files whose name is the whole answer, since they carry no extension. */
const BY_NAME: Readonly<Record<string, Language>> = {
  Dockerfile: 'docker',
  Makefile: 'make',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini'
}

export function languageFor(path: string): Language | null {
  const name = path.slice(path.lastIndexOf('/') + 1)

  const byName = BY_NAME[name]
  if (byName) return byName

  const dot = name.lastIndexOf('.')
  // A leading dot is the start of the name, not an extension: `.env` is a whole
  // filename and `env` is not what it is written in.
  if (dot <= 0) return null

  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null
}
