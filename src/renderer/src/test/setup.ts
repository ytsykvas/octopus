import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Real translations, not a stub: the tests then assert what a user reads, and
// a missing key shows up as a raw key in an assertion rather than passing.
import '../i18n/index.js'
import { installOctopusStub } from './octopus.js'

// jsdom has no matchMedia, and xterm.js asks for it while measuring. Without
// it a terminal rendered in a test throws before it draws anything.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
})

beforeEach(() => {
  installOctopusStub()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
