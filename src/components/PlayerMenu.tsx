import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { gameUrl, go, lobbyUrl, loginUrl, playerUrl } from '../navigation';
import { GameSettingsDialog } from './GameSettings';
import '../styles/navbar.css';

/**
 * 游戏入口的玩家菜单（player 表，UI-109）：头像 / 昵称 / 等级取当前游戏的 player，
 * 菜单是「玩家中心」「本游戏战绩」「游戏设置」「退出登陆」。
 * 大厅的用户菜单在 `components/UserMenu.tsx`（user 表），两者不共文件。
 */
export const PlayerMenu = observer(({ slug }: { slug: string }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const connected = store.ui.socketConnected;
  const name = store.game.player?.nickname || '玩家';
  const avatarUrl = store.game.player?.avatar;
  const level = store.game.player?.level ?? 1;

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [dropdownOpen]);

  const handleLogout = () => {
    store.auth.logout();
    setDropdownOpen(false);
    go(lobbyUrl());
  };

  const hasAvatar = !!avatarUrl && !avatarBroken;
  // 外层再包一层 relative：status-avatar 自己 overflow:hidden（裁圆头像），
  // 等级 badge 必须放在它外面才不会被裁掉（UI-067）
  const statusAvatar = (
    <span className="avatar-with-level">
      <span className={`status-avatar ${connected ? 'is-connected' : 'is-offline'}`} title={connected ? '已连接' : '连接已断开'}>
        {hasAvatar && connected && (
          <img className="avatar-image" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
        )}
        {hasAvatar && !connected && (
          <>
            <img className="avatar-image avatar-half avatar-half-left" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
            <img className="avatar-image avatar-half avatar-half-right" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
          </>
        )}
        {!hasAvatar && <span className="avatar-face" aria-hidden>👤</span>}
        {!connected && (
          <svg className="avatar-crack-svg" viewBox="0 0 36 36" preserveAspectRatio="none" aria-hidden>
            <polyline className="crack-dark" points="18,0 21.6,7.9 15.5,16.2 20.5,24.5 16.6,31 18,36" />
            <polyline className="crack-light" points="19.1,0 22.7,7.9 16.6,16.2 21.6,24.5 17.7,31 19.1,36" />
          </svg>
        )}
      </span>
      <em className="avatar-level-badge">Lv.{level}</em>
    </span>
  );

  return (
    <div className="navbar-user">
      {store.auth.isLoggedIn ? (
        <div className="user-dropdown" ref={dropdownRef}>
          <button
            className="user-button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-label="玩家菜单"
            aria-expanded={dropdownOpen}
          >
            {statusAvatar}
            <span className="user-button-name">{name}</span>
          </button>

          {dropdownOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-identity">
                <span className="dropdown-identity-name">{name}</span>
                <span className="dropdown-identity-tag">玩家</span>
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-item" onClick={() => { setDropdownOpen(false); go(gameUrl(slug, 'me')); }}>
                <span>👤 玩家中心</span>
              </div>
              <div
                className="dropdown-item"
                onClick={() => {
                  setDropdownOpen(false);
                  const pid = store.game.player_id;
                  // player_id 异步加载，未就绪时先去玩家中心（那里会取当前 player）
                  go(pid ? playerUrl(slug, pid) : gameUrl(slug, 'me'));
                }}
              >
                <span>📊 本游戏战绩</span>
              </div>
              <div
                className="dropdown-item"
                onClick={() => { setDropdownOpen(false); setSettingsOpen(true); }}
              >
                <span>⚙ 游戏设置</span>
              </div>
              <div className="dropdown-item danger" onClick={handleLogout}>
                <span>🚪 退出登陆</span>
              </div>
            </div>
          )}

          <GameSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} game={slug} />
        </div>
      ) : (
        <div className="guest-area">
          <button className="login-entry" onClick={() => go(loginUrl())}>登录</button>
        </div>
      )}
    </div>
  );
});

export default PlayerMenu;
