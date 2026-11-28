import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import { getManifest, subscribeAssets, loadGameAssets, markEquipped } from '../services/assets';
import { assetSections, type AssetSection } from '../services/assetSections';
import { equipSkin, type AssetManifest, type AssetManifestItem } from '../services/api';
import SkinPreview from './SkinPreview';
import '../styles/game-settings.css';

/**
 * 游戏页统一设置：齿轮按钮（房间/对局顶栏）+ 弹框。
 * 弹框本体是受控的 GameSettingsDialog，游戏主页的入口已下沉到头像下拉菜单
 * 「⚙ 游戏设置」（UI-050），两边共用同一份弹框。
 * 把原先散落各处的配置收进一个对话框：
 * - 背景音乐（音量 / 开关）——只控 BGM，不影响落子等操作音（UI-105：已移除「下一首」按钮）
 * - 资源包选择（无权限锁定默认包）
 * - **本游戏的外观分区**（按 manifest 动态渲染：分组名由资源表给，画风/音效按主题决定）
 * - 观战开关（房间等待态房主）
 * - 计时配置（象棋房间等待态）
 *
 * **按游戏隔离**：外观分区和音效都跟着当前游戏走 —— 黑白棋的弹框里不会出现
 * 贪吃蛇的皮肤配置，因为服务端只下发当前游戏那一份资源。
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
  game: gameProp,
}: {
  /** 受控开关：顶栏齿轮按钮与头像下拉菜单「⚙ 游戏设置」共用这一份弹框 */
  open: boolean;
  onClose: () => void;
  room?: SettingsRoom;
  /** 当前游戏 slug：外观分区/音效按它走；不传就用音频 store 里记着的当前游戏 */
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

  /**
   * 当前游戏 slug。
   * **不写死 'snake'**：没有游戏上下文就不显示任何外观分区，
   * 免得在黑白棋的设置里冒出贪吃蛇的皮肤配置。
   */
  const game = gameProp || audio.currentGame || '';
  const [manifest, setManifest] = useState<AssetManifest | null>(() => getManifest(game) || null);

  // 换游戏/后台改资源后清单会变，统一从 manifest 同步
  useEffect(() => {
    let alive = true;
    setManifest(getManifest(game) || null);
    loadGameAssets(game).then(m => { if (alive && m) setManifest(m); });
    // UI-111：其他页面换装后这里也立即换选中态
    const unsubscribe = subscribeAssets(game, () => {
      if (alive) setManifest(getManifest(game) || null);
    });
    return () => { alive = false; unsubscribe(); };
  }, [game]);

  /** 当前装备的外观 asset_id（按分区取，空 = 用默认外观） */
  const equippedIdOf = (group: string) => manifest?.equippedByGroup?.[group] || '';
  /** 本游戏要显示的外观分区（按清单实际内容算） */
  const sections: AssetSection[] = manifest
    ? assetSections(game, Object.keys(manifest.groups || {}))
    : [];

  const chooseSkin = async (item: AssetManifestItem) => {
    if (!store.auth.isLoggedIn) { setMessage('登录后才能更换外观'); return; }
    if (!item.owned) { setMessage('还没有这个外观，先在后台授予或活动获取'); return; }
    const slot = item.group === 'corpse' ? 'corpse' : 'skin';
    setSaving(true);
    try {
      const res = await equipSkin(game, item.id, slot);
      if (res.data?.code !== 0) { setMessage(res.data?.message || '保存失败'); return; }
      // UI-111：不可变更新 + 广播，选中态与主页预览当场切换
      setManifest(markEquipped(game, item.id, item.group === 'corpse' ? 'corpse' : 'snake') || getManifest(game) || null);
      setMessage('外观已更新');
    } catch (err: any) {
      setMessage(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

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

        {/* 外观分区：按当前游戏的资源清单动态渲染（分组名由资源表给，互不串台） */}
        {sections.map(section => {
          const items = manifest?.groups?.[section.group]?.items || [];
          if (!items.length) return null;
          return (
            <section className="settings-section" key={section.group}>
              <h4>{section.icon} {section.title}</h4>
              <div className="settings-packs">
                {items.map(item => {
                  const active = item.id === equippedIdOf(section.group);
                  // GM-snake-39：皮肤画一条迷你蛇（能看出有没有头/尾、身体是否交替），
                  // 其它外观（残骸）还是用原图缩略
                  const swatch = section.group === 'snake'
                    ? <SkinPreview game={game} item={item} />
                    : <img className="settings-skin-swatch" src={item.url} alt={item.label} />;
                  const name = <span className="settings-pack-name">{item.label}</span>;
                  // 主题资源（食物、道具、棋盘…）随包整体生效，玩家不能单独换 → 只展示
                  if (!item.equippable) {
                    return (
                      <div className="settings-pack static" key={item.id} title={`${item.label}（随资源包生效）`}>
                        {swatch}
                        {name}
                      </div>
                    );
                  }
                  // 玩家级外观：可装备
                  return (
                    <button
                      key={item.id}
                      className={`settings-pack${active ? ' active' : ''}${item.owned ? '' : ' locked'}`}
                      onClick={() => chooseSkin(item)}
                      disabled={saving}
                      title={item.owned ? item.label : `${item.label}（未获得）`}
                    >
                      {swatch}
                      {name}
                      {active ? <em>使用中</em> : (!item.owned ? <em>未获得</em> : null)}
                    </button>
                  );
                })}
              </div>
              <p className="settings-hint">外观存在本游戏的玩家档案里；没配图的资源会自动回退矢量外观。</p>
            </section>
          );
        })}

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
