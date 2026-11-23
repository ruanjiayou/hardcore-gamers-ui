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
 * 沿中线竖着裂成两半（只有一条裂缝，不是多块碎片）。
 * 大厅导航栏与游戏页/房间页标题栏共用，所有页面观感一致。
 */
export const UserMenu = observer(() => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const connected = store.ui.socketConnected;
  const name = store.auth.user?.name || '-';
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
        // 断线：同一张图切成左右两半、中间留一条竖缝，只裂一次；整体 grayscale 走 CSS filter
        <>
          <img className="avatar-image avatar-half avatar-half-left" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
          <img className="avatar-image avatar-half avatar-half-right" src={avatarUrl} alt="" onError={() => setAvatarBroken(true)} />
        </>
      )}
      {!hasAvatar && <span className="avatar-face" aria-hidden>👤</span>}
      {!connected && <span className="avatar-crack-line" aria-hidden />}
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
              <div className="dropdown-item">
                <span>👤 个人资料</span>
              </div>
              <div className="dropdown-item">
                <span>📊 游戏统计</span>
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
