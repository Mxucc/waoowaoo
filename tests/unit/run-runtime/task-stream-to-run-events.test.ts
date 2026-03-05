import { describe, expect, it } from 'vitest'
import type { SSEEvent } from '@/lib/task/types'
import { mapTaskSSEEventToRunEvents } from '@/lib/query/hooks/run-stream/event-parser'

/**
 * 目标：验证 task SSE 的 STREAM 事件会被映射为 run-stream 的 step.chunk。
 * 这层测试不依赖 React hook，只测纯函数桥接。
 */
describe('mapTaskSSEEventToRunEvents (task SSE stream → step.chunk)', () => {
  it('maps text stream delta to step.chunk with lane=text', () => {
    const input: SSEEvent = {
      type: 'task.stream',
      ts: new Date().toISOString(),
      taskId: 'run-1',
      taskType: 'story_to_script_run',
      payload: {
        stepId: 'step:llm',
        stepTitle: 'LLM',
        stepIndex: 1,
        stepTotal: 3,
        stream: {
          kind: 'text',
          lane: 'text',
          delta: '你好',
          seq: 1,
        },
      },
    }

    const events = mapTaskSSEEventToRunEvents(input)

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({
      runId: 'run-1',
      event: 'step.chunk',
      stepId: 'step:llm',
      lane: 'text',
      seq: 1,
      textDelta: '你好',
    }))
  })
})
