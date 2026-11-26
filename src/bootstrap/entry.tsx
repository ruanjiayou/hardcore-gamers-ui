import React from 'react';
import ReactDOM from 'react-dom/client';
import AppFrame from './AppFrame';
import { ensureSocket } from '../services/socket';
import { installSoftNavPopstate } from '../navigation';
import { registerPwa } from '../services/pwa';

/** 各入口统一的挂载函数：注入路由内容与该入口的 basename。 */
export function mountEntry(children: React.ReactNode, basename: string, options?: { showNavbar?: boolean }) {
  // UI-079：挂载前先建好 socket 实例，热导航期间页面 effect 不会拿到 null
  ensureSocket();
  installSoftNavPopstate();
  registerPwa();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <AppFrame basename={basename} showNavbar={options?.showNavbar}>{children}</AppFrame>
  );
}
