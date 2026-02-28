import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { hasPanelImageOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'
import { resolveNovelData } from '@/lib/workers/handlers/image-task-handler-shared'
import { getArtStylePrompt } from '@/lib/constants'
import { buildPanelImagePrompt, buildPanelImagePromptContext, assertPromptLocale } from '@/lib/novel-promotion/panel-image-prompt'

const DEFAULT_CANDIDATE_COUNT = 1

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const localeRaw = resolveRequiredTaskLocale(request, body)
  let locale: 'zh' | 'en'
  try {
    locale = assertPromptLocale(localeRaw)
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_LOCALE' })
  }
  const panelId = body?.panelId
  const count = body?.count
  const candidateCount = Math.max(1, Math.min(4, Number(count ?? DEFAULT_CANDIDATE_COUNT)))
  const manualMode = body?.manualMode === true

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  if (!projectModelConfig.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_NOT_CONFIGURED'})
  }
  try {
    await resolveModelSelection(session.user.id, projectModelConfig.storyboardModel, 'image')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storyboard image model is invalid'
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_INVALID',
      message})
  }

  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId,
    userId: session.user.id,
    modelType: 'image',
    modelKey: projectModelConfig.storyboardModel})
  const billingPayload = {
    ...body,
    candidateCount,
    imageModel: projectModelConfig.storyboardModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {})}

  const hasOutputAtStart = await hasPanelImageOutput(panelId)

  if (manualMode) {
    const panel = await prisma.novelPromotionPanel.findUnique({
      where: { id: panelId },
      select: {
        id: true,
        shotType: true,
        cameraMove: true,
        description: true,
        videoPrompt: true,
        location: true,
        characters: true,
        srtSegment: true,
        photographyRules: true,
        actingNotes: true,
      },
    })
    if (!panel) {
      throw new ApiError('NOT_FOUND')
    }

    const project = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      select: { artStyle: true },
    })
    if (!project) {
      throw new ApiError('NOT_FOUND')
    }

    const projectData = await resolveNovelData(projectId)
    const aspectRatio = projectData.videoRatio || '16:9'
    const styleText = getArtStylePrompt(project.artStyle, locale) || '与参考图风格一致'
    const promptContext = buildPanelImagePromptContext({
      panel: {
        id: panel.id,
        shotType: panel.shotType,
        cameraMove: panel.cameraMove,
        description: panel.description,
        videoPrompt: panel.videoPrompt,
        location: panel.location,
        characters: panel.characters,
        srtSegment: panel.srtSegment,
        photographyRules: panel.photographyRules,
        actingNotes: panel.actingNotes,
      },
      projectData,
    })
    const contextJson = JSON.stringify(promptContext, null, 2)
    const prompt = buildPanelImagePrompt({
      locale,
      aspectRatio,
      styleText,
      sourceText: panel.srtSegment || panel.description || '',
      contextJson,
    })

    const endpoint = `/api/novel-promotion/${projectId}/upload-panel-candidate-image`
    const items = [...Array(candidateCount).keys()].map((idx) => ({
      key: String(idx),
      label: `候选图 ${idx + 1}`,
      prompt,
      upload: {
        endpoint,
        method: 'POST',
        fileField: 'file',
        fields: {
          panelId,
          candidateIndex: String(idx),
        },
      },
    }))

    const manualPayload: Record<string, unknown> = {
      stage: 'manual_asset_wait',
      stageLabel: '等待手动上传素材',
      manualAsset: {
        kind: 'image',
        modelType: 'image',
        modelKey: projectModelConfig.storyboardModel,
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
      targetType: 'NovelPromotionPanel',
      targetId: panelId,
      payload: withTaskUiPayload(manualPayload, {
        intent: 'manual_upload',
        hasOutputAtStart,
      }),
      dedupeKey: `manual_asset_wait:image_panel:${panelId}:${candidateCount}`,
      billingInfo: null,
    })
    return NextResponse.json(result)
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.IMAGE_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panelId,
    payload: withTaskUiPayload(billingPayload, {
      intent: 'regenerate',
      hasOutputAtStart}),
    dedupeKey: `image_panel:${panelId}:${candidateCount}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload)})

  return NextResponse.json(result)
})
