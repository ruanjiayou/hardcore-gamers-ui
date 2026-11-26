import React from 'react';
import { observer } from 'mobx-react-lite';
import { UserMenu } from './UserMenu';
import '../styles/game-header.css';

/**
 * 游戏页/房间页专属顶栏。大厅的「🎮 游戏大厅 + 导航」不再出现在游戏里。
 *
 * - mode='game'（游戏主页）：**左**头像下拉（`UserMenu`）；**中/右业务入口由各游戏主页传入**
 *   （`center` / `extra`，UI-076 按游戏隔离：商店/皮肤只有贪吃蛇、好友不在单人游戏出现）；**最右**关闭按钮。
 * - mode='room'（房间/对局）：左侧只有关闭按钮；右侧不再显示设置按钮（UI-070）。
 *
 * 公共部分只剩头像下拉 + 关闭按钮；好友/设置等业务组件不再内置（UI-076）。
 */
export const GameHeader = observer(({
  title,
  subtitle,
  onBack,
  extra,
  mode = 'game',
  settingsRoom,
  closeLabel,
  profileGame,
  center,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  extra?: React.ReactNode;
  /** game=游戏主页（左头像 + 中商店榜单 + 右好友/设置/关闭）；room=房间/对局（左上关闭） */
  mode?: 'game' | 'room';
  /** 保留兼容：房间设置已不在顶栏露出（UI-070） */
  settingsRoom?: any;
  /** 关闭按钮的无障碍标签（按场景：退出游戏 / 退出房间 / 结束游戏） */
  closeLabel?: string;
  /** 游戏主页传入当前 slug：右上角菜单的公开主页会锁定这个游戏 */
  profileGame?: string;
  /** 顶栏中间内容（商店 / 排行榜入口，由各游戏主页决定） */
  center?: React.ReactNode;
}) => {
  return (
    <header className={`game-header game-header-${mode}`}>
      <div className="game-header-left">
        {mode === 'game' ? (
          <UserMenu scope="game" profileGame={profileGame} showName />
        ) : (
          <button
            className="game-back is-close"
            onClick={onBack}
            aria-label={closeLabel || '关闭房间'}
          >
            <span className="game-back-close" aria-hidden>×</span>
          </button>
        )}
      </div>

      {mode === 'game' && <div className="game-header-center">{center}</div>}

      <div className="game-header-right">
        {/* 业务入口由各游戏主页通过 extra 传入（UI-076），公共部分不渲染好友/设置 */}
        {extra}
        {mode === 'game' && (
          <button className="game-back game-header-close" onClick={onBack} aria-label="关闭游戏">
            <span className="game-back-close" aria-hidden>×</span>
          </button>
        )}
      </div>
    </header>
  );
});

export default GameHeader;
