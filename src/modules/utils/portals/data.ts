import { portalsDatasetSchema } from './schema'

import type { PortalsDataset } from './schema'

/** `data/portals.json` as a `?raw` dynamic import — see `src/modules/utils/holidays/data.ts` for why. */
let pending: Promise<PortalsDataset> | null = null

export async function loadPortals(): Promise<PortalsDataset> {
  if (pending) return pending
  pending = import('../../../../data/portals.json?raw')
    .then((mod) => portalsDatasetSchema.parse(JSON.parse(mod.default)))
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}

export function resetPortalsCache(): void {
  pending = null
}
