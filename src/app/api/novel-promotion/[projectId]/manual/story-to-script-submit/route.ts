import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { completeManualAssetWaitKey } from '@/lib/manual-assets/manual-wait'
import { persistAnalyzedCharacters, persistAnalyzedLocations, persistClips, resolveClipRecordId } from '@/lib/workers/handlers/story-to-script-helpers'
import type { StoryToScriptClipCandidate } from '@/lib/novel-promotion/story-to-script/orchestrator'
import type { ClipMatchLevel } from '@/lib/novel-promotion/story-to-script/clip-matching'

export const runtime = 'nodejs'

type ManualResult = {
  analyzedCharacters: Record<string, unknown>[]
  analyzedLocations: Record<string, unknown>[]
  clipList: StoryToScriptClipCandidate[]
  screenplayResults: Array<Record<string, unknown> & { clipId: string; success: boolean }>
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function parseMatchLevel(value: unknown): ClipMatchLevel {
  if (value === 'L1' || value === 'L2' || value === 'L3') return value
  return 'L1'
}

function parseMatchConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function toClipCandidate(value: Record<string, unknown>): StoryToScriptClipCandidate {
  const id = readString(value.id).trim()
  if (!id) throw new Error('clipList[].id is required')
  const startText = readString(value.startText)
  const endText = readString(value.endText)
  const summary = readString(value.summary)
  const locationText = readString(value.location).trim()
  const content = readString(value.content)
  if (!content.trim()) throw new Error(`clipList[${id}].content is required`)

  return {
    id,
    startText,
    endText,
    summary,
    location: locationText ? locationText : null,
    characters: readStringArray(value.characters),
    content,
    matchLevel: parseMatchLevel(value.matchLevel),
    matchConfidence: parseMatchConfidence(value.matchConfidence),
  }
}

function parseManualResult(content: unknown): ManualResult {
  const data = typeof content === 'string' ? JSON.parse(content) : content
  const obj = toObject(data)
  const analyzedCharacters = readArray(obj.analyzedCharacters).map(toObject)
  const analyzedLocations = readArray(obj.analyzedLocations).map(toObject)
  const clipList = readArray(obj.clipList).map(toObject).map(toClipCandidate)
  const screenplayResultsRaw = readArray(obj.screenplayResults).map(toObject)
  const screenplayResults = screenplayResultsRaw
    .map((item) => ({
      ...item,
      clipId: readString(item.clipId).trim(),
      success: readBoolean(item.success),
    }))
    .filter((item) => item.clipId)

  if (clipList.length === 0) {
    throw new Error('clipList is required')
  }

  return {
    analyzedCharacters,
    analyzedLocations,
    clipList,
    screenplayResults,
  }
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

  let parsed: ManualResult
  try {
    parsed = parseManualResult(content)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: { characters: true, locations: true },
  })
  if (!novelProject) throw new ApiError('NOT_FOUND')

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: { id: true, novelPromotionProjectId: true },
  })
  if (!episode || episode.novelPromotionProjectId !== novelProject.id) throw new ApiError('NOT_FOUND')

  const existingCharacterNames = new Set<string>((novelProject.characters || []).map((item) => String(item.name || '').toLowerCase()))
  const existingLocationNames = new Set<string>((novelProject.locations || []).map((item) => String(item.name || '').toLowerCase()))

  const createdCharacters = await persistAnalyzedCharacters({
    projectInternalId: novelProject.id,
    existingNames: existingCharacterNames,
    analyzedCharacters: parsed.analyzedCharacters,
  })
  const createdLocations = await persistAnalyzedLocations({
    projectInternalId: novelProject.id,
    existingNames: existingLocationNames,
    analyzedLocations: parsed.analyzedLocations,
  })
  const createdClipRows = await persistClips({
    episodeId,
    clipList: parsed.clipList,
  })
  const clipIdMap = new Map(createdClipRows.map((item) => [item.clipKey, item.id]))

  for (const screenplayResult of parsed.screenplayResults) {
    if (!screenplayResult.success) continue
    const screenplay = (screenplayResult as { screenplay?: unknown }).screenplay
    if (screenplay === null || screenplay === undefined) continue
    const clipRecordId = resolveClipRecordId(clipIdMap, screenplayResult.clipId)
    if (!clipRecordId) continue
    await prisma.novelPromotionClip.update({
      where: { id: clipRecordId },
      data: {
        screenplay: JSON.stringify(screenplay),
      },
    })
  }

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
    persistedCharacters: createdCharacters.length,
    persistedLocations: createdLocations.length,
    persistedClips: createdClipRows.length,
  })
})
