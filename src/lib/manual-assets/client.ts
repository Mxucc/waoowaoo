export const MANUAL_ASSET_TASK_EVENT = 'manual-asset-task-created'

export function emitManualAssetTaskCreated(taskId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MANUAL_ASSET_TASK_EVENT, { detail: { taskId } }))
}
