/// <reference types="vite/client" />

import type { MongoApi } from '../../shared/types'

declare global {
  interface Window {
    mongoApi: MongoApi
  }
}

export {}
