import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { withTaskUiPayload } from '@/lib/task/ui-payload'

export const runtime = 'nodejs'

function buildManualPrompt(content: string) {
  const maxLength = 30_000
  const clipped = content.length > maxLength ? content.slice(0, maxLength) : content
  return [
    '你正在使用【手动模式】执行 story_to_script。请将下面的“原文”提交给你选择的 AI 模型，让模型严格输出 JSON（不要任何额外文字）。',
    '',
    'JSON 结构要求：',
    '{',
    '  "analyzedCharacters": [ { "name": "...", "aliases": ["..."], "introduction": "...", ... } ],',
    '  "analyzedLocations": [ { "name": "...", "summary": "...", "descriptions": ["..."] } ],',
    '  "clipList": [ { "id": "clip-1", "startText": "...", "endText": "...", "summary": "...", "location": "...", "characters": ["..."], "content": "..." } ],',
    '  "screenplayResults": [ { "clipId": "clip-1", "success": true, "screenplay": { ... } } ]',
    '}',
    '',
    '注意：',
    '- clipList[].id 必须唯一，并且 screenplayResults[].clipId 必须能在 clipList[].id 中找到。',
    '- screenplay 可以是对象或数组，保持结构化即可。',
    '',
    '原文：',
    clipped,
  ].join('\n')
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  const content = typeof body?.content === 'string' ? body.content.trim() : ''

  if (!episodeId) throw new ApiError('INVALID_PARAMS', { field: 'episodeId' })
  if (!content) throw new ApiError('INVALID_PARAMS', { field: 'content' })

  const authResult = await requireProjectAuth(projectId, {
    include: { characters: true, locations: true },
  })
  if (isErrorResponse(authResult)) return authResult
  const { session, project } = authResult

  if (project.mode !== 'novel-promotion') {
    throw new ApiError('INVALID_PARAMS')
  }

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    throw new ApiError('NOT_FOUND')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: { id: true, novelPromotionProjectId: true },
  })
  if (!episode || episode.novelPromotionProjectId !== novelProject.id) {
    throw new ApiError('NOT_FOUND')
  }

  const locale = resolveRequiredTaskLocale(request, body)
  const modelKey = null
  const prompt = buildManualPrompt(content)

  const endpoint = `/api/novel-promotion/${projectId}/manual/story-to-script-submit`
  const manualPayload: Record<string, unknown> = {
    stage: 'manual_asset_wait',
    stageLabel: '等待手动提交结果',
    manualAsset: {
      kind: 'text',
      modelType: 'llm',
      modelKey,
      items: [
        {
          key: 'result',
          label: 'Story→Script 结果（JSON）',
          prompt,
          upload: {
            endpoint,
            method: 'POST',
            fields: {
              episodeId,
            },
          },
        },
      ],
      remainingKeys: ['result'],
      totalCount: 1,
    },
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId,
    type: TASK_TYPE.MANUAL_ASSET_WAIT,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    payload: withTaskUiPayload(manualPayload, {
      hasOutputAtStart: false,
      intent: 'manual_upload',
    }),
    dedupeKey: `manual_asset_wait:story_to_script:${episodeId}`,
    billingInfo: null,
  })

  return NextResponse.json(result)
})
