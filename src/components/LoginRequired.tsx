import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import '../styles/components.css';

/** 带回调的登录地址：登录成功后回到当前页面 */
export function loginUrl(from: string) {
  return `/login?redirect=${encodeURIComponent(from)}`;
}

/** 未登录操作拦截弹窗（大厅里点游戏、加入房间等） */
export const LoginRequiredModal = observer(() => {
  const navigate = useNavigate();
  const location = useLocation();
  if (!store.ui.loginPromptOpen) return null;

  const goLogin = () => {
    store.ui.closeLoginPrompt();
    navigate(loginUrl(location.pathname + location.search));
  };

  return (
    <div className="login-gate-mask" onClick={() => store.ui.closeLoginPrompt()}>
      <div className="login-gate-card" onClick={(e) => e.stopPropagation()}>
        <div className="login-gate-icon">🔒</div>
        <h3>需要登录</h3>
        <p>{store.ui.loginPromptText}</p>
        <div className="login-gate-actions">
          <button className="ghost" onClick={() => store.ui.closeLoginPrompt()}>先看看</button>
          <button className="primary" onClick={goLogin}>去登录</button>
        </div>
      </div>
    </div>
  );
});

/** 整页版的登录提示（直接打开游戏页/房间页时用） */
export const LoginRequiredPanel = observer(({ title, desc }: { title?: string; desc?: string }) => {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="login-gate-page">
      <div className="login-gate-card">
        <div className="login-gate-icon">🔒</div>
        <h3>{title || '需要登录'}</h3>
        <p>{desc || '登录后才能进入游戏'}</p>
        <div className="login-gate-actions">
          <button className="ghost" onClick={() => navigate('/lobby')}>回大厅</button>
          <button className="primary" onClick={() => navigate(loginUrl(location.pathname + location.search))}>去登录</button>
        </div>
      </div>
    </div>
  );
});
