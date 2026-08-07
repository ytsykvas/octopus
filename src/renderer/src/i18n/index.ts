/**
 * Localisation setup.
 *
 * English is the default and the fallback: every string originates in `en.ts`,
 * other locales mirror it. Keys are typed, so a typo in `t('...')` is a
 * compile error rather than a raw key rendered on screen.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { en } from './locales/en.js'
import { uk } from './locales/uk.js'

export const DEFAULT_LANGUAGE = 'en'
export const SUPPORTED_LANGUAGES = ['en', 'uk'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk }
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React already escapes rendered values.
    escapeValue: false
  }
})

export default i18n
