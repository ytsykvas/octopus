import { describe, expect, it } from 'vitest'

import {
  boardFolderName,
  cardFileName,
  cardWorkspaceName,
  compareNames,
  isSkipped,
  machineLabel,
  nameKey,
  safeStem,
  sameName,
  statusOfFolder,
  stemOf
} from './boardNames.js'

describe('statusOfFolder', () => {
  it.each([
    ['backlog', 'backlog'],
    ['Backlog', 'backlog'],
    ['In Progress', 'in progress'],
    ['in-progress', 'in progress'],
    ['IN_PROGRESS', 'in progress'],
    ['in  progress ', 'in progress'],
    ['in--progress', 'in progress'],
    ['Done', 'done'],
    ['back log', null],
    ['todo', null]
  ])('%j → %j', (name, expected) => {
    expect(statusOfFolder(name)).toBe(expected)
  })
})

describe('isSkipped', () => {
  it.each([
    ['_attachments', true],
    ['.DS_Store', true],
    ['a.md.3f9a.tmp', true],
    ['A.TMP', true],
    ['backlog', false],
    ['notes.md', false],
    ['tmp.md', false]
  ])('%j → %s', (name, expected) => {
    expect(isSkipped(name)).toBe(expected)
  })
})

describe('sameName', () => {
  it.each([
    ['Planner', 'planner', true],
    ['Größe', 'Größe', true],
    ['Їжак.md', 'їжак.md', true],
    ['a.md', 'b.md', false]
  ])('%j and %j → %s', (a, b, expected) => {
    expect(sameName(a, b)).toBe(expected)
  })
})

describe('nameKey', () => {
  it('is one key for the names sameName calls one', () => {
    expect(nameKey('Planner')).toBe(nameKey('PLANNER'))
    expect(nameKey('Planner')).not.toBe(nameKey('Planer'))
  })
})

describe('stemOf', () => {
  it.each([
    ['Fix login.md', 'Fix login'],
    ['Notes.MD', 'Notes'],
    ['README', 'README']
  ])('%j → %j', (fileName, expected) => {
    expect(stemOf(fileName)).toBe(expected)
  })
})

describe('boardFolderName', () => {
  it.each([
    ['planner', 'planner'],
    ['my/app', 'my app'],
    ['...', 'project']
  ])('%j → %j', (projectName, expected) => {
    expect(boardFolderName(projectName)).toBe(expected)
  })
})

describe('machineLabel', () => {
  it.each([
    ['MacBook-Pro.local', 'MacBook-Pro'],
    ['host.LOCAL', 'host'],
    ['build-box', 'build-box'],
    ['', 'unknown'],
    ['  ', 'unknown']
  ])('%j → %j', (hostname, expected) => {
    expect(machineLabel(hostname)).toBe(expected)
  })
})

describe('safeStem', () => {
  it.each([
    ['', 'Untitled', 'Untitled'],
    ['  ', 'project', 'project'],
    ['a\u0007b', 'x', 'a b'],
    ['a\\b*c"d<e>f|g\u007fh', 'x', 'a b c d e f g h'],
    ['name.', 'x', 'name'],
    ['a'.repeat(79) + ' .b', 'x', 'a'.repeat(79)],
    ['a'.repeat(78) + '. b', 'x', 'a'.repeat(78)],
    ['😀'.repeat(81), 'x', '😀'.repeat(80)]
  ])('%j (or %j) → %j', (value, fallback, expected) => {
    expect(safeStem(value, fallback)).toBe(expected)
  })
})

describe('compareNames', () => {
  it('lists digits by their value', () => {
    expect(['task 10.md', 'task 2.md'].sort(compareNames)).toEqual(['task 2.md', 'task 10.md'])
  })

  it('lists Ukrainian letters in alphabet order', () => {
    expect(['і.md', 'в.md', 'Ґ.md', 'а.md', 'г.md', 'и.md'].sort(compareNames)).toEqual([
      'а.md',
      'в.md',
      'г.md',
      'Ґ.md',
      'и.md',
      'і.md'
    ])
  })

  it('reads a decomposed name as the composed one', () => {
    expect(compareNames('Größe', 'Größe')).toBe(0)
  })
})

describe('cardFileName', () => {
  it.each([
    ['Fix login', [], 'Fix login.md'],
    ['Виправити логін', [], 'Виправити логін.md'],
    ['Größe ändern: Übersicht', [], 'Größe ändern Übersicht.md'],
    ['feat/api: add v2?', [], 'feat api add v2.md'],
    ['  .hidden _draft  ', [], 'hidden _draft.md'],
    ['???', [], 'Untitled.md'],
    ['Fix login', ['fix LOGIN.md'], 'Fix login-2.md'],
    ['Fix login', ['Fix login.md', 'fix login-2.md'], 'Fix login-3.md'],
    ['Größe', [], 'Größe.md'],
    ['a'.repeat(100), [], 'a'.repeat(80) + '.md']
  ])('%j beside %j → %j', (title, taken, expected) => {
    expect(cardFileName(title, taken)).toBe(expected)
  })
})

describe('cardWorkspaceName', () => {
  it.each([
    ['Fix login', 'Fix login'],
    ['feat/api v2', 'feat api v2'],
    ['API: швидкість', 'API: швидкість'],
    ['Виправити логін', null],
    ['ab', null],
    ['Fix ' + 'x'.repeat(60), 'Fix ' + 'x'.repeat(44)],
    ['a\tb\nc', 'a b c'],
    ['abc' + '😀'.repeat(60), 'abc' + '😀'.repeat(45)]
  ])('%j → %j', (title, expected) => {
    expect(cardWorkspaceName(title)).toBe(expected)
  })
})
