import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { uploadToCOS, generateUniqueKey } from '@/lib/cos'
import { completeManualAssetWaitKey } from '@/lib/manual-assets/manual-wait'

function parseCandidateImages(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export const POST = apiHandler(async (request: NextRequest, { params }) => {
  const rawProjectId = (await params).projectId
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : ''
  if (!projectId) throw new ApiError('INVALID_PARAMS', { field: 'projectId' })
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const formData = await request.formData()
  const panelIdRaw = formData.get('panelId')
  const candidateIndexRaw = formData.get('candidateIndex')
  const manualTaskIdRaw = formData.get('manualTaskId')

  const panelId = typeof panelIdRaw === 'string' ? panelIdRaw.trim() : ''
  const candidateIndex = typeof candidateIndexRaw === 'string' ? candidateIndexRaw.trim() : ''
  const manualTaskId = typeof manualTaskIdRaw === 'string' ? manualTaskIdRaw.trim() : ''
  const file = formData.get('file')

  if (!panelId) throw new ApiError('INVALID_PARAMS', { field: 'panelId' })
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
    select: { id: true, candidateImages: true },
  })
  if (!panel) throw new ApiError('NOT_FOUND')

  const inputBuffer = Buffer.from(await file.arrayBuffer())
  const outputBuffer = await sharp(inputBuffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  const key = generateUniqueKey(`panel-${panelId}-candidate-${candidateIndex || 'x'}`, 'jpg')
  await uploadToCOS(outputBuffer, key)

  const existing = parseCandidateImages(panel.candidateImages)
  const idx = Number(candidateIndex)
  if (Number.isFinite(idx) && idx >= 0) {
    while (existing.length <= idx) existing.push('')
    existing[idx] = key
  } else {
    existing.push(key)
  }

  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: { candidateImages: JSON.stringify(existing) },
  })

  if (manualTaskId) {
    if (!candidateIndex) throw new ApiError('INVALID_PARAMS', { field: 'candidateIndex' })
    const completion = await completeManualAssetWaitKey({
      taskId: manualTaskId,
      projectId,
      userId: authResult.session.user.id,
      expectedTargetType: 'NovelPromotionPanel',
      expectedTargetId: panel.id,
      completedKey: candidateIndex,
    })
    if (!completion.ok) {
      throw new ApiError('INVALID_PARAMS', { code: completion.code })
    }
  }

  return NextResponse.json({ success: true, imageKey: key, candidateIndex: candidateIndex || null })
})
