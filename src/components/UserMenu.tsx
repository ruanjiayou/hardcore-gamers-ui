import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { loginUrl } from './LoginRequired';
import '../styles/navbar.css';

/**
 * 右上角用户区：登录后是一个无边框的头像按钮，点击展开菜单（昵称在第一排）；
 * 未登录显示同一个头像 + 登录入口。
 * 连接状态不再用独立的小绿点：在线时头像带绿色辉光，断线时头像整体转黑白、
 * 沿一条**闪电形折线**竖着裂成两半（只有一条裂缝，不是多块碎片）。
 * 大厅导航栏与游戏页/房间页标题栏共用，所有页面观感一致。
 *
 * showName：游戏主页顶栏要在头像**左边**显示昵称（UI-046）。
 */
export const UserMenu = observer(({ showName = false, profileGame = '' }: { showName?: boolean, profileGame?: string }) => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
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
            {/* 游戏主页顶栏：昵称在头像左边 */}
            {showName && <span className="user-button-name">{name}</span>}
            {statusAvatar}
          </button>

          {dropdownOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-identity">
                <span className="dropdown-identity-name">{name}</span>
                <span className="dropdown-identity-tag">玩家</span>
              </div>
              <div className="dropdown-divider"></div>
              {/* 个人资料升级为「个人中心」：可改昵称/头像/手机/邮箱/密码 */}
              <div
                className="dropdown-item"
                onClick={() => { setDropdownOpen(false); navigate('/me'); }}
              >
                <span>👤 个人中心</span>
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
              {/* 语音包/背景音乐已收进游戏右上角的设置弹框，用户菜单不再重复入口 */}
              <div
                className="dropdown-item danger"
                onClick={handleLogout}
              >
                <span>🚪 退出登陆</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 游客：同样的状态头像，登录入口留给用户主动点击 */
        <div className="guest-area">
          {statusAvatar}
          <button className="login-entry" onClick={() => navigate(loginUrl('/lobby'))}>登录</button>
        </div>
      )}
    </div>
  );
});

export default UserMenu;
