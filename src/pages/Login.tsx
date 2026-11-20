import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import store from '../stores'
import { notificationManager } from '../components/Notifications';
import '../styles/login.css';
import '../styles/components.css';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // 从游戏页/房间页被拦下来的，登录后回原页面
  const redirect = new URLSearchParams(location.search).get('redirect');
  const goBack = () => navigate(redirect && redirect !== '/login' ? redirect : '/lobby', { replace: true });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await axios.post('/api/oauth/login', {
        name: username,
        pass: password
      });

      if (response.data.code === 0) {
        store.auth.setLogin(response.data.data.token.access_token);
        store.auth.setUser(response.data.data.user);
        // socket 由应用外壳按新 token 重连，这里只需回跳
        goBack();
      } else {
        notificationManager.show(response.data.message || '登陆失败', 'warning');
      }
    } catch (error: any) {
      console.error('登陆失败:', error);
      notificationManager.show(error?.response?.data?.message || '登陆失败，请稍后再试', 'warning');
    } finally {
      setLoading(false);
    }
  };

  /** 游客访问：不再伪造游客身份，直接以未登录状态浏览大厅（进入游戏时再提示登录） */
  const handleGuest = () => {
    navigate('/lobby', { replace: true });
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>🎮 游戏大厅</h1>
        <p>加入游戏社区，开始你的冒险之旅</p>

        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="玩家名称"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className='two-column'>

            <button type="submit" disabled={loading}>
              {loading ? '登陆中...' : '登陆'}
            </button>

            <button type="button" className="guest-btn" onClick={handleGuest}>
              先随便看看
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
