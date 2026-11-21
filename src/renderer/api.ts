import type { LensApi } from '../shared/types'

declare global {
  interface Window {
    lens: LensApi
  }
}

export const lens = window.lens
