import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { withTaskUiPayload } from '@/lib/task/ui-payload'

export const runtime = 'nodejs'

function buildManualPrompt() {
  return [
    '你正在使用【手动模式】执行 script_to_storyboard。请根据项目当前的 clips/screenplay，调用你选择的 AI 模型，让模型严格输出 JSON（不要任何额外文字）。',
    '',
    'JSON 结构要求（示例）：',
    '{',
    '  "panels": [',
    '    { "id": "panel-1", "summary": "...", "location": "...", "characters": ["..."], "shot": "...", "dialogue": "..." }',
    '  ]',
    '}',
    '',
    '注意：',
    '- 输出必须是可被 JSON.parse 解析的纯 JSON。',
    '- 字段结构需与系统当前 script_to_storyboard 的产物一致（否则后续消费会失败）。',
  ].join('\n')
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''

  if (!episodeId) throw new ApiError('INVALID_PARAMS', { field: 'episodeId' })

  const authResult = await requireProjectAuth(projectId)
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
  const prompt = buildManualPrompt()

  const endpoint = `/api/novel-promotion/${projectId}/manual/script-to-storyboard-submit`
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
          label: 'Script→Storyboard 结果（JSON）',
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
    dedupeKey: `manual_asset_wait:script_to_storyboard:${episodeId}`,
    billingInfo: null,
  })

  return NextResponse.json(result)
})
