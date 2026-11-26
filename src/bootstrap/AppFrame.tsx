import React, { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Notifications } from '../components/Notifications';
import { LoginRequiredModal } from '../components/LoginRequired';
import { Navbar } from '../components/Navbar';
import { go } from '../navigation';
import AppBootstrap from './AppBootstrap';

/** 公共外壳：所有入口共用同一套外壳，路由与内容由 children 决定。 */
export function AppFrame({ children, basename, showNavbar = true }: {
  children: React.ReactNode, basename: string, showNavbar?: boolean
}) {
  const [isReady, setIsReady] = useState(false);
  return (
    <BrowserRouter basename={basename}>
      <div className="app">
        <Notifications />
        <LoginRequiredModal />

        {/* 公共入口常驻导航栏；游戏入口有自己的标题栏，由 showNavbar=false 关掉 */}
        {showNavbar && <Navbar />}

        <AppBootstrap isReady={isReady} setIsReady={setIsReady} onNavigate={go}>
          {children}
        </AppBootstrap>
      </div>
    </BrowserRouter>
  );
}

export default AppFrame;
