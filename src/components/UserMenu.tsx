import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { loginUrl } from './LoginRequired';
import { GameSettingsDialog } from './GameSettings';
import '../styles/navbar.css';

/**
 * 右上角用户区：登录后是一个无边框的头像按钮，点击展开菜单（昵称在第一排）；
 * 未登录显示同一个头像 + 登录入口。
 * 连接状态不再用独立的小绿点：在线时头像带绿色辉光，断线时头像整体转黑白、
 * 沿一条**闪电形折线**竖着裂成两半（只有一条裂缝，不是多块碎片）。
 * 大厅导航栏与游戏页/房间页标题栏共用，所有页面观感一致。
 *
 * scope：区分下拉里的第一项叫法（UI-050）——
 *   'lobby' 大厅 →「👤 个人中心」；'game' 单个游戏里 →「👤 玩家中心」。
 * 游戏里还多一项「⚙ 游戏设置」，打开与顶栏齿轮同一个设置弹框。
 * 头像左侧**不再显示昵称**（UI-050），昵称只在下拉菜单第一排。
 */
export const UserMenu = observer(({ scope = 'lobby', profileGame = '' }: { scope?: 'lobby' | 'game', profileGame?: string }) => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const connected = store.ui.socketConnected;
  const name = store.auth.displayName;
  const avatarUrl = store.auth.user?.avatar;

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
    // 退出后不跳登录页：以游客身份继续浏览大厅（App 会用匿名身份重连 socket）
    navigate('/lobby');
  };

  const hasAvatar = !!avatarUrl && !avatarBroken;
  const statusAvatar = (
    <span className={`status-avatar ${connected ? 'is-connected' : 'is-offline'}`} title={connected ? '已连接' : '连接已断开'}>
      {hasAvatar && connected && (
        <img className="avatar-image" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
      )}
      {hasAvatar && !connected && (
        // 断线：同一张图沿闪电形折线切成左右两半、中间留一条缝，只裂一次；整体 grayscale 走 CSS filter
        <>
          <img className="avatar-image avatar-half avatar-half-left" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
          <img className="avatar-image avatar-half avatar-half-right" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
        </>
      )}
      {!hasAvatar && <span className="avatar-face" aria-hidden>👤</span>}
      {!connected && (
        /* 裂缝本体：深色折线 + 一侧亮边，坐标与 CSS clip-path 的折线拐点一一对应 */
        <svg className="avatar-crack-svg" viewBox="0 0 36 36" preserveAspectRatio="none" aria-hidden>
          <polyline className="crack-dark" points="18,0 21.6,7.9 15.5,16.2 20.5,24.5 16.6,31 18,36" />
          <polyline className="crack-light" points="19.1,0 22.7,7.9 16.6,16.2 21.6,24.5 17.7,31 19.1,36" />
        </svg>
      )}
    </span>
  );

  return (
    <div className="navbar-user">
      {store.auth.isLoggedIn ? (
        <div className="user-dropdown" ref={dropdownRef}>
          <button
            className="user-button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-label="用户菜单"
            aria-expanded={dropdownOpen}
          >
            {statusAvatar}
          </button>

          {dropdownOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-identity">
                <span className="dropdown-identity-name">{name}</span>
                <span className="dropdown-identity-tag">玩家</span>
              </div>
              <div className="dropdown-divider"></div>
              {/* 单个游戏里叫「玩家中心」，大厅里叫「个人中心」（UI-050）。
                  从某个游戏进去时带上 game 参数：玩家中心里的「公开主页」要锁到本游戏。 */}
              <div
                className="dropdown-item"
                onClick={() => { setDropdownOpen(false); navigate(profileGame ? `/me?game=${profileGame}` : '/me'); }}
              >
                <span>{scope === 'game' ? '👤 玩家中心' : '👤 个人中心'}</span>
              </div>
              {/* 公开主页：在某个游戏主页点开时锁定该游戏（只显示这个游戏的战绩/记录） */}
              <div
                className="dropdown-item"
                onClick={() => {
                  setDropdownOpen(false);
                  const id = store.auth.user?._id;
                  if (id) navigate(`/user/${id}${profileGame ? `?game=${profileGame}` : ''}`);
                }}
              >
                <span>📊 {profileGame ? '本游戏战绩' : '公开主页'}</span>
              </div>
              {/* 游戏设置：游戏主页的设置入口（原右下角悬浮齿轮已删，UI-050） */}
              {scope === 'game' && (
                <div
                  className="dropdown-item"
                  onClick={() => { setDropdownOpen(false); setSettingsOpen(true); }}
                >
                  <span>⚙ 游戏设置</span>
                </div>
              )}
              {/* 语音包/背景音乐已收进游戏设置弹框，用户菜单不再重复入口 */}
              <div
                className="dropdown-item danger"
                onClick={handleLogout}
              >
                <span>🚪 退出登陆</span>
              </div>
            </div>
          )}

          {/* 设置弹框与顶栏齿轮共用同一个组件（UI-050）；外观分区按当前游戏走 */}
          <GameSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} game={profileGame} />
        </div>
      ) : (
        /* 游客：只显示登录按钮。
           裂缝头像是「已登录但 ws 没连上」的状态提示，游客本来就没登录，
           显示一个裂开的头像只会让人误以为自己掉线了。 */
        <div className="guest-area">
          <button className="login-entry" onClick={() => navigate(loginUrl('/lobby'))}>登录</button>
        </div>
      )}
    </div>
  );
});

export default UserMenu;
