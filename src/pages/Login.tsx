import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import store from '../stores'
import { initSocket } from '../services/socket';
import '../styles/login.css';
import '../styles/components.css';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await axios.post('/api/oauth/login', {
        name: username,
        pass: password
      });

      if (response.data.code === 0) {
        store.auth.setLogin(response.data.data.user, response.data.data.token);
        await initSocket();
        navigate('/lobby');
      }
    } catch (error) {
      console.error('登陆失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    const guestId = `Guest_${Date.now()}`;
    store.auth.setGuest(guestId);
    await initSocket();
    navigate('/lobby');
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

            <button className="guest-btn" onClick={handleGuest}>
              游客访问
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}