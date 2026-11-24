import React from 'react';
import { observer } from 'mobx-react-lite';
import { UserMenu } from './UserMenu';
import { GameSettings, type SettingsRoom } from './GameSettings';
import '../styles/game-header.css';

/**
 * 游戏页/房间页专属顶栏。大厅的「🎮 游戏大厅 + 导航」不再出现在游戏里。
 *
 * - mode='game'（游戏主页）：左侧「返回 + 游戏名称」，名称靠左、不显示 logo；
 *   右侧只留头像（用户菜单入口），**设置按钮改成右下角悬浮**（拇指够得着、不占顶栏）。
 * - mode='room'（房间/对局）：左侧只有关闭按钮，右侧只有设置按钮；
 *   顶部中间不显示游戏名称，把空间完整留给棋盘。
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
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  extra?: React.ReactNode;
  /** game=游戏主页（名称靠左 + 头像）；room=房间/对局（左上关闭 + 右上设置） */
  mode?: 'game' | 'room';
  /** 房间页传入：设置弹框里显示观战/计时配置 */
  settingsRoom?: SettingsRoom;
  /** 关闭按钮的无障碍标签（按场景：退出游戏 / 退出房间 / 结束游戏） */
  closeLabel?: string;
  /** 游戏主页传入当前 slug：右上角菜单的公开主页会锁定这个游戏 */
  profileGame?: string;
}) => (
  <header className={`game-header game-header-${mode}`}>
    <div className="game-header-left">
      <button
        className={`game-back${mode === 'room' ? ' is-close' : ''}`}
        onClick={onBack}
        aria-label={mode === 'room' ? (closeLabel || '关闭房间') : '返回大厅'}
      >
        {mode === 'room'
          ? <span className="game-back-close" aria-hidden>×</span>
          : <span className="game-back-arrow" />}
      </button>
      {mode === 'game' && (
        <div className="game-header-title">
          <span className="game-header-name">{title}</span>
          {subtitle ? <span className="game-header-sub">{subtitle}</span> : null}
        </div>
      )}
    </div>

    <div className="game-header-right">
      {extra}
      {/* 房间/对局：设置留在顶栏右上；游戏主页：设置改成右下角悬浮（game-settings-fab） */}
      {mode === 'room' && <GameSettings room={settingsRoom} />}
      {/* 游戏主页右上角：玩家昵称 + 头像（点开是个人中心 / 公开主页，见 UI-046） */}
      {mode === 'game' && <UserMenu showName profileGame={profileGame} />}
    </div>

    {/* 游戏主页的设置按钮放右下角悬浮：不占顶栏位置，拇指够得着 */}
    {mode === 'game' && (
      <div className="game-settings-fab">
        <GameSettings />
      </div>
    )}
  </header>
));

export default GameHeader;
