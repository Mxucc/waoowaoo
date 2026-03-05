import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({ taskId: 'task-1', async: true })))
const completeManualAssetWaitKeyMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, done: true, progress: 100, alreadyDone: false })))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({ id: 'task-1' })),
  },
}))

const authState = vi.hoisted(() => ({
  authenticated: true,
  userId: 'user-1',
  projectMode: 'novel-promotion' as const,
  novelPromotionInternalId: 'np-1',
}))

vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/manual-assets/manual-wait', () => ({ completeManualAssetWaitKey: completeManualAssetWaitKeyMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) =>
    !!value && typeof value === 'object' && (value as { __isErrorResponse?: unknown }).__isErrorResponse === true,
  requireProjectAuth: async (_projectId: string) => {
    if (!authState.authenticated) {
      return { __isErrorResponse: true, status: 401 }
    }
    return {
      session: { user: { id: authState.userId } },
      project: {
        id: _projectId,
        userId: authState.userId,
        mode: authState.projectMode,
        novelPromotionProject: { id: authState.novelPromotionInternalId },
      },
    }
  },
  requireProjectAuthLight: async (_projectId: string) => {
    if (!authState.authenticated) {
      return { __isErrorResponse: true, status: 401 }
    }
    return {
      session: { user: { id: authState.userId } },
      projectId: _projectId,
    }
  },
}))

describe('manual script-to-storyboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.userId = 'user-1'
    authState.projectMode = 'novel-promotion'
    authState.novelPromotionInternalId = 'np-1'
  })

  it('creates manual wait task for script-to-storyboard', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-1' })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'ep-1',
      novelPromotionProjectId: 'np-1',
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/script-to-storyboard-wait/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/script-to-storyboard-wait',
      method: 'POST',
      headers: {
        'accept-language': 'zh',
      },
      body: { episodeId: 'ep-1' },
    })
    const res = await route.POST(req, { params: Promise.resolve({ projectId: 'p-1' }) })
    expect(res.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledTimes(1)
    const call = submitTaskMock.mock.calls[0]?.[0]
    expect(call).toEqual(expect.objectContaining({
      projectId: 'p-1',
      episodeId: 'ep-1',
      type: 'manual_asset_wait',
      targetType: 'NovelPromotionEpisode',
      targetId: 'ep-1',
      billingInfo: null,
    }))
    expect(call.payload).toEqual(expect.objectContaining({
      manualAsset: expect.objectContaining({
        kind: 'text',
        remainingKeys: ['result'],
      }),
    }))
  })

  it('submits manual script-to-storyboard result and persists to task.result', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      projectId: 'p-1',
      type: 'manual_asset_wait',
      targetType: 'NovelPromotionEpisode',
      targetId: 'ep-1',
      status: 'queued',
      payload: {
        manualAsset: {
          remainingKeys: ['result'],
        },
      },
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/script-to-storyboard-submit/route')
    const content = JSON.stringify({ panels: [{ id: 'panel-1', summary: 'ok' }] })
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/script-to-storyboard-submit',
      method: 'POST',
      body: {
        episodeId: 'ep-1',
        manualTaskId: 'task-1',
        key: 'result',
        content,
      },
    })
    const res = await route.POST(req, { params: Promise.resolve({ projectId: 'p-1' }) })
    expect(res.status).toBe(200)

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { result: content },
      select: { id: true },
    })
    expect(completeManualAssetWaitKeyMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent when key already submitted', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      projectId: 'p-1',
      type: 'manual_asset_wait',
      targetType: 'NovelPromotionEpisode',
      targetId: 'ep-1',
      status: 'completed',
      payload: {
        manualAsset: {
          remainingKeys: [],
        },
      },
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/script-to-storyboard-submit/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/script-to-storyboard-submit',
      method: 'POST',
      body: {
        episodeId: 'ep-1',
        manualTaskId: 'task-1',
        key: 'result',
        content: '{}',
      },
    })
    const res = await route.POST(req, { params: Promise.resolve({ projectId: 'p-1' }) })
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload).toEqual({ success: true, alreadySubmitted: true })
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(completeManualAssetWaitKeyMock).not.toHaveBeenCalled()
  })
})
