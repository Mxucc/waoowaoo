import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { completeManualAssetWaitKey } from '@/lib/manual-assets/manual-wait'

export const runtime = 'nodejs'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function parseRemainingKeys(payload: unknown): string[] {
  const obj = toObject(payload)
  const manualAsset = toObject(obj.manualAsset)
  const remaining = manualAsset.remainingKeys
  if (!Array.isArray(remaining)) return []
  return remaining.filter((item): item is string => typeof item === 'string')
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  const manualTaskId = typeof body?.manualTaskId === 'string' ? body.manualTaskId.trim() : ''
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  const content = body?.content

  if (!episodeId) throw new ApiError('INVALID_PARAMS', { field: 'episodeId' })
  if (!manualTaskId) throw new ApiError('INVALID_PARAMS', { field: 'manualTaskId' })
  if (!key) throw new ApiError('INVALID_PARAMS', { field: 'key' })

  const task = await prisma.task.findUnique({
    where: { id: manualTaskId },
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

  if (!task) throw new ApiError('NOT_FOUND')
  if (task.userId !== session.user.id || task.projectId !== projectId) throw new ApiError('FORBIDDEN')
  if (task.type !== 'manual_asset_wait') throw new ApiError('INVALID_PARAMS')
  if (task.targetType !== 'NovelPromotionEpisode' || task.targetId !== episodeId) throw new ApiError('INVALID_PARAMS')

  const remainingKeys = parseRemainingKeys(task.payload)
  if (!remainingKeys.includes(key)) {
    return NextResponse.json({ success: true, alreadySubmitted: true })
  }

  const taskResult = await prisma.task.update({
    where: { id: manualTaskId },
    data: {
      result: typeof content === 'string' ? content : content ?? null,
    },
    select: { id: true },
  })

  const completion = await completeManualAssetWaitKey({
    taskId: manualTaskId,
    projectId,
    userId: session.user.id,
    expectedTargetType: 'NovelPromotionEpisode',
    expectedTargetId: episodeId,
    completedKey: key,
  })
  if (!completion.ok) {
    throw new ApiError('INVALID_PARAMS', { code: completion.code })
  }

  return NextResponse.json({
    success: true,
    taskId: taskResult.id,
    completed: completion.done,
    progress: completion.progress,
  })
})
