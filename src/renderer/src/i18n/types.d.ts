import type { Translation } from './locales/en.js'

/**
 * Makes `t()` key-aware: unknown keys become type errors instead of
 * silently rendering the raw key string.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: Translation
    }
  }
}
