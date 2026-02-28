import { prisma } from '@/lib/prisma'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
import { markTaskCompleted, updateTaskProgress } from '@/lib/task/service'
import { publishTaskEvent } from '@/lib/task/publisher'
import { removeTaskJob } from '@/lib/task/queues'

type ManualAssetKind = 'image' | 'video' | 'audio'

type ManualAssetState = {
  kind: ManualAssetKind
  remainingKeys: string[]
  totalCount: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function parseManualAssetState(payload: unknown): ManualAssetState | null {
  const obj = asObject(payload)
  if (!obj) return null
  const manualAsset = asObject(obj.manualAsset)
  if (!manualAsset) return null
  const kind = asString(manualAsset.kind)
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null
  const remainingKeys = asStringArray(manualAsset.remainingKeys)
  const totalCountRaw = manualAsset.totalCount
  const totalCount = typeof totalCountRaw === 'number' && Number.isFinite(totalCountRaw)
    ? Math.max(1, Math.floor(totalCountRaw))
    : Math.max(1, remainingKeys.length)

  return { kind, remainingKeys, totalCount }
}

function replaceRemainingKeys(payload: unknown, remainingKeys: string[]): Record<string, unknown> | null {
  const obj = asObject(payload)
  if (!obj) return null
  const manualAsset = asObject(obj.manualAsset)
  if (!manualAsset) return null
  return {
    ...obj,
    manualAsset: {
      ...manualAsset,
      remainingKeys,
      totalCount: manualAsset.totalCount,
    },
  }
}

function computeProgress(totalCount: number, remainingCount: number) {
  if (totalCount <= 0) return 0
  const done = Math.max(0, Math.min(totalCount, totalCount - remainingCount))
  return Math.max(0, Math.min(100, Math.round((done / totalCount) * 100)))
}

export async function completeManualAssetWaitKey(params: {
  taskId: string
  projectId: string
  userId: string
  expectedTargetType: string
  expectedTargetId: string
  completedKey: string
}) {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      userId: true,
      projectId: true,
      type: true,
      targetType: true,
      targetId: true,
      status: true,
      payload: true,
    },
  })

  if (!task) {
    return { ok: false as const, code: 'NOT_FOUND' as const }
  }
  if (task.userId !== params.userId || task.projectId !== params.projectId) {
    return { ok: false as const, code: 'FORBIDDEN' as const }
  }
  if (task.type !== TASK_TYPE.MANUAL_ASSET_WAIT) {
    return { ok: false as const, code: 'INVALID_TASK_TYPE' as const }
  }
  if (task.targetType !== params.expectedTargetType || task.targetId !== params.expectedTargetId) {
    return { ok: false as const, code: 'INVALID_TARGET' as const }
  }
  if (task.status !== 'queued' && task.status !== 'processing') {
    return { ok: false as const, code: 'TASK_NOT_ACTIVE' as const }
  }

  const state = parseManualAssetState(task.payload)
  if (!state) {
    return { ok: false as const, code: 'INVALID_PAYLOAD' as const }
  }

  const key = params.completedKey.trim()
  if (!key) {
    return { ok: false as const, code: 'INVALID_KEY' as const }
  }

  if (!state.remainingKeys.includes(key)) {
    const progress = computeProgress(state.totalCount, state.remainingKeys.length)
    return { ok: true as const, done: state.remainingKeys.length === 0, progress, alreadyDone: true as const }
  }

  const nextRemaining = state.remainingKeys.filter((k) => k !== key)
  const progress = computeProgress(state.totalCount, nextRemaining.length)
  const nextPayload = replaceRemainingKeys(task.payload, nextRemaining)

  if (!nextPayload) {
    return { ok: false as const, code: 'INVALID_PAYLOAD' as const }
  }

  if (nextRemaining.length > 0) {
    await updateTaskProgress(task.id, progress, nextPayload)
    return { ok: true as const, done: false as const, progress, alreadyDone: false as const }
  }

  await markTaskCompleted(task.id, {
    stage: 'manual_asset_wait_done',
    stageLabel: '素材已上传',
    progress: 100,
    manualAsset: {
      kind: state.kind,
    },
  })
  await publishTaskEvent({
    taskId: task.id,
    projectId: params.projectId,
    userId: params.userId,
    type: TASK_EVENT_TYPE.COMPLETED,
    taskType: TASK_TYPE.MANUAL_ASSET_WAIT,
    targetType: task.targetType,
    targetId: task.targetId,
    episodeId: null,
    payload: {
      stage: 'manual_asset_wait_done',
      stageLabel: '素材已上传',
      progress: 100,
    },
  })
  await removeTaskJob(task.id)
  return { ok: true as const, done: true as const, progress: 100, alreadyDone: false as const }
}
