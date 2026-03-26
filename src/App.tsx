import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from './stores'
import { initSocket, disconnectSocket, getSocket, ReceiveEvent } from './services/socket';
import { Navbar } from './components/Navbar';
import { LoginPage } from './pages/Login'
import { LobbyPage } from './pages/Lobby';
import { GamePage } from './pages/Game';
import { RoomPage } from './pages/Room';
import { Notifications } from './components/Notifications';
import './styles/index.css';
import Loading from './components/Loading';

function AuthGuard({ children, isReady, setIsReady }: { children: React.ReactNode, isReady: boolean, setIsReady: Function }) {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const initializeApp = async () => {
      // 如果没有 userId，说明未登陆，显示登陆页
      if (!store.auth.user?._id) {
        setIsReady(true);
        navigate('/login');
        return;
      }
      try {
        setIsLoading(true);
        console.log('🔄 初始化应用...');
        console.log('📍 user_id:', store.auth.user?._id);
        // 1. 初始化 Socket 连接
        console.log('🔌 正在连接 WebSocket...');
        const { success, error } = await initSocket();
        if (success) {
          // 2. 加载用户信息
          console.log('📊 正在加载用户信息...');
          await loadUserInfo();
          // 3. 标记为就绪
          setIsReady(true);
          console.log('🎉 应用初始化完成');
          getSocket()?.on(ReceiveEvent.UserKicked, () => {
            store.auth.logout()
            navigate('/login')
          })
        } else {
          console.error('失败', error)
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
  }, []);

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
          store.auth.setUser(userInfo);
          console.log('👤 用户信息:', userInfo.name);
          resolve(null);
        } else {
          reject(new Error('用户信息为空'));
        }
      });
    });
  };
  return <Loading isLoading={isLoading}>{children}</Loading>;
}
export const App = observer(() => {
  const [isReady, setIsReady] = useState(false);
  return (
    <BrowserRouter basename={process.env.PUBLIC_URL}>
      <div className="app">
        <Notifications />

        {/* 只有登陆的用户才显示导航栏 */}
        {store.auth.isLoggedIn && <Navbar />}

        {/* 路由 */}
        <Routes>
          <Route path="/" element={<AuthGuard isReady={isReady} setIsReady={setIsReady}>
            <LobbyPage />
          </AuthGuard>} />
          <Route path="/game/:slug" element={<AuthGuard isReady={isReady} setIsReady={setIsReady}>
            <GamePage />
          </AuthGuard>} />
          <Route path="/game/:slug/room/:room_id" element={<AuthGuard isReady={isReady} setIsReady={setIsReady}>
            <RoomPage />
          </AuthGuard>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
});

export default App;