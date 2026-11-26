import React from 'react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { Notifications } from '../components/Notifications';
import { LoginRequiredModal } from '../components/LoginRequired';
import { Navbar } from '../components/Navbar';
import { go, registerEntryNav } from '../navigation';
import AppBootstrap from './AppBootstrap';

/** 在 Router 内把 navigate 交给 navigation.ts：同入口跳转走 push，跨入口仍整页。 */
function NavBridge({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  registerEntryNav(navigate);
  return <>{children}</>;
}

/** 公共外壳：所有入口共用同一套外壳，路由与内容由 children 决定。 */
export function AppFrame({ children, basename, showNavbar = true }: {
  children: React.ReactNode, basename: string, showNavbar?: boolean
}) {
  const [isReady, setIsReady] = React.useState(false);
  return (
    <BrowserRouter basename={basename}>
      <NavBridge>
        <div className="app">
          <Notifications />
          <LoginRequiredModal />

          {/* 公共入口常驻导航栏；游戏入口有自己的标题栏，由 showNavbar=false 关掉 */}
          {showNavbar && <Navbar />}

          <AppBootstrap isReady={isReady} setIsReady={setIsReady} onNavigate={go}>
            {children}
          </AppBootstrap>
        </div>
      </NavBridge>
    </BrowserRouter>
  );
}

export default AppFrame;
