import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { authStore } from '../stores/auth'
import '../styles/navbar.css';

export const Navbar = observer(() => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = () => {
    authStore.logout();
    setDropdownOpen(false);
    navigate('/login');
  };

  const handleLogoClick = (e:any) => {
    e.preventDefault();
    if (window.location.pathname !== '/lobby') {
      navigate('/lobby');
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* Logo */}
        <div className="navbar-brand" onClick={handleLogoClick}>
          🎮 游戏大厅
        </div>

        {/* 导航菜单 */}
        <div className="navbar-menu">
          <a className="nav-link" onClick={handleLogoClick}>大厅</a>
        </div>

        {/* 用户菜单 */}
        <div className="navbar-user">
          {/* 连接状态 */}
          <div className="connection-status">
            <span className="status-dot"></span>
            <span className="status-text">已连接</span>
          </div>

          {/* 用户下拉菜单 */}
          <div className="user-dropdown">
            <button
              className="user-button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <span className="user-avatar">👤</span>
              <span className="user-name">{authStore.user?.name || authStore.user_id}</span>
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
        </div>
      </div>
    </nav>
  );
});