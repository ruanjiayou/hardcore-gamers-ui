import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { authStore } from './stores/auth'
import { initSocket, disconnectSocket, getSocket } from './services/socket';
import { Navbar } from './components/Navbar';
import { LoginPage } from './pages/Login'
import { LobbyPage } from './pages/Lobby';
import { GamePage } from './pages/Game';
import { RoomPage } from './pages/Room';
import { Notifications } from './components/Notifications';
import './styles/index.css';

function AuthGuard({ children, isReady, setIsReady }: { children: React.ReactNode, isReady: boolean, setIsReady: Function }) {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const initializeApp = async () => {
      // 如果没有 userId，说明未登陆，显示登陆页
      if (!authStore.user_id) {
        setIsReady(true);
        return;
      }

      try {
        setIsLoading(true);
        console.log('🔄 初始化应用...');
        console.log('📍 user_id:', authStore.user_id);

        // 1. 初始化 Socket 连接
        console.log('🔌 正在连接 WebSocket...');
        const { success, error } = await initSocket();
        console.log(success, error)
        if (success) {
          // 2. 加载用户信息
          console.log('📊 正在加载用户信息...');
          await loadUserInfo();
          console.log('✅ 用户信息加载完成');
          // 3. 标记为就绪
          setIsReady(true);
          console.log('🎉 应用初始化完成');
        } else if (error?.message === '验证失败') {
          navigate('/login')
        }
      } catch (error) {
        console.error('❌ 应用初始化失败:', error);
        // 初始化失败时，仍然标记为就绪，显示登陆页
        setIsReady(true);
      } finally {
        setIsLoading(false);
      }
    };
    if (!isReady) {
      initializeApp();
    }


    return () => {
      disconnectSocket();
    };
  }, [authStore.user_id]);

  // 加载用户信息
  const loadUserInfo = async () => {
    return new Promise((resolve, reject) => {
      const socket = getSocket();

      if (!socket) {
        reject(new Error('Socket 未初始化'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('获取用户信息超时'));
      }, 5000);

      socket.emit('lobby:get-user-info', (userInfo: any) => {
        clearTimeout(timeout);

        if (userInfo) {
          authStore.user = userInfo;
          console.log('👤 用户信息:', userInfo.name);
          resolve(null);
        } else {
          reject(new Error('用户信息为空'));
        }
      });
    });
  };
  console.log(isLoading, isReady)
  // 加载中状态
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '4px solid rgba(255, 255, 255, 0.3)',
          borderTopColor: 'white',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }}></div>
        <p style={{
          color: 'white',
          fontSize: '16px',
          fontWeight: '600'
        }}>
          {authStore.user_id ? '初始化中...' : '准备中...'}
        </p>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }
  return <>{children}</>;
}

export const App = observer(() => {
  const [isReady, setIsReady] = useState(false);
  return (
    <BrowserRouter>
      <div className="app">
        <Notifications />

        {/* 只有登陆的用户才显示导航栏 */}
        {authStore.isLoggedIn && <Navbar />}

        {/* 路由 */}
        <AuthGuard isReady={isReady} setIsReady={setIsReady}>
          <Routes>
            {isReady ? <>
              {/* 已登陆的路由 */}
              <Route path="/lobby" element={<LobbyPage />} />
              <Route path="/game/:gameId" element={<GamePage />} />
              <Route path="/room/:roomId" element={<RoomPage />} />
              <Route path="/login" element={<Navigate to="/lobby" />} />
              <Route path="/" element={<Navigate to="/lobby" />} />
              <Route path="*" element={<Navigate to="/lobby" />} />
            </> : <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/login" />} />
            </>}
          </Routes>
        </AuthGuard>
      </div>
    </BrowserRouter>
  );
});

export default App;