import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import '../styles/game-settings.css';

/**
 * 游戏页统一设置：齿轮按钮（房间/对局顶栏）+ 弹框。
 * 弹框本体是受控的 GameSettingsDialog，游戏主页的入口已下沉到头像下拉菜单
 * 「⚙ 游戏设置」（UI-050），两边共用同一份弹框。
 * 把原先散落各处的配置收进一个对话框：
 * - 背景音乐（音量 / 开关）——只控 BGM，不影响落子等操作音（UI-105：已移除「下一首」按钮）
 * - 观战开关（房间等待态房主）
 * - 计时配置（象棋房间等待态）
 *
 * GM-snake-42：**外观（皮肤 / 食物 / 道具）的分区整个从设置里拿掉**。
 * 设置是「开关和滑块」的地方，塞一排皮肤小图既挤又看不清；
 * 皮肤改成在**游戏主页**和**皮肤列表页**竖着展示整条蛇，要换外观就去那两处。
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

export const GameSettingsDialog = observer(({
  open,
  onClose,
  room,
}: {
  /** 受控开关：顶栏齿轮按钮与头像下拉菜单「⚙ 游戏设置」共用这一份弹框 */
  open: boolean;
  onClose: () => void;
  room?: SettingsRoom;
  /** 当前游戏 slug（GM-snake-42 起设置里不再有外观分区，仅为调用方签名保留） */
  game?: string;
}) => {
  const audio = store.audio;
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [tc, setTc] = useState(() => ({
    enabled: room?.timeControl?.enabled ?? false,
    stepLimitSec: room?.timeControl?.stepLimitSec ?? 30,
    totalBudgetMin: room?.timeControl?.totalBudgetMin ?? 10,
  }));

  const showSpectate = !!room && room.waiting && room.isOwner;
  const showTimeControl = !!room && room.waiting && room.isXiangqi;

  if (!open) return null;

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div className="settings-dialog" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="游戏设置">
        <div className="settings-head">
          <h3>⚙️ 游戏设置</h3>
          <button className="settings-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {/* 背景音乐：开关只影响 BGM，落子/选子/将军等音效始终播放 */}
        <section className="settings-section">
          <h4>🎵 背景音乐</h4>
          <p className="settings-hint">关闭后只静音背景音乐，落子、选子、将军等音效仍会播放。</p>
          <div className="settings-row">
            <button className="settings-btn" onClick={() => audio.setMuted(!audio.muted)}>
              {audio.muted ? '🔇 已关闭' : '🎵 播放中'}
            </button>
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
  );
});

/**
 * 顶栏齿轮按钮（房间/对局页用）。
 * 游戏主页的设置入口已下沉到头像下拉菜单（「⚙ 游戏设置」，UI-050），
 * 两边共用 GameSettingsDialog，弹框 markup 只有一份。
 */
export const GameSettings = observer(({
  className = '',
  room,
  game,
}: {
  className?: string;
  room?: SettingsRoom;
  game?: string;
}) => {
  const [open, setOpen] = useState(false);
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
      <GameSettingsDialog open={open} onClose={() => setOpen(false)} room={room} game={game} />
    </>
  );
});

export default GameSettings;
