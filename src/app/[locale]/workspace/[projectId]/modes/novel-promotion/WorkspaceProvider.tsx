'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useSSE } from '@/lib/query/hooks/useSSE'
import type { SSEEvent } from '@/lib/task/types'
import { MANUAL_ASSET_TASK_EVENT } from '@/lib/manual-assets/client'
import { MANUAL_POLICY_CHANGED_EVENT, getEffectiveManualPolicy, setLegacyProjectManualMode, setProjectManualPolicy } from '@/lib/manual-policy/storage'
import { shouldManual as decideManual } from '@/lib/manual-policy/decision'
import type { ManualMediaType } from '@/lib/manual-policy/types'
import { logError as _ulogError } from '@/lib/logging/core'

type RefreshScope = 'all' | 'assets' | 'project'
type RefreshOptions = { scope?: string; mode?: string }
type TaskEventListener = (event: SSEEvent) => void

interface WorkspaceContextValue {
  projectId: string
  episodeId?: string
  refreshData: (scope?: RefreshScope) => Promise<void>
  onRefresh: (options?: RefreshOptions) => Promise<void>
  subscribeTaskEvents: (listener: TaskEventListener) => () => void
  manualAssetMode: boolean
  setManualAssetMode: (enabled: boolean) => void
  shouldManual: (mediaType: ManualMediaType, positionKey: string) => boolean
  manualAssetModalTaskId: string | null
  openManualAssetModal: (taskId: string) => void
  closeManualAssetModal: () => void
}

interface WorkspaceProviderProps {
  projectId: string
  episodeId?: string
  children: ReactNode
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ projectId, episodeId, children }: WorkspaceProviderProps) {
  const queryClient = useQueryClient()
  const listenersRef = useRef(new Set<TaskEventListener>())

  const storageKey = `manual-asset-mode:${projectId}`
  const [manualPolicy, setManualPolicyState] = useState(() => getEffectiveManualPolicy(projectId))
  const manualAssetMode = manualPolicy.globalEnabled
  const [manualAssetModalTaskId, setManualAssetModalTaskId] = useState<string | null>(null)

  useEffect(() => {
    setManualPolicyState(getEffectiveManualPolicy(projectId))
  }, [projectId])

  const setManualAssetMode = useCallback((enabled: boolean) => {
    setLegacyProjectManualMode(projectId, enabled)
    const current = getEffectiveManualPolicy(projectId)
    setProjectManualPolicy(projectId, {
      ...current,
      globalEnabled: enabled,
    })
    setManualPolicyState(getEffectiveManualPolicy(projectId))
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, enabled ? '1' : '0')
      }
    } catch (error) {
      _ulogError('[manual-policy] failed to persist legacy manual mode', error)
    }
  }, [projectId, storageKey])

  const shouldManual = useCallback((mediaType: ManualMediaType, positionKey: string) => {
    return decideManual(manualPolicy, mediaType, positionKey)
  }, [manualPolicy])

  const openManualAssetModal = useCallback((taskId: string) => {
    setManualAssetModalTaskId(taskId)
  }, [])

  const closeManualAssetModal = useCallback(() => {
    setManualAssetModalTaskId(null)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as unknown
      if (!detail || typeof detail !== 'object') return
      const taskId = (detail as { taskId?: unknown }).taskId
      if (typeof taskId === 'string' && taskId.trim()) {
        openManualAssetModal(taskId)
      }
    }
    window.addEventListener(MANUAL_ASSET_TASK_EVENT, handler)
    return () => {
      window.removeEventListener(MANUAL_ASSET_TASK_EVENT, handler)
    }
  }, [openManualAssetModal])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const refreshPolicy = () => {
      setManualPolicyState(getEffectiveManualPolicy(projectId))
    }
    window.addEventListener(MANUAL_POLICY_CHANGED_EVENT, refreshPolicy)
    window.addEventListener('storage', refreshPolicy)
    return () => {
      window.removeEventListener(MANUAL_POLICY_CHANGED_EVENT, refreshPolicy)
      window.removeEventListener('storage', refreshPolicy)
    }
  }, [projectId])

  const refreshData = useCallback(async (scope?: RefreshScope) => {
    const promises: Promise<unknown>[] = []

    if (!scope || scope === 'all' || scope === 'project') {
      promises.push(queryClient.refetchQueries({ queryKey: queryKeys.projectData(projectId) }))
    }

    if (!scope || scope === 'all' || scope === 'assets') {
      promises.push(queryClient.refetchQueries({ queryKey: queryKeys.projectAssets.all(projectId) }))
    }

    if (episodeId) {
      promises.push(queryClient.refetchQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) }))
      promises.push(queryClient.refetchQueries({ queryKey: queryKeys.storyboards.all(episodeId) }))
      promises.push(queryClient.refetchQueries({ queryKey: queryKeys.voiceLines.all(episodeId) }))
    }

    await Promise.all(promises)
  }, [episodeId, projectId, queryClient])

  const onRefresh = useCallback(async (options?: RefreshOptions) => {
    await refreshData(options?.scope as RefreshScope | undefined)
  }, [refreshData])

  const subscribeTaskEvents = useCallback((listener: TaskEventListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const handleTaskEvent = useCallback((event: SSEEvent) => {
    for (const listener of listenersRef.current) {
      listener(event)
    }
  }, [])

  useSSE({
    projectId,
    episodeId,
    enabled: !!projectId,
    onEvent: handleTaskEvent,
  })

  const value = useMemo<WorkspaceContextValue>(() => ({
    projectId,
    episodeId,
    refreshData,
    onRefresh,
    subscribeTaskEvents,
    manualAssetMode,
    setManualAssetMode,
    shouldManual,
    manualAssetModalTaskId,
    openManualAssetModal,
    closeManualAssetModal,
  }), [
    closeManualAssetModal,
    episodeId,
    manualAssetMode,
    manualAssetModalTaskId,
    onRefresh,
    openManualAssetModal,
    projectId,
    refreshData,
    setManualAssetMode,
    shouldManual,
    subscribeTaskEvents,
  ])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaceProvider() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspaceProvider must be used within WorkspaceProvider')
  }
  return context
}
