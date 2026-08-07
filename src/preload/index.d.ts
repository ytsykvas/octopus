import type { OctopusApi } from './index.js'

declare global {
  interface Window {
    readonly octopus: OctopusApi
  }
}

export {}
