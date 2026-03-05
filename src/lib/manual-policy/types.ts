export type ManualMediaType = 'image' | 'video' | 'audio' | 'text'

export type ManualPositionKey = string

export type ManualPolicyVersion = 1

export type ManualPositionPolicy = {
  manualEnabled: boolean
}

export type ManualMediaPolicy = {
  defaultManualEnabled: boolean
  byPosition: Record<ManualPositionKey, ManualPositionPolicy>
}

export type ManualPolicyV1 = {
  version: ManualPolicyVersion
  globalEnabled: boolean
  media: Record<ManualMediaType, ManualMediaPolicy>
}

export const DEFAULT_MANUAL_POLICY_V1: ManualPolicyV1 = {
  version: 1,
  globalEnabled: false,
  media: {
    image: { defaultManualEnabled: false, byPosition: {} },
    video: { defaultManualEnabled: false, byPosition: {} },
    audio: { defaultManualEnabled: false, byPosition: {} },
    text: { defaultManualEnabled: false, byPosition: {} },
  },
}
