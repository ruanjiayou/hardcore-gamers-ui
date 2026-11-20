import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { loginUrl } from './LoginRequired';
import '../styles/navbar.css';

/**
 * 右上角用户区：登录后是下拉菜单（昵称/退出登录），未登录显示「未登录 + 登录」。
 * 大厅导航栏与游戏页标题栏共用，保证两处观感完全一致。
 */
export const UserMenu = observer(() => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = () => {
    store.auth.logout();
    setDropdownOpen(false);
    // 退出后不跳登录页：以游客身份继续浏览大厅（App 会用匿名身份重连 socket）
    navigate('/lobby');
  };

  return (
    <div className="navbar-user">
      {/* 连接状态 */}
      <div className="connection-status">
        <span className="status-dot"></span>
      </div>

      {store.auth.isLoggedIn ? (
        <div className="user-dropdown">
          <button
            className="user-button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className="user-avatar">👤</span>
            <span className="user-name">{store.auth.user?.name || '-'}</span>
            <span className="dropdown-icon">▼</span>
          </button>

          {dropdownOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-item">
                <span>👤 个人资料</span>
              </div>
              <div className="dropdown-item">
                <span>📊 游戏统计</span>
              </div>
              <div className="dropdown-divider"></div>
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
        /* 游客：只展示未登录状态，登录入口留给用户主动点击 */
        <div className="guest-area">
          <span className="guest-badge">👤 未登录</span>
          <button className="login-entry" onClick={() => navigate(loginUrl('/lobby'))}>登录</button>
        </div>
      )}
    </div>
  );
});

export default UserMenu;
