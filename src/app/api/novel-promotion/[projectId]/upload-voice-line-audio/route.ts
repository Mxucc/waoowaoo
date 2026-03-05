import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { uploadToCOS } from '@/lib/cos'
import { completeManualAssetWaitKey } from '@/lib/manual-assets/manual-wait'

function guessExt(fileName: string) {
  const parts = fileName.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
  return ext && ext.length <= 6 ? ext : 'wav'
}

export const POST = apiHandler(async (request: NextRequest, { params }) => {
  const rawProjectId = (await params).projectId
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : ''
  if (!projectId) throw new ApiError('INVALID_PARAMS', { field: 'projectId' })
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const formData = await request.formData()
  const episodeIdRaw = formData.get('episodeId')
  const lineIdRaw = formData.get('lineId')
  const manualTaskIdRaw = formData.get('manualTaskId')
  const file = formData.get('file')

  const episodeId = typeof episodeIdRaw === 'string' ? episodeIdRaw.trim() : ''
  const lineId = typeof lineIdRaw === 'string' ? lineIdRaw.trim() : ''
  const manualTaskId = typeof manualTaskIdRaw === 'string' ? manualTaskIdRaw.trim() : ''

  if (!episodeId) throw new ApiError('INVALID_PARAMS', { field: 'episodeId' })
  if (!lineId) throw new ApiError('INVALID_PARAMS', { field: 'lineId' })
  if (!(file instanceof File)) throw new ApiError('INVALID_PARAMS', { field: 'file' })

  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')

  const voiceLine = await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      id: lineId,
      episodeId,
      episode: { novelPromotionProjectId: project.id },
    },
    select: { id: true },
  })
  if (!voiceLine) throw new ApiError('NOT_FOUND')

  const ext = guessExt(file.name || 'wav')
  const rand = Math.random().toString(16).slice(2)
  const key = `voice/novel-promotion/${projectId}/${episodeId}/${voiceLine.id}-${Date.now()}-${rand}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadToCOS(buffer, key)

  await prisma.novelPromotionVoiceLine.update({
    where: { id: voiceLine.id },
    data: { audioUrl: key },
  })

  if (manualTaskId) {
    const completion = await completeManualAssetWaitKey({
      taskId: manualTaskId,
      projectId,
      userId: authResult.session.user.id,
      expectedTargetType: 'NovelPromotionVoiceLine',
      expectedTargetId: voiceLine.id,
      completedKey: 'audio',
    })
    if (!completion.ok) {
      throw new ApiError('INVALID_PARAMS', { code: completion.code })
    }
  }

  return NextResponse.json({ success: true, audioKey: key })
})
