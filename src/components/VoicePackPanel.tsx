import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import '../styles/voicepack.css';

/**
 * 语音包设置面板：
 * - 列表与权限来自服务端（hasPermission 是服务端计算的虚拟字段）
 * - 无权限的包裹着锁定态，点击只提示，选择请求也会被服务端拒绝
 * - 音量/静音存本地；选中的包由服务端账号维度持久化
 */
export const VoicePackPanel = observer(({ onClose }: { onClose: () => void }) => {
  const audio = store.audio;
  const [message, setMessage] = useState('');

  const choose = async (id: string) => {
    const result = await audio.select(id);
    setMessage(result.success ? '语音包已更新' : (result.message || '设置失败'));
  };

  return (
    <div className="voice-overlay" onMouseDown={onClose}>
      <div className="voice-panel" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="语音包设置">
        <div className="voice-head">
          <h3>🔊 语音包</h3>
          <button className="voice-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="voice-hint">
          {audio.currentGame
            ? `当前游戏：${audio.currentGame}，使用本包内该游戏的专属音效`
            : '进入游戏后自动切换到该游戏的专属音效'}
        </p>

        <div className="voice-packs">
          {audio.packs.map(pack => {
            const active = pack.id === audio.selected;
            const usable = audio.canUse(pack);
            return (
              <button
                key={pack.id}
                className={`voice-pack ${active ? 'active' : ''} ${usable ? '' : 'locked'}`}
                onClick={() => usable ? choose(pack.id) : setMessage('该语音包需要权限，当前仅可使用默认包')}
              >
                <span className="voice-cover">{pack.cover || '🎵'}</span>
                <span className="voice-meta">
                  <span className="voice-name">
                    {pack.name}
                    {pack.isDefault && <em className="voice-tag">默认</em>}
                    {!usable && <em className="voice-tag lock">🔒 需权限</em>}
                  </span>
                  <span className="voice-desc">{pack.desc}</span>
                  <span className="voice-files">
                    {pack.bgm.length} 首背景音乐 ·{' '}
                    {audio.currentGame
                      ? `${Object.keys(pack.games?.[audio.currentGame]?.sfx || {}).length} 个${audio.currentGame}专属音效`
                      : `${Object.keys(pack.sfx).length} 个通用音效`}
                  </span>
                </span>
                <span className="voice-state">{active ? '使用中' : usable ? '使用' : '锁定'}</span>
              </button>
            );
          })}
        </div>

        <div className="voice-controls">
          <label className="voice-volume">
            音量
            <input
              type="range" min="0" max="1" step="0.05"
              value={audio.volume}
              onChange={e => audio.setVolume(Number(e.target.value))}
            />
          </label>
          <button className="voice-btn" onClick={() => audio.setMuted(!audio.muted)}>
            {audio.muted ? '🔇 已静音' : '🔈 静音'}
          </button>
          <button className="voice-btn" onClick={() => audio.play('move')}>试听操作音</button>
          <button className="voice-btn" onClick={() => audio.play('click')}>点按音</button>
          <button className="voice-btn" onClick={() => audio.nextBgm()}>下一首</button>
        </div>
        {message && <p className="voice-message">{message}</p>}
        {!audio.hasPermission && (
          <p className="voice-hint">当前账号只能使用默认语音包；需要权限请联系管理员开通。</p>
        )}
      </div>
    </div>
  );
});

export default VoicePackPanel;
