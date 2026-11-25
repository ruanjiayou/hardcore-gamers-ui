import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from './stores'
import { initSocket, disconnectSocket, getSocket, ReceiveEvent } from './services/socket';
import { refreshAccessToken } from './services/api';
import { Navbar } from './components/Navbar';
import { LoginPage } from './pages/Login'
import { LobbyPage } from './pages/Lobby';
import { GamePage } from './pages/Game';
import { RoomPage } from './pages/Room';
import { ProfilePage } from './pages/Profile';
import { UserProfilePage } from './pages/UserProfile';
import { InviteToasts } from './components/InviteToast';
import { Notifications, notificationManager } from './components/Notifications';
import { LoginRequiredModal } from './components/LoginRequired';
import './styles/index.css';
import Loading from './components/Loading';

/**
 * 应用外壳：负责建立 socket 连接。
 * 未登录不再强制跳登录页——游客以匿名连接浏览大厅（游戏列表/统计/排行榜只读），
 * 真正进入游戏时由页面/弹窗提示登录。
 */
const AppBootstrap = observer(({ children, isReady, setIsReady }: { children: React.ReactNode, isReady: boolean, setIsReady: Function }) => {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  // 用 ref 记录建立连接时的身份，登录/退出后据此重连
  const tokenRef = useRef(store.auth.token);

  // 加载用户信息（仅登录用户）
  const loadUserInfo = async () => {
    return new Promise((resolve, reject) => {
      const socket = getSocket();
      if (!socket) {
        reject(new Error('Socket 未初始化'));
        return;
      }
      const timeout = setTimeout(() => reject(new Error('获取用户信息超时')), 5000);
      socket.emit('lobby:get-user-info', (userInfo: any) => {
        clearTimeout(timeout);
        if (userInfo) {
          store.auth.setUser(userInfo);
          resolve(null);
        } else {
          reject(new Error('用户信息为空'));
        }
      });
    });
  };

  const bootstrap = async () => {
    setIsLoading(true);
    try {
      // 身份可能已变化（游客→登录、退出登录）：断开旧连接再用当前 token 重连
      disconnectSocket();
      let { success, error } = await initSocket();
      if (!success) {
        const msg = String((error as any)?.message || error || '');
        // token 过期：先用 refresh_token 续期，续期成功就用新 token 重连；
        // 续期也失败（refresh 过期/被清）才降级成游客，别让用户卡在连不上的状态。
        if (/过期|票据|验证失败/.test(msg) && store.auth.token) {
          const token = await refreshAccessToken();
          if (token) {
            disconnectSocket();
            ({ success, error } = await initSocket());
          }
          if (!success) {
            store.auth.logout();
            tokenRef.current = '';
            notificationManager.show('登录已过期，请重新登录', 'warning');
            ({ success, error } = await initSocket());
          }
        }
      }
      if (!success) throw error || new Error('连接失败');
      // 语音包配置走 HTTP，与 socket 无关；失败时 store 自动回退默认包
      void store.audio.load();
      if (store.auth.token) {
        try {
          await loadUserInfo();
        } catch (e) {
          console.error('加载用户信息失败（继续以游客浏览）:', e);
        }
      }
      getSocket()?.off(ReceiveEvent.UserKicked);
      getSocket()?.on(ReceiveEvent.UserKicked, () => {
        store.auth.logout();
        navigate('/lobby');
      });
      // 房间邀请：右上角常驻提示，接受/拒绝后才消失
      getSocket()?.off(ReceiveEvent.InviteReceived);
      getSocket()?.on(ReceiveEvent.InviteReceived, (data: any) => {
        if (data?.invite_id) store.ui.addInvite(data);
      });
      // 我发出的邀请有结果了：给个轻提示，别让邀请人一直等
      getSocket()?.off(ReceiveEvent.InviteResult);
      getSocket()?.on(ReceiveEvent.InviteResult, (data: any) => {
        if (!data?.invite_id) return;
        notificationManager.show(
          data.accepted
            ? `${data.nickname || '对方'} 已接受邀请`
            : `邀请未接受：${data.message || '对方拒绝'}`,
          data.accepted ? 'success' : 'warning',
        );
      });
      // 匹配排队：竞技场满员时排队等空位，排到了直接跳进那张桌子。
      // 全局监听（不在游戏页）—— 玩家等位期间可能已经切到别的页面。
      getSocket()?.off(ReceiveEvent.MatchFound);
      getSocket()?.on(ReceiveEvent.MatchFound, (data: any) => {
        if (!data?.room_id) return;
        notificationManager.show('排到位置了，正在进入竞技场…', 'success');
        navigate(`/game/${data.slug || 'snake'}/room/${data.room_id}`);
      });
    } catch (error) {
      console.error('❌ 应用初始化失败:', error);
    } finally {
      setIsReady(true);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    bootstrap();
    return () => {
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 登录/退出登录后 token 变化 → 换身份重连
  useEffect(() => {
    if (!isReady) return;
    if (tokenRef.current === store.auth.token) return;
    tokenRef.current = store.auth.token;
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.auth.token, isReady]);

  return <Loading isLoading={isLoading}>
    {/* 邀请提示常驻右上角，跨页面可见（大厅/游戏页/房间页都要能收到） */}
    <InviteToasts />
    {children}
  </Loading>;
});

export const App = observer(() => {
  const [isReady, setIsReady] = useState(false);
  return (
    <BrowserRouter basename={process.env.PUBLIC_URL}>
      <div className="app">
        <Notifications />
        <LoginRequiredModal />

        {/* 导航栏常驻：未登录时右上角显示"未登录 + 登录" */}
        <Navbar />

        {/* 路由 */}
        <Routes>
          <Route path="/" element={<AppBootstrap isReady={isReady} setIsReady={setIsReady}>
            <LobbyPage />
          </AppBootstrap>} />
          <Route path="/game/:slug" element={<AppBootstrap isReady={isReady} setIsReady={setIsReady}>
            <GamePage />
          </AppBootstrap>} />
          <Route path="/game/:slug/room/:room_id" element={<AppBootstrap isReady={isReady} setIsReady={setIsReady}>
            <RoomPage />
          </AppBootstrap>} />
          {/* 个人中心：改昵称/头像/手机/邮箱/密码 */}
          <Route path="/me" element={<AppBootstrap isReady={isReady} setIsReady={setIsReady}>
            <ProfilePage />
          </AppBootstrap>} />
          {/* 公开主页：玩过的游戏 + 战绩总览 + 对局记录（?game=slug 锁定单个游戏） */}
          <Route path="/user/:user_id" element={<AppBootstrap isReady={isReady} setIsReady={setIsReady}>
            <UserProfilePage />
          </AppBootstrap>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
});

export default App;
