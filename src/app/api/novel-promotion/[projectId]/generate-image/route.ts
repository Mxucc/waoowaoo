import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import { addCharacterPromptSuffix, addLocationPromptSuffix, getArtStylePrompt } from '@/lib/constants'
import {
  hasCharacterAppearanceOutput,
  hasLocationImageOutput
} from '@/lib/task/has-output'

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseJsonStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const type = body?.type
  const id = body?.id
  const appearanceId = body?.appearanceId
  const manualMode = body?.manualMode === true

  if (!type || !id) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (type !== 'character' && type !== 'location') {
    throw new ApiError('INVALID_PARAMS')
  }

  const taskType = type === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION
  const targetType = type === 'character' ? 'CharacterAppearance' : 'LocationImage'
  const targetId = type === 'character' ? (appearanceId || id) : id

  if (!targetId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const imageIndex = toNumber(body?.imageIndex)
  const hasOutputAtStart = type === 'character'
    ? await hasCharacterAppearanceOutput({
      appearanceId: targetId,
      characterId: id,
      appearanceIndex: toNumber(body?.appearanceIndex)
    })
    : await hasLocationImageOutput({
      locationId: id,
      imageIndex
    })

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const imageModel = type === 'character'
    ? projectModelConfig.characterModel
    : projectModelConfig.locationModel

  if (manualMode) {
    const project = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      select: { artStyle: true },
    })
    if (!project) {
      throw new ApiError('NOT_FOUND')
    }
    const artStylePrompt = getArtStylePrompt(project.artStyle, locale)
    const endpoint = `/api/novel-promotion/${projectId}/upload-asset-image`

    if (type === 'character') {
      const appearance = await prisma.characterAppearance.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          changeReason: true,
          description: true,
          descriptions: true,
          character: { select: { id: true, name: true } },
        },
      })
      if (!appearance) {
        throw new ApiError('NOT_FOUND')
      }
      const descriptions = parseJsonStringArray(appearance.descriptions)
      const fallback = typeof appearance.description === 'string' ? appearance.description : ''
      const fullDescriptions = descriptions.length > 0 ? descriptions : [fallback]
      const indexFromBody = toNumber(body?.imageIndex) ?? toNumber(body?.descriptionIndex)
      const indices = indexFromBody !== null
        ? [Math.max(0, Math.floor(indexFromBody))]
        : [...Array(Math.min(3, fullDescriptions.length)).keys()]

      const labelBase = `${appearance.character.name} - ${appearance.changeReason || '形象'}`
      const items = indices
        .map((idx) => {
          const raw = (fullDescriptions[idx] || fallback || '').trim()
          const promptBody = addCharacterPromptSuffix(raw)
          const prompt = artStylePrompt ? `${promptBody}，${artStylePrompt}` : promptBody
          return {
            key: String(idx),
            label: `${labelBase} #${idx + 1}`,
            prompt,
            upload: {
              endpoint,
              method: 'POST',
              fileField: 'file',
              fields: {
                type: 'character',
                id,
                appearanceId: appearance.id,
                imageIndex: String(idx),
                labelText: labelBase,
              },
            },
          }
        })
        .filter((item) => item.prompt.trim().length > 0)

      if (items.length === 0) {
        throw new ApiError('INVALID_PARAMS')
      }

      const manualPayload: Record<string, unknown> = {
        stage: 'manual_asset_wait',
        stageLabel: '等待手动上传素材',
        manualAsset: {
          kind: 'image',
          modelType: 'image',
          modelKey: imageModel,
          items,
          remainingKeys: items.map((it) => it.key),
          totalCount: items.length,
        },
      }

      const result = await submitTask({
        userId: session.user.id,
        locale,
        requestId: getRequestId(request),
        projectId,
        type: TASK_TYPE.MANUAL_ASSET_WAIT,
        targetType,
        targetId,
        payload: withTaskUiPayload(manualPayload, { hasOutputAtStart, intent: 'manual_upload' }),
        dedupeKey: `manual_asset_wait:${targetType}:${targetId}:image`,
        billingInfo: null,
      })
      return NextResponse.json(result)
    }

    const location = await prisma.novelPromotionLocation.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        images: { select: { imageIndex: true, description: true, imageUrl: true }, orderBy: { imageIndex: 'asc' } },
      },
    })
    if (!location) {
      throw new ApiError('NOT_FOUND')
    }
    const requestedIndex = toNumber(body?.imageIndex)
    const candidates = location.images
      .filter((img) => typeof img.description === 'string' && img.description.trim().length > 0)
      .filter((img) => requestedIndex === null || img.imageIndex === requestedIndex)
      .filter((img) => requestedIndex !== null || !img.imageUrl)

    const labelBase = location.name || '场景'
    const items = candidates.map((img) => {
      const promptBody = addLocationPromptSuffix(img.description || '')
      const prompt = artStylePrompt ? `${promptBody}，${artStylePrompt}` : promptBody
      return {
        key: String(img.imageIndex),
        label: `${labelBase} #${img.imageIndex + 1}`,
        prompt,
        upload: {
          endpoint,
          method: 'POST',
          fileField: 'file',
          fields: {
            type: 'location',
            id,
            imageIndex: String(img.imageIndex),
            labelText: labelBase,
          },
        },
      }
    })

    if (items.length === 0) {
      throw new ApiError('INVALID_PARAMS')
    }

    const manualPayload: Record<string, unknown> = {
      stage: 'manual_asset_wait',
      stageLabel: '等待手动上传素材',
      manualAsset: {
        kind: 'image',
        modelType: 'image',
        modelKey: imageModel,
        items,
        remainingKeys: items.map((it) => it.key),
        totalCount: items.length,
      },
    }

    const result = await submitTask({
      userId: session.user.id,
      locale,
      requestId: getRequestId(request),
      projectId,
      type: TASK_TYPE.MANUAL_ASSET_WAIT,
      targetType,
      targetId,
      payload: withTaskUiPayload(manualPayload, { hasOutputAtStart, intent: 'manual_upload' }),
      dedupeKey: `manual_asset_wait:${targetType}:${targetId}:image`,
      billingInfo: null,
    })
    return NextResponse.json(result)
  }

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: session.user.id,
      imageModel,
      basePayload: body,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }
  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: taskType,
    targetType,
    targetId,
    payload: withTaskUiPayload(billingPayload, { hasOutputAtStart }),
    dedupeKey: `${taskType}:${targetId}`,
    billingInfo: buildDefaultTaskBillingInfo(taskType, billingPayload)
  })

  return NextResponse.json(result)
})
