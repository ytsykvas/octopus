import type { MaestroApi } from './index.js'

declare global {
  interface Window {
    readonly maestro: MaestroApi
  }
}

export {}
