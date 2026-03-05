'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  getEffectiveManualPolicy,
  setProjectManualPolicy,
} from '@/lib/manual-policy/storage'
import type { ManualMediaType, ManualPositionKey, ManualPolicyV1 } from '@/lib/manual-policy/types'

interface ManualModeSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
}

type MediaConfigDisplay = {
  label: string
  positions: Array<{
    key: ManualPositionKey
    label: string
  }>
}

const MEDIA_CONFIGS: Record<ManualMediaType, MediaConfigDisplay> = {
  image: {
    label: '图像',
    positions: [
      { key: 'np.image.character', label: '角色形象' },
      { key: 'np.image.location', label: '场景背景' },
      { key: 'np.image.panel_candidate', label: '分镜画面' },
    ],
  },
  video: {
    label: '视频',
    positions: [
      { key: 'np.video.panel', label: '分镜视频' },
      { key: 'np.video.lip_sync', label: '口型同步' },
    ],
  },
  audio: {
    label: '音频',
    positions: [
      { key: 'np.audio.voice_line', label: '语音台词' },
    ],
  },
  text: {
    label: '文本',
    positions: [
      { key: 'np.text.story_to_script', label: '故事 → 脚本（story_to_script）' },
      { key: 'np.text.script_to_storyboard', label: '脚本 → 分镜（script_to_storyboard）' },
    ],
  },
}

