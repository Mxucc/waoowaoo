import type { ManualMediaType, ManualPositionKey } from './types'

export type ManualPositionMeta = {
  group: string
  label: string
  description: string
  mediaType: ManualMediaType
  positionKey: ManualPositionKey
}

export const MANUAL_POLICY_POSITIONS: ManualPositionMeta[] = [
  {
    group: '文本（工作流）',
    label: '故事 → 脚本（story_to_script）',
    description: '把原文转换为 clips/screenplay 的阶段',
    mediaType: 'text',
    positionKey: 'np.text.story_to_script',
  },
  {
    group: '文本（工作流）',
    label: '脚本 → 分镜（script_to_storyboard）',
    description: '把 clips/screenplay 转成 storyboards/panels 的阶段',
    mediaType: 'text',
    positionKey: 'np.text.script_to_storyboard',
  },
  {
    group: '图片（素材）',
    label: '角色图生成',
    description: '角色 appearance 图片生成/重生成',
    mediaType: 'image',
    positionKey: 'np.image.character',
  },
  {
    group: '图片（素材）',
    label: '场景图生成',
    description: '场景 location 图片生成/重生成',
    mediaType: 'image',
    positionKey: 'np.image.location',
  },
  {
    group: '图片（素材）',
    label: '分镜候选图生成（panel image）',
    description: '面板候选图生成/重生成',
    mediaType: 'image',
    positionKey: 'np.image.panel_candidate',
  },
  {
    group: '视频（素材）',
    label: '面板视频生成',
    description: '面板视频生成（video_panel）',
    mediaType: 'video',
    positionKey: 'np.video.panel',
  },
  {
    group: '视频（素材）',
    label: '口型同步（lip_sync）',
    description: '口型同步视频生成',
    mediaType: 'video',
    positionKey: 'np.video.lip_sync',
  },
  {
    group: '语音（素材）',
    label: '配音行音频生成（voice_line）',
    description: '单行/批量配音音频生成',
    mediaType: 'audio',
    positionKey: 'np.audio.voice_line',
  },
]
