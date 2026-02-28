import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { uploadToCOS } from '@/lib/cos'
import { completeManualAssetWaitKey } from '@/lib/manual-assets/manual-wait'

function guessExt(fileName: string) {
  const parts = fileName.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
  return ext && ext.length <= 6 ? ext : 'mp4'
}

export const POST = apiHandler(async (request: NextRequest, { params }) => {
  const rawProjectId = (await params).projectId
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : ''
  if (!projectId) throw new ApiError('INVALID_PARAMS', { field: 'projectId' })
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const formData = await request.formData()
  const panelIdRaw = formData.get('panelId')
  const kindRaw = formData.get('kind')
  const manualTaskIdRaw = formData.get('manualTaskId')
  const file = formData.get('file')

  const panelId = typeof panelIdRaw === 'string' ? panelIdRaw.trim() : ''
  const kind = typeof kindRaw === 'string' ? kindRaw.trim() : ''
  const manualTaskId = typeof manualTaskIdRaw === 'string' ? manualTaskIdRaw.trim() : ''

  if (!panelId) throw new ApiError('INVALID_PARAMS', { field: 'panelId' })
  if (kind !== 'raw' && kind !== 'lipsync') throw new ApiError('INVALID_PARAMS', { field: 'kind' })
  if (!(file instanceof File)) throw new ApiError('INVALID_PARAMS', { field: 'file' })

  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: {
        episode: { novelPromotionProjectId: project.id },
      },
    },
    select: { id: true },
  })
  if (!panel) throw new ApiError('NOT_FOUND')

  const ext = guessExt(file.name || 'mp4')
  const rand = Math.random().toString(16).slice(2)
  const key = `video/novel-promotion/${projectId}/${panel.id}/${kind}-${Date.now()}-${rand}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadToCOS(buffer, key)

  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: kind === 'raw' ? { videoUrl: key } : { lipSyncVideoUrl: key },
  })

  if (manualTaskId) {
    const completion = await completeManualAssetWaitKey({
      taskId: manualTaskId,
      projectId,
      userId: authResult.session.user.id,
      expectedTargetType: 'NovelPromotionPanel',
      expectedTargetId: panel.id,
      completedKey: kind,
    })
    if (!completion.ok) {
      throw new ApiError('INVALID_PARAMS', { code: completion.code })
    }
  }

  return NextResponse.json({ success: true, videoKey: key, kind })
})
