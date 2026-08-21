import type { MohoApi } from './index'

declare global {
  interface Window {
    moho: MohoApi
  }
}

export {}
