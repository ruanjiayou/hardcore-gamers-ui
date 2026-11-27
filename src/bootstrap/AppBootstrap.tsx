import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { initSocket, disconnectSocket, getSocket, ReceiveEvent } from '../services/socket';
import { refreshAccessToken } from '../services/api';
import { InviteToasts } from '../components/InviteToast';
import { notificationManager } from '../components/Notifications';
import Loading from '../components/Loading';
import { consumeWarmNav, gameUrl, go, lobbyUrl } from '../navigation';

/**
 * 应用外壳：负责建立 socket 连接。
 * 未登录不再强制跳登录页——游客以匿名连接浏览大厅（游戏列表/统计/排行榜只读），
 * 真正进入游戏时由页面/弹窗提示登录。
 */
const AppBootstrap = observer(({ children, isReady, setIsReady, onNavigate }: {
  children: React.ReactNode,
  isReady: boolean,
  setIsReady: Function,
  onNavigate?: (url: string) => void,
}) => {
  // UI-083：断网提示——浏览器 online/offline 事件 + SW 缓存兜底消息
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    let alive = true;
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'lobby:offline-cache') setOffline(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    // UI-083 修订：SW 的 postMessage 在页面 JS 执行前发出会丢，navigator.onLine
    // 也只判断网卡、不判断目标服务可达。加随机 query 主动探测：旧 SW 的缓存 key
    // 匹配不到带 query 的请求，服务停时必然失败 → 显示离线横幅。
    const probe = async () => {
      try {
        const res = await fetch(`/lobby/asset-manifest.json?lobby_probe=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('probe failed');
        if (alive) setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    };
    void probe();

    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, []);

  // 热导航（跨入口跳转）跳过全屏 Loading；UI-093 去掉了顶部细进度条
  const warmRef = useRef(consumeWarmNav());
  const bootedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(!warmRef.current);
  const navigate = useNavigate();
  // 用 ref 记录建立连接时的身份，登录/退出后据此重连
  const tokenRef = useRef(store.auth.token);

  // 跨入口跳转：优先用入口注入的 onNavigate（AppFrame 注入的是 go，整页跳转）；
  // 未注入时退回 react-router navigate。被踢出 / 匹配成功要跨 basename 换文档，
  // 这两处必须走整页 location.href，所以硬跳转兜底用 go。
  const navigateTo = (url: string, hard = false) => {
    if (onNavigate) return onNavigate(url);
    return hard ? go(url) : navigate(url);
  };

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
    const showSpinner = !bootedRef.current && !warmRef.current;
    if (showSpinner) setIsLoading(true);
    try {
      // initSocket 按当前 token 更新身份；跨入口新文档不该先断开再闪一下断线态
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
        const info = loadUserInfo();
        if (showSpinner) {
          try {
            await info;
          } catch (e) {
            console.error('加载用户信息失败（继续以游客浏览）:', e);
          }
        } else {
          // 热导航/身份切换：页面先显示，用户信息后台补齐
          void info.catch(e => console.error('加载用户信息失败（继续以游客浏览）:', e));
        }
      }
      getSocket()?.off(ReceiveEvent.UserKicked);
      getSocket()?.on(ReceiveEvent.UserKicked, () => {
        store.auth.logout();
        navigateTo(lobbyUrl(), true);
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
        navigateTo(gameUrl(data.slug || 'snake', '/room/' + data.room_id), true);
      });
      // 好友申请实时提示（SB-061 / UI-071）：全局监听，玩家可能在任何页面
      getSocket()?.off(ReceiveEvent.FriendRequest);
      getSocket()?.on(ReceiveEvent.FriendRequest, (data: any) => {
        if (!data?.invite_id) return;
        notificationManager.show(`${data.from?.nickname || '有玩家'} 想加你好友（30 分钟内有效）`, 'success');
      });
      getSocket()?.off(ReceiveEvent.FriendResult);
      getSocket()?.on(ReceiveEvent.FriendResult, (data: any) => {
        if (!data?.invite_id) return;
        if (data.message) notificationManager.show(data.message, 'warning');
        else if (data.accepted) notificationManager.show(`${data.player?.nickname || '对方'} 已接受你的好友申请`, 'success');
      });
    } catch (error) {
      console.error('❌ 应用初始化失败:', error);
    } finally {
      bootedRef.current = true;
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

  return <>
    {offline && <div className="app-offline-banner" role="status">
      当前离线，正在使用缓存内容；部分功能暂不可用
    </div>}
    <Loading isLoading={isLoading}>
      {/* 邀请提示常驻右上角，跨页面可见（大厅/游戏页/房间页都要能收到） */}
      <InviteToasts />
      {children}
    </Loading>
  </>;
});

export default AppBootstrap;
