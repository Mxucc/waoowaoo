import { DEFAULT_MANUAL_POLICY_V1, type ManualPolicyV1 } from './types'
import { logError as _ulogError } from '@/lib/logging/core'

export const MANUAL_POLICY_CHANGED_EVENT = 'manual-policy-changed'

const GLOBAL_KEY = 'manual-policy:v1'

function projectKey(projectId: string) {
  return `manual-policy:project:${projectId}:v1`
}

function legacyProjectKey(projectId: string) {
  return `manual-asset-mode:${projectId}`
}

function emitChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MANUAL_POLICY_CHANGED_EVENT))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizePolicy(value: unknown): ManualPolicyV1 {
  if (!isObject(value)) return DEFAULT_MANUAL_POLICY_V1
  if (value.version !== 1) return DEFAULT_MANUAL_POLICY_V1
  const globalEnabled = value.globalEnabled === true
  const mediaRaw = isObject(value.media) ? value.media : {}
  const mediaTypes = ['image', 'video', 'audio', 'text'] as const
  const media = Object.fromEntries(
    mediaTypes.map((mediaType) => {
      const mr = isObject(mediaRaw[mediaType]) ? (mediaRaw[mediaType] as Record<string, unknown>) : {}
      const defaultManualEnabled = mr.defaultManualEnabled === true
      const byPosRaw = isObject(mr.byPosition) ? (mr.byPosition as Record<string, unknown>) : {}
      const byPosition = Object.fromEntries(
        Object.entries(byPosRaw)
          .filter(([k]) => typeof k === 'string' && k.trim().length > 0)
          .map(([k, v]) => {
            const vr = isObject(v) ? v : {}
            return [k, { manualEnabled: (vr as Record<string, unknown>).manualEnabled === true }]
          }),
      )
      return [mediaType, { defaultManualEnabled, byPosition }]
    }),
  ) as ManualPolicyV1['media']
  return { version: 1, globalEnabled, media }
}

export function getGlobalManualPolicy(): ManualPolicyV1 {
  if (typeof window === 'undefined') return DEFAULT_MANUAL_POLICY_V1
  try {
    const raw = window.localStorage.getItem(GLOBAL_KEY)
    if (!raw) return DEFAULT_MANUAL_POLICY_V1
    return normalizePolicy(JSON.parse(raw))
  } catch (error) {
    _ulogError('[manual-policy] failed to read global policy', error)
    return DEFAULT_MANUAL_POLICY_V1
  }
}

export function setGlobalManualPolicy(policy: ManualPolicyV1) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(GLOBAL_KEY, JSON.stringify(policy))
  emitChanged()
}

export function getProjectManualPolicy(projectId: string): ManualPolicyV1 | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(projectKey(projectId))
    if (!raw) return null
    return normalizePolicy(JSON.parse(raw))
  } catch (error) {
    _ulogError('[manual-policy] failed to read project policy', error)
    return null
  }
}

export function setProjectManualPolicy(projectId: string, policy: ManualPolicyV1) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(projectKey(projectId), JSON.stringify(policy))
  emitChanged()
}

export function clearProjectManualPolicy(projectId: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(projectKey(projectId))
  emitChanged()
}

export function getEffectiveManualPolicy(projectId: string): ManualPolicyV1 {
  const global = getGlobalManualPolicy()
  const project = getProjectManualPolicy(projectId)
  if (project) return project

  if (typeof window !== 'undefined') {
    try {
      const legacy = window.localStorage.getItem(legacyProjectKey(projectId))
      if (legacy === '1') {
        return {
          version: 1,
          globalEnabled: true,
          media: {
            image: { defaultManualEnabled: true, byPosition: {} },
            video: { defaultManualEnabled: true, byPosition: {} },
            audio: { defaultManualEnabled: true, byPosition: {} },
            text: { defaultManualEnabled: true, byPosition: {} },
          },
        }
      }
    } catch (error) {
      _ulogError('[manual-policy] failed to read legacy manual mode', error)
    }
  }

  return global
}

export function setLegacyProjectManualMode(projectId: string, enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(legacyProjectKey(projectId), enabled ? '1' : '0')
    emitChanged()
  } catch (error) {
    _ulogError('[manual-policy] failed to write legacy manual mode', error)
  }
}
