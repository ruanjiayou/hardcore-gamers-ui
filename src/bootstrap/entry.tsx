import React from 'react';
import ReactDOM from 'react-dom/client';
import AppFrame from './AppFrame';

/** 各入口统一的挂载函数：注入路由内容与该入口的 basename。 */
export function mountEntry(children: React.ReactNode, basename: string, options?: { showNavbar?: boolean }) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <AppFrame basename={basename} showNavbar={options?.showNavbar}>{children}</AppFrame>
  );
}
