import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import '../styles/game-settings.css';

/**
 * 游戏页统一设置入口：右上角齿轮按钮 + 弹框。
 * 把原先散落各处的配置收进一个对话框：
 * - 背景音乐（音量 / 开关 / 下一首）——只控 BGM，不影响落子等操作音
 * - 语音包选择（无权限锁定默认包）
 * - 观战开关（房间等待态房主）
 * - 计时配置（象棋房间等待态）
 */
export interface SettingsRoom {
  room_id: string;
  isOwner: boolean;
  official: boolean;
  waiting: boolean;
  allowSpectate: boolean;
  isXiangqi: boolean;
  timeControl?: { enabled: boolean; stepLimitSec: number; totalBudgetMin: number };
  onToggleSpectate: (allow: boolean) => void;
  onSaveTimeControl: (tc: { enabled: boolean; stepLimitSec: number; totalBudgetMin: number }) => void;
}

export const GameSettings = observer(({
  className = '',
  room,
}: {
  className?: string;
  room?: SettingsRoom;
}) => {
  const audio = store.audio;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [tc, setTc] = useState(() => ({
    enabled: room?.timeControl?.enabled ?? false,
    stepLimitSec: room?.timeControl?.stepLimitSec ?? 30,
    totalBudgetMin: room?.timeControl?.totalBudgetMin ?? 10,
  }));

  const choosePack = async (id: string) => {
    const result = await audio.select(id);
    setMessage(result.success ? '语音包已更新' : (result.message || '设置失败'));
  };

  const showSpectate = !!room && room.waiting && room.isOwner;
  const showTimeControl = !!room && room.waiting && room.isXiangqi;

  return (
    <>
      <button
        type="button"
        className={`game-settings-btn${className ? ` ${className}` : ''}`}
        title="游戏设置"
        aria-label="游戏设置"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">⚙️</span>
      </button>
      {open && (
        <div className="settings-overlay" onMouseDown={() => setOpen(false)}>
          <div className="settings-dialog" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="游戏设置">
            <div className="settings-head">
              <h3>⚙️ 游戏设置</h3>
              <button className="settings-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>

            {/* 背景音乐：开关只影响 BGM，落子/选子/将军等音效始终播放 */}
            <section className="settings-section">
              <h4>🎵 背景音乐</h4>
              <p className="settings-hint">关闭后只静音背景音乐，落子、选子、将军等音效仍会播放。</p>
              <div className="settings-row">
                <button className="settings-btn" onClick={() => audio.setMuted(!audio.muted)}>
                  {audio.muted ? '🔇 已关闭' : '🎵 播放中'}
                </button>
                <button className="settings-btn" onClick={() => audio.nextBgm()}>下一首</button>
              </div>
              <label className="settings-volume">
                音量
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={audio.volume}
                  onChange={e => audio.setVolume(Number(e.target.value))}
                />
              </label>
            </section>

            {/* 语音包：权限由服务端下发，无权限只能默认包 */}
            <section className="settings-section">
              <h4>🔊 语音包</h4>
              <div className="settings-packs">
                {audio.packs.map(pack => {
                  const active = pack.id === audio.selected;
                  const usable = audio.canUse(pack);
                  return (
                    <button
                      key={pack.id}
                      className={`settings-pack${active ? ' active' : ''}${usable ? '' : ' locked'}`}
                      onClick={() => usable ? choosePack(pack.id) : setMessage('该语音包需要权限，当前仅可使用默认包')}
                    >
                      <span>{pack.cover || '🎵'}</span>
                      <span className="settings-pack-name">{pack.name}</span>
                      {active && <em>使用中</em>}
                      {!usable && <em className="lock">🔒</em>}
                    </button>
                  );
                })}
              </div>
              <p className="settings-hint">
                {audio.currentGame
                  ? `当前游戏：${audio.currentGame}，使用本包内该游戏的专属音效`
                  : '进入游戏后自动切换到该游戏的专属音效'}
              </p>
            </section>

            {/* 观战配置：房主在等待态切换 */}
            {showSpectate && (
              <section className="settings-section">
                <h4>👀 房间设置</h4>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={room!.allowSpectate}
                    onChange={e => room!.onToggleSpectate(e.target.checked)}
                  />
                  允许观战
                </label>
                {room!.official && <p className="settings-hint">官方房间：只能退出，不可解散</p>}
              </section>
            )}

            {/* 计时配置：象棋房间等待态，双方均可改 */}
            {showTimeControl && (
              <section className="settings-section">
                <h4>⏱️ 计时设置</h4>
                <label className="settings-check">
                  <input type="checkbox" checked={tc.enabled}
                    onChange={e => setTc({ ...tc, enabled: e.target.checked })} />
                  启用计时
                </label>
                {tc.enabled && (
                  <div className="settings-row wrap">
                    <label className="settings-field">每步限时（秒）
                      <input type="number" min={5} max={300} value={tc.stepLimitSec}
                        onChange={e => setTc({ ...tc, stepLimitSec: Number(e.target.value) })} />
                    </label>
                    <label className="settings-field">每人总额度（分钟）
                      <input type="number" min={1} max={120} value={tc.totalBudgetMin}
                        onChange={e => setTc({ ...tc, totalBudgetMin: Number(e.target.value) })} />
                    </label>
                  </div>
                )}
                <button className="settings-btn primary" disabled={saving} onClick={() => {
                  setSaving(true);
                  room!.onSaveTimeControl(tc);
                  setSaving(false);
                }}>{saving ? '保存中…' : '保存计时设置'}</button>
              </section>
            )}

            {message && <p className="settings-message">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
});

export default GameSettings;
