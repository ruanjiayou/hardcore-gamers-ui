import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { UserMenu } from './UserMenu';
import '../styles/navbar.css';

export const Navbar = observer(() => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogoClick = (e: any) => {
    e.preventDefault();
    if (window.location.pathname !== '/lobby') {
      navigate('/lobby');
    }
  };

  // 登录页自带整套视觉，不叠导航栏
  if (location.pathname === '/login') return null;
  // 游戏页/房间页有自己的顶栏（返回 + 游戏名 + 用户区），不再叠大厅的 logo 与导航
  if (location.pathname.startsWith('/game')) return null;
  // 玩家中心 / 公开主页顶部不要「游戏大厅 + 用户头像」那一栏（UI-052）
  if (location.pathname === '/me' || location.pathname.startsWith('/user')) return null;

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* Logo */}
        <div className="navbar-brand" onClick={handleLogoClick}>
          🎮 游戏大厅
        </div>

        {/* 用户菜单 */}
        <UserMenu />
      </div>
    </nav>
  );
});

export default Navbar;
