import type { ManualMediaType, ManualPolicyV1, ManualPositionKey } from './types'

export function shouldManual(policy: ManualPolicyV1, mediaType: ManualMediaType, positionKey: ManualPositionKey): boolean {
  if (!policy.globalEnabled) return false
  const media = policy.media[mediaType]
  const override = media.byPosition[positionKey]
  if (override) return override.manualEnabled
  return media.defaultManualEnabled
}
