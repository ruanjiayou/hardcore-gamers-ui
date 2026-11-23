import React from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import '../styles/sound-toggle.css';

/**
 * 背景音乐开关：游戏顶栏与贪吃蛇全屏 HUD 共用。
 * 只控制 BGM 的播放；落子/选子/将军等操作音始终播放，不受此开关影响。
 * 状态由 AudioStore 持久化到 localStorage。
 */
export const SoundToggle = observer(({ className = '' }: { className?: string }) => {
  const muted = store.audio.muted;
  return (
    <button
      type="button"
      className={`sound-toggle${muted ? ' is-muted' : ''}${className ? ` ${className}` : ''}`}
      title={muted ? '开启背景音乐' : '关闭背景音乐'}
      aria-label={muted ? '开启背景音乐' : '关闭背景音乐'}
      aria-pressed={muted}
      onClick={() => store.audio.setMuted(!muted)}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🎵'}</span>
    </button>
  );
});

export default SoundToggle;
