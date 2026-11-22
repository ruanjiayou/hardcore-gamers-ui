import React from 'react';
import { observer } from 'mobx-react-lite';
import { UserMenu } from './UserMenu';
import '../styles/game-header.css';

/**
 * 游戏页/房间页专属顶栏。大厅的「🎮 游戏大厅 + 导航」不再出现在游戏里。
 *
 * 两种形态共用同一个返回尖括号：
 * - close=true（游戏主页）：左侧「返回尖括号 + 游戏 logo + 游戏名」，右侧只有用户区；
 * - close=false（房间页）：左侧「返回尖括号 + 游戏名（房间名）」，右侧只有用户区。
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
  /** 游戏 logo（emoji），close 形态下显示在返回按钮与标题之间 */
  icon?: string;
  onBack: () => void;
  extra?: React.ReactNode;
  /** true 时额外显示游戏 logo：用于游戏主页 */
  close?: boolean;
}) => (
  <header className="game-header">
    <div className="game-header-left">
      <button className="game-back" onClick={onBack} aria-label={close ? '返回大厅' : '返回'}>
        <span className="game-back-arrow" />
      </button>
      {close ? (
        <span className="game-header-logo" aria-hidden>{icon || '🎮'}</span>
      ) : null}
      <div className="game-header-title">
        <span className="game-header-name">{title}</span>
        {subtitle ? <span className="game-header-sub">{subtitle}</span> : null}
      </div>
    </div>

    <div className="game-header-right">
      {extra}
      <UserMenu />
    </div>
  </header>
));

export default GameHeader;
