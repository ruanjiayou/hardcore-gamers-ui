import React from 'react';
import { observer } from 'mobx-react-lite';
import { UserMenu } from './UserMenu';
import '../styles/game-header.css';

/**
 * 游戏页/房间页专属顶栏。大厅的「🎮 游戏大厅 + 导航」不再出现在游戏里。
 *
 * 两种形态：
 * - close=true（游戏主页）：左侧「游戏 logo + 游戏名」，右侧「用户区 + 关闭（回大厅）」；
 * - close=false（房间页）：左侧「返回箭头 + 游戏名（房间名）」，右侧「用户区」。
 */
export const GameHeader = observer(({
  title,
  subtitle,
  icon,
  onBack,
  extra,
  close = false,
}: {
  title: string;
  subtitle?: string;
  /** 游戏 logo（emoji），close 形态下显示在标题左边 */
  icon?: string;
  onBack: () => void;
  extra?: React.ReactNode;
  /** true 时右侧显示关闭（✕）而不是左侧返回箭头：用于游戏主页回大厅 */
  close?: boolean;
}) => (
  <header className="game-header">
    <div className="game-header-left">
      {close ? (
        <span className="game-header-logo" aria-hidden>{icon || '🎮'}</span>
      ) : (
        <button className="game-back" onClick={onBack} aria-label="返回">
          <span className="game-back-arrow" />
        </button>
      )}
      <div className="game-header-title">
        <span className="game-header-name">{title}</span>
        {subtitle ? <span className="game-header-sub">{subtitle}</span> : null}
      </div>
    </div>

    <div className="game-header-right">
      {extra}
      <UserMenu />
      {close ? (
        <button className="game-close" onClick={onBack} aria-label="关闭并回到大厅">
          <span className="game-close-x" />
        </button>
      ) : null}
    </div>
  </header>
));

export default GameHeader;
