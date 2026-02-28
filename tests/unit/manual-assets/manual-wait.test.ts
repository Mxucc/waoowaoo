import { describe, expect, it, vi, beforeEach } from 'vitest'
import { completeManualAssetWaitKey } from '@/lib/manual-assets/manual-wait'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
  },
}))

const updateTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const markTaskCompletedMock = vi.hoisted(() => vi.fn(async () => undefined))
const publishTaskEventMock = vi.hoisted(() => vi.fn(async () => undefined))
const removeTaskJobMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => ({
  updateTaskProgress: updateTaskProgressMock,
  markTaskCompleted: markTaskCompletedMock,
}))
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: publishTaskEventMock }))
vi.mock('@/lib/task/queues', () => ({ removeTaskJob: removeTaskJobMock }))

describe('completeManualAssetWaitKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates remainingKeys and progress when more items remain', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-1',
      userId: 'u-1',
      projectId: 'p-1',
      type: TASK_TYPE.MANUAL_ASSET_WAIT,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      status: 'queued',
      payload: {
        manualAsset: {
          kind: 'image',
          remainingKeys: ['0', '1'],
          totalCount: 2,
        },
      },
    })

    const result = await completeManualAssetWaitKey({
      taskId: 'task-1',
      projectId: 'p-1',
      userId: 'u-1',
      expectedTargetType: 'CharacterAppearance',
      expectedTargetId: 'appearance-1',
      completedKey: '0',
    })

    expect(result).toEqual({ ok: true, done: false, progress: 50, alreadyDone: false })
    expect(updateTaskProgressMock).toHaveBeenCalledTimes(1)
    expect(updateTaskProgressMock).toHaveBeenCalledWith(
      'task-1',
      50,
      expect.objectContaining({
        manualAsset: expect.objectContaining({
          remainingKeys: ['1'],
        }),
      }),
    )
    expect(markTaskCompletedMock).not.toHaveBeenCalled()
    expect(publishTaskEventMock).not.toHaveBeenCalled()
    expect(removeTaskJobMock).not.toHaveBeenCalled()
  })

  it('completes the task when last key is uploaded', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-2',
      userId: 'u-1',
      projectId: 'p-1',
      type: TASK_TYPE.MANUAL_ASSET_WAIT,
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      status: 'processing',
      payload: {
        manualAsset: {
          kind: 'video',
          remainingKeys: ['raw'],
          totalCount: 1,
        },
      },
    })

    const result = await completeManualAssetWaitKey({
      taskId: 'task-2',
      projectId: 'p-1',
      userId: 'u-1',
      expectedTargetType: 'NovelPromotionPanel',
      expectedTargetId: 'panel-1',
      completedKey: 'raw',
    })

    expect(result).toEqual({ ok: true, done: true, progress: 100, alreadyDone: false })
    expect(updateTaskProgressMock).not.toHaveBeenCalled()
    expect(markTaskCompletedMock).toHaveBeenCalledTimes(1)
    expect(markTaskCompletedMock).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({
        stage: 'manual_asset_wait_done',
        stageLabel: '素材已上传',
      }),
    )
    expect(publishTaskEventMock).toHaveBeenCalledTimes(1)
    expect(publishTaskEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-2',
        projectId: 'p-1',
        userId: 'u-1',
        type: TASK_EVENT_TYPE.COMPLETED,
        taskType: TASK_TYPE.MANUAL_ASSET_WAIT,
        targetType: 'NovelPromotionPanel',
        targetId: 'panel-1',
      }),
    )
    expect(removeTaskJobMock).toHaveBeenCalledTimes(1)
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-2')
  })

  it('rejects when task belongs to another user', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-3',
      userId: 'u-2',
      projectId: 'p-1',
      type: TASK_TYPE.MANUAL_ASSET_WAIT,
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      status: 'queued',
      payload: {
        manualAsset: {
          kind: 'audio',
          remainingKeys: ['audio'],
          totalCount: 1,
        },
      },
    })

    const result = await completeManualAssetWaitKey({
      taskId: 'task-3',
      projectId: 'p-1',
      userId: 'u-1',
      expectedTargetType: 'NovelPromotionVoiceLine',
      expectedTargetId: 'line-1',
      completedKey: 'audio',
    })

    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' })
  })
})
