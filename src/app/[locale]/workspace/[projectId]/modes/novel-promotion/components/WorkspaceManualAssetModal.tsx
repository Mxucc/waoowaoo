'use client'

import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceProvider } from '../WorkspaceProvider'

type ManualAssetKind = 'image' | 'video' | 'audio'

type ManualAssetUpload = {
  endpoint: string
  method?: string
  fileField?: string
  fields?: Record<string, string>
}

type ManualAssetItem = {
  key: string
  label?: string
  prompt?: string
  upload?: ManualAssetUpload
}

type ManualAsset = {
  kind: ManualAssetKind
  modelKey?: string | null
  items: ManualAssetItem[]
  remainingKeys: string[]
  totalCount?: number
}

type TaskResponse = {
  task: {
    id: string
    payload: unknown
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseManualAsset(payload: unknown): ManualAsset | null {
  const obj = asObject(payload)
  if (!obj) return null
  const manual = asObject(obj.manualAsset)
  if (!manual) return null
  const kind = asString(manual.kind)
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null
  const itemsRaw = manual.items
  const items = Array.isArray(itemsRaw)
    ? itemsRaw
      .map((item): ManualAssetItem | null => {
        const it = asObject(item)
        if (!it) return null
        const key = asString(it.key)
        if (!key) return null
        const uploadObj = asObject(it.upload)
        const upload = uploadObj
          ? {
            endpoint: asString(uploadObj.endpoint) || '',
            method: asString(uploadObj.method) || undefined,
            fileField: asString(uploadObj.fileField) || undefined,
            fields: ((): Record<string, string> | undefined => {
              const fieldsObj = asObject(uploadObj.fields)
              if (!fieldsObj) return undefined
              const entries = Object.entries(fieldsObj)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k, v as string] as const)
              return Object.fromEntries(entries)
            })(),
          }
          : undefined
        return {
          key,
          label: asString(it.label) || undefined,
          prompt: asString(it.prompt) || undefined,
          upload: upload?.endpoint ? upload : undefined,
        }
      })
      .filter((item): item is ManualAssetItem => !!item)
    : []

  const remainingKeys = asStringArray(manual.remainingKeys)
  return {
    kind,
    modelKey: asString(manual.modelKey),
    items,
    remainingKeys,
    totalCount: typeof manual.totalCount === 'number' ? manual.totalCount : undefined,
  }
}

function getAccept(kind: ManualAssetKind) {
  if (kind === 'image') return 'image/*'
  if (kind === 'audio') return 'audio/*'
  return 'video/*'
}

