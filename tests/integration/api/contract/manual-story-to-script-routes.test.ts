import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({ taskId: 'task-1', async: true })))
const completeManualAssetWaitKeyMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, done: true, progress: 100, alreadyDone: false })))
const persistAnalyzedCharactersMock = vi.hoisted(() => vi.fn(async () => [{ id: 'c1', name: 'A' }]))
const persistAnalyzedLocationsMock = vi.hoisted(() => vi.fn(async () => [{ id: 'l1', name: 'X' }]))
const persistClipsMock = vi.hoisted(() => vi.fn(async () => [{ id: 'db-clip-1', clipKey: 'clip-1' }]))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionClip: {
    update: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
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
vi.mock('@/lib/workers/handlers/story-to-script-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/story-to-script-helpers')>(
    '@/lib/workers/handlers/story-to-script-helpers',
  )
  return {
    ...actual,
    persistAnalyzedCharacters: persistAnalyzedCharactersMock,
    persistAnalyzedLocations: persistAnalyzedLocationsMock,
    persistClips: persistClipsMock,
  }
})
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

describe('manual story-to-script routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.userId = 'user-1'
    authState.projectMode = 'novel-promotion'
    authState.novelPromotionInternalId = 'np-1'
  })

  it('creates manual wait task for story-to-script', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-1' })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'ep-1',
      novelPromotionProjectId: 'np-1',
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/story-to-script-wait/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/story-to-script-wait',
      method: 'POST',
      headers: {
        'accept-language': 'zh',
      },
      body: { episodeId: 'ep-1', content: 'hello' },
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

  it('submits manual story-to-script result and persists clips/screenplays (start=end edge case allowed)', async () => {
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
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-1',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'ep-1',
      novelPromotionProjectId: 'np-1',
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/story-to-script-submit/route')
    const content = JSON.stringify({
      analyzedCharacters: [{ name: 'A' }],
      analyzedLocations: [{ name: 'X', descriptions: ['d1'] }],
      clipList: [
        {
          id: 'clip-1',
          startText: '你好，我叫梁非凡',
          endText: '你好，我叫梁非凡',
          content: '你好，我叫梁非凡',
          characters: ['A'],
        },
      ],
      screenplayResults: [{ clipId: 'clip-1', success: true, screenplay: { ok: 1 } }],
    })
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/story-to-script-submit',
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
    const payload = await res.json()
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      persistedCharacters: 1,
      persistedLocations: 1,
      persistedClips: 1,
    }))
    expect(persistClipsMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionClip.update).toHaveBeenCalledWith({
      where: { id: 'db-clip-1' },
      data: { screenplay: JSON.stringify({ ok: 1 }) },
    })
    expect(completeManualAssetWaitKeyMock).toHaveBeenCalledTimes(1)
  })

  it('submits manual story-to-script result and persists clips/screenplays', async () => {
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
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-1',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'ep-1',
      novelPromotionProjectId: 'np-1',
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/story-to-script-submit/route')
    const content = JSON.stringify({
      analyzedCharacters: [{ name: 'A' }],
      analyzedLocations: [{ name: 'X', descriptions: ['d1'] }],
      clipList: [{ id: 'clip-1', content: 'c', characters: ['A'] }],
      screenplayResults: [{ clipId: 'clip-1', success: true, screenplay: { ok: 1 } }],
    })
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/story-to-script-submit',
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
    const payload = await res.json()
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      persistedCharacters: 1,
      persistedLocations: 1,
      persistedClips: 1,
    }))
    expect(persistClipsMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionClip.update).toHaveBeenCalledWith({
      where: { id: 'db-clip-1' },
      data: { screenplay: JSON.stringify({ ok: 1 }) },
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

    const route = await import('@/app/api/novel-promotion/[projectId]/manual/story-to-script-submit/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/p-1/manual/story-to-script-submit',
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
    expect(persistClipsMock).not.toHaveBeenCalled()
    expect(completeManualAssetWaitKeyMock).not.toHaveBeenCalled()
  })
})