export function ManualModeSettingsModal({
  isOpen,
  onClose,
  projectId,
}: ManualModeSettingsModalProps) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [policy, setPolicyState] = useState<ManualPolicyV1>(() =>
    getEffectiveManualPolicy(projectId),
  )

  // 当 projectId 或 modal 状态变化时，重新加载策略
  useEffect(() => {
    if (projectId) {
      setPolicyState(getEffectiveManualPolicy(projectId))
    }
  }, [projectId, isOpen])

  const showSaved = () => {
    setSaveStatus('saved')
    window.setTimeout(() => setSaveStatus('idle'), 2000)
  }

  const handleDefaultChange = (mediaType: ManualMediaType, enabled: boolean) => {
    const newPolicy: ManualPolicyV1 = {
      ...policy,
      media: {
        ...policy.media,
        [mediaType]: {
          ...policy.media[mediaType],
          defaultManualEnabled: enabled,
        },
      },
    }
    setPolicyState(newPolicy)
    setProjectManualPolicy(projectId, newPolicy)
    showSaved()
  }

  const handlePositionChange = (
    mediaType: ManualMediaType,
    positionKey: ManualPositionKey,
    value: 'default' | 'auto' | 'manual',
  ) => {
    const currentByPosition = policy.media[mediaType].byPosition

    const nextByPosition = (() => {
      if (value === 'default') {
        return Object.fromEntries(
          Object.entries(currentByPosition).filter(([k]) => k !== positionKey),
        )
      }
      return {
        ...currentByPosition,
        [positionKey]: { manualEnabled: value === 'manual' },
      }
    })()

    const newPolicy: ManualPolicyV1 = {
      ...policy,
      media: {
        ...policy.media,
        [mediaType]: {
          ...policy.media[mediaType],
          byPosition: nextByPosition,
        },
      },
    }
    setPolicyState(newPolicy)
    setProjectManualPolicy(projectId, newPolicy)
    showSaved()
  }

  const handleAllAuto = () => {
    const mediaTypes = ['image', 'video', 'audio', 'text'] as const
    const newPolicy: ManualPolicyV1 = {
      ...policy,
      media: Object.fromEntries(
        mediaTypes.map((mediaType) => [
          mediaType,
          {
            defaultManualEnabled: false,
            byPosition: {},
          },
        ]),
      ) as ManualPolicyV1['media'],
    }
    setPolicyState(newPolicy)
    setProjectManualPolicy(projectId, newPolicy)
    showSaved()
  }

  const handleAllManual = () => {
    const mediaTypes = ['image', 'video', 'audio', 'text'] as const
    const newPolicy: ManualPolicyV1 = {
      ...policy,
      media: Object.fromEntries(
        mediaTypes.map((mediaType) => [
          mediaType,
          {
            defaultManualEnabled: true,
            byPosition: {},
          },
        ]),
      ) as ManualPolicyV1['media'],
    }
    setPolicyState(newPolicy)
    setProjectManualPolicy(projectId, newPolicy)
    showSaved()
  }

  // 键盘事件监听
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center glass-overlay animate-fadeIn">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="glass-surface-modal relative z-10 p-6 w-full max-w-2xl transform transition-all scale-100 max-h-[90vh] overflow-y-auto custom-scrollbar"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold text-[var(--glass-text-primary)]">
              手动模式精度设置
            </h2>
            <p className="text-sm text-[var(--glass-text-secondary)] mt-1">
              为不同媒体类型和阶段配置手动/自动生成方式
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`glass-chip text-xs transition-all duration-300 ${
                saveStatus === 'saved'
                  ? 'glass-chip-success'
                  : 'glass-chip-neutral'
              }`}
            >
              {saveStatus === 'saved' ? (
                <>
                  <AppIcon name="check" className="w-3.5 h-3.5" />
                  已保存
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 bg-[var(--glass-tone-success-fg)] rounded-full" />
                  自动保存
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="glass-btn-base glass-btn-soft rounded-full p-2 text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)]"
            >
              <AppIcon name="close" className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="flex gap-3 mb-6">
          <button
            type="button"
            onClick={handleAllAuto}
            className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
          >
            全部自动
          </button>
          <button
            type="button"
            onClick={handleAllManual}
            className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
          >
            全部手动
          </button>
        </div>

        {/* 配置列表 */}
        <div className="space-y-4">
          {(['image', 'video', 'audio', 'text'] as ManualMediaType[]).map(
            (mediaType) => {
              const config = MEDIA_CONFIGS[mediaType]
              const mediaSettings = policy.media[mediaType]

              return (
                <div
                  key={mediaType}
                  className="glass-surface-soft p-4 rounded-xl space-y-3"
                >
                  {/* 媒体类型标题 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AppIcon
                        name={
                          mediaType === 'image'
                            ? 'image'
                            : mediaType === 'video'
                              ? 'video'
                              : 'statsBar'
                        }
                        className="w-4 h-4 text-[var(--glass-tone-info-fg)]"
                      />
                      <span className="font-medium text-sm text-[var(--glass-text-primary)]">
                        {config.label}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mediaSettings.defaultManualEnabled}
                        onChange={(e) =>
                          handleDefaultChange(mediaType, e.target.checked)
                        }
                        className="w-4 h-4 rounded border-[var(--glass-border)] accent-[var(--glass-primary)]"
                      />
                      <span className="text-sm text-[var(--glass-text-secondary)]">
                        默认手动
                      </span>
                    </label>
                  </div>

                  {/* 二级：环节自动开关（仅当默认手动开启时） */}
                  {mediaSettings.defaultManualEnabled && config.positions.length > 0 && (
                    <div className="pl-6 space-y-2 pt-2 border-t border-[var(--glass-border)]">
                      <div className="text-xs text-[var(--glass-text-tertiary)]">
                        勾选表示该环节改为自动（覆盖默认手动）
                      </div>
                      {config.positions.map((position) => {
                        const positionSetting =
                          mediaSettings.byPosition[position.key]
                        const isAuto = positionSetting?.manualEnabled === false

                        return (
                          <label
                            key={position.key}
                            className="flex items-center justify-between gap-3 text-sm text-[var(--glass-text-secondary)] cursor-pointer"
                          >
                            <span>{position.label}</span>
                            <span className="flex items-center gap-2">
                              <span className="text-xs text-[var(--glass-text-tertiary)]">此环节使用自动</span>
                              <input
                                type="checkbox"
                                checked={isAuto}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    handlePositionChange(mediaType, position.key, 'auto')
                                  } else {
                                    handlePositionChange(mediaType, position.key, 'default')
                                  }
                                }}
                                className="w-4 h-4 rounded border-[var(--glass-border)] accent-[var(--glass-primary)]"
                              />
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {mediaSettings.defaultManualEnabled && config.positions.length === 0 && (
                    <div className="pl-6 text-xs text-[var(--glass-text-tertiary)] pt-2 border-t border-[var(--glass-border)]">
                      暂无可配置环节
                    </div>
                  )}

                  {!mediaSettings.defaultManualEnabled && config.positions.length > 0 && (
                    <div className="pl-6 text-xs text-[var(--glass-text-tertiary)] pt-2 border-t border-[var(--glass-border)]">
                      当前为默认自动（未启用本媒体的手动模式），无需配置环节自动/手动。
                    </div>
                  )}
                </div>
              )
            },
          )}
        </div>

        {/* 底部说明 */}
        <div className="mt-6 pt-4 border-t border-[var(--glass-border)]">
          <div className="text-xs text-[var(--glass-text-tertiary)] space-y-1">
            <p>• 默认手动：勾选后，所有该媒体类型的生成步骤默认进入手动上传模式</p>
            <p>
              • 跟随默认：使用媒体类型的默认设置（手动或自动）
            </p>
            <p>• 强制自动：无论默认设置如何，该环节始终使用自动生成</p>
            <p>• 强制手动：无论默认设置如何，该环节始终使用手动上传</p>
          </div>
        </div>
      </div>
    </div>
  )
}