export default function WorkspaceManualAssetModal() {
  const {
    projectId,
    manualAssetModalTaskId,
    closeManualAssetModal,
    refreshData,
  } = useWorkspaceProvider()

  const taskId = manualAssetModalTaskId
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualAsset, setManualAsset] = useState<ManualAsset | null>(null)
  const [fileByKey, setFileByKey] = useState<Record<string, File | null>>({})
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setManualAsset(null)
    setFileByKey({})

    void (async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: 'GET' })
        const data = (await res.json()) as TaskResponse
        if (!res.ok) {
          throw new Error((data as unknown as { error?: string }).error || 'Failed to load task')
        }
        const parsed = parseManualAsset(data.task.payload)
        if (!parsed) throw new Error('Task payload is not a manual asset wait')
        if (!cancelled) setManualAsset(parsed)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load task')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [taskId])

  const remainingItems = useMemo(() => {
    if (!manualAsset) return []
    const byKey = new Map(manualAsset.items.map((it) => [it.key, it]))
    return manualAsset.remainingKeys.map((key) => byKey.get(key)).filter((it): it is ManualAssetItem => !!it)
  }, [manualAsset])

  useEffect(() => {
    if (!taskId) return
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeManualAssetModal()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = 'unset'
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeManualAssetModal, taskId])

  if (!taskId) return null

  const kind = manualAsset?.kind || 'image'
  const total = manualAsset?.totalCount ?? manualAsset?.items.length ?? 0
  const remaining = manualAsset?.remainingKeys.length ?? 0
  const modelKey = manualAsset?.modelKey

  const onUpload = async (item: ManualAssetItem) => {
    if (!manualAsset) return
    const upload = item.upload
    if (!upload) {
      setError('Missing upload spec')
      return
    }
    const file = fileByKey[item.key]
    if (!file) {
      setError('请选择文件')
      return
    }

    setUploadingKey(item.key)
    setError(null)

    try {
      const formData = new FormData()
      const fileField = upload.fileField || 'file'
      formData.append(fileField, file)
      const fields = upload.fields || {}
      for (const [k, v] of Object.entries(fields)) {
        formData.append(k, v)
      }
      formData.append('manualTaskId', taskId)

      const res = await fetch(upload.endpoint, {
        method: upload.method || 'POST',
        body: formData,
      })
      const json = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const msg = asString(asObject(json)?.error) || '上传失败'
        throw new Error(msg)
      }

      setManualAsset((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          remainingKeys: prev.remainingKeys.filter((k) => k !== item.key),
        }
      })
      setFileByKey((prev) => ({ ...prev, [item.key]: null }))

      await refreshData('assets')
      await refreshData('project')

      const nextRemaining = (manualAsset.remainingKeys || []).filter((k) => k !== item.key)
      if (nextRemaining.length === 0) {
        closeManualAssetModal()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploadingKey(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--glass-overlay)] p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭手动素材弹窗"
        className="absolute inset-0"
        onClick={closeManualAssetModal}
      />
      <div
        className="glass-surface relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--glass-border)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-6 py-4">
          <div className="space-y-1">
            <div className="text-lg font-semibold text-[var(--glass-text)]">手动上传素材</div>
            <div className="text-xs text-[var(--glass-text-secondary)]">
              项目 {projectId} · 任务 {taskId}
            </div>
          </div>
          <button
            type="button"
            onClick={closeManualAssetModal}
            className="text-[var(--glass-text-secondary)] hover:text-[var(--glass-text)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          <div className="flex flex-wrap gap-2 text-xs text-[var(--glass-text-secondary)]">
            <span className="rounded-full border border-[var(--glass-border)] bg-[var(--glass-surface-soft)] px-3 py-1">类型：{kind}</span>
            <span className="rounded-full border border-[var(--glass-border)] bg-[var(--glass-surface-soft)] px-3 py-1">模型：{modelKey || '未指定'}</span>
            <span className="rounded-full border border-[var(--glass-border)] bg-[var(--glass-surface-soft)] px-3 py-1">进度：{total ? (total - remaining) : 0}/{total}</span>
          </div>

          {loading && <div className="text-sm text-[var(--glass-text-secondary)]">加载中...</div>}
          {error && <div className="text-sm text-red-400">{error}</div>}

          {!loading && manualAsset && remainingItems.length === 0 && (
            <div className="text-sm text-[var(--glass-text-secondary)]">没有待上传项。</div>
          )}

          {!loading && manualAsset && remainingItems.length > 0 && (
            <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
              {remainingItems.map((item) => (
                <div key={item.key} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-surface-soft)] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium text-[var(--glass-text)]">{item.label || item.key}</div>
                    <button
                      className="text-xs text-[var(--glass-text-secondary)] hover:text-[var(--glass-text)]"
                      onClick={() => {
                        if (!item.prompt) return
                        void navigator.clipboard?.writeText(item.prompt)
                      }}
                      type="button"
                    >
                      复制 Prompt
                    </button>
                  </div>
                  <textarea
                    className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass-surface)] p-3 text-xs text-[var(--glass-text)]"
                    rows={6}
                    readOnly
                    value={item.prompt || ''}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      type="file"
                      accept={getAccept(kind)}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setFileByKey((prev) => ({ ...prev, [item.key]: file }))
                      }}
                      className="text-xs text-[var(--glass-text-secondary)]"
                    />
                    <button
                      type="button"
                      onClick={() => void onUpload(item)}
                      disabled={uploadingKey === item.key}
                      className="rounded-lg bg-[var(--glass-primary)] px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {uploadingKey === item.key ? '上传中...' : '上传并继续'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
