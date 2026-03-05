import { describe, expect, it } from 'vitest'
import type { RunState } from '@/lib/query/hooks/run-stream/types'
import type { RunStreamEvent } from '@/lib/novel-promotion/run-stream/types'
import { applyRunStreamEvent } from '@/lib/query/hooks/run-stream/state-machine'

/**
 * 目标：验证 step.chunk 会把 delta 累积到 stepsById[stepId].textOutput。
 * 不依赖 React hook，只测状态机。
 */
describe('applyRunStreamEvent (step.chunk accumulate)', () => {
  it('accumulates textOutput across multiple chunks', () => {
    let state: RunState | null = applyRunStreamEvent(null, {
      runId: 'run-1',
      event: 'run.start',
      ts: new Date().toISOString(),
      status: 'running',
      message: 'start',
    } satisfies RunStreamEvent)

    state = applyRunStreamEvent(state, {
      runId: 'run-1',
      event: 'step.chunk',
      ts: new Date().toISOString(),
      status: 'running',
      stepId: 'step:llm',
      lane: 'text',
      seq: 1,
      textDelta: '你',
    } satisfies RunStreamEvent)

    state = applyRunStreamEvent(state, {
      runId: 'run-1',
      event: 'step.chunk',
      ts: new Date().toISOString(),
      status: 'running',
      stepId: 'step:llm',
      lane: 'text',
      seq: 2,
      textDelta: '好',
    } satisfies RunStreamEvent)

    expect(state?.stepsById['step:llm']?.textOutput).toBe('你好')
    expect(state?.stepsById['step:llm']?.textLength).toBe(2)
  })
})
