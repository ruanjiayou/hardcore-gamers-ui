import io, { Socket } from 'socket.io-client';
import { authStore } from '../stores/auth';

let socket: Socket | null = null;

export async function initSocket(): Promise<{ success: boolean, error?: any }> {
  const success = true;
  // 如果已经连接，直接返回
  if (socket && socket.connected) {
    console.log('🔄 Socket 已连接，直接返回');
    return { success };
  }

  // 如果存在旧连接但已断开，清理
  if (socket && socket.disconnected) {
    console.log('🧹 清理已断开的旧连接');
    socket.disconnect();
    socket = null;
  }

  console.log('🔌 初始化 Socket.io 连接...');

  try {
    socket = io('http://localhost:3000', {
      auth: {
        user_id: authStore.user_id,
        isLoggedIn: authStore.isLoggedIn,
        isGuest: authStore.isGuest
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
      upgrade: true,
      rejectUnauthorized: false
    });
    socket.on('disconnect', reason => {
      console.log('断开原因', reason)
    })
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Socket 连接超时'))
      }, 10000)

      const onConnect = () => {
        cleanup()
        console.log('✅ WebSocket 连接成功')
        resolve({ success })
      }

      const onError = (error: any) => {
        cleanup()
        reject(error)
      }

      const cleanup = () => {
        console.log(socket?.connected, 'clearup')
        clearTimeout(timeout)
        socket?.off('connect', onConnect)
        socket?.off('connect_error', onError)
      }

      socket?.once('connect', onConnect)
      socket?.once('connect_error', onError)
    })
  } catch (error: any) {
    console.error('❌ Socket 初始化异常:', error);
    socket = null;
    return { success: false, error };
  }
}
export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('🔌 Socket 已断开');
  }
}

// 事件监听器
export const socketEvents = {
  getStats: (callback: (stats: any) => void) => {
    getSocket()?.emit('lobby:get-stats', callback);
  },
  getGames: (callback: (games: any[]) => void) => {
    getSocket()?.emit('lobby:get-games', callback);
  },
  getLeaderboard: (callback: (ranks: any[]) => void) => {
    console.log('?')
    getSocket()?.emit('lobby:get-leaderboard', { limit: 10 }, callback);
  },
  getRooms: (gameId: string, callback: (rooms: any[]) => void) => {
    getSocket()?.emit('lobby:get-rooms', { gameId }, callback);
  },
  createRoom: (data: any, callback: (success: boolean, roomId?: string, error?: string) => void) => {
    getSocket()?.emit('lobby:create-room', data, callback);
  },
  joinInviteRoom: (data: any, callback: (success: boolean, roomId?: string, error?: string) => void) => {
    getSocket()?.emit('lobby:join-invite-room', data, callback);
  },
  joinRoom: (roomId: string, password?: string, callback?: (success: boolean, error?: string) => void) => {
    getSocket()?.emit('lobby:join-room', { roomId, password }, callback);
  },

  getRoomInfo: (roomId: string, callback?: (room: any) => void) => {
    getSocket()?.emit('lobby:get-room-info', { roomId }, callback);
  },

  leaveRoom: (roomId: string, callback?: (success: boolean) => void) => {
    getSocket()?.emit('room:leave', { roomId }, callback);
  },

  sendMessage: (roomId: string, message: string, callback?: (success: boolean) => void) => {
    getSocket()?.emit('room:send-message', { roomId, message }, callback);
  },

  startGame: (roomId: string, callback?: (success: boolean, error?: string) => void) => {
    getSocket()?.emit('room:start-game', { roomId }, callback);
  }
};

// 事件订阅
export const socketListeners = {
  onRoomCreated: (callback: (room: any) => void) => {
    getSocket()?.on('room:created', callback);
  },

  onPlayerJoined: (callback: (data: any) => void) => {
    getSocket()?.on('room:player-joined', callback);
  },

  onPlayerLeft: (callback: (data: any) => void) => {
    getSocket()?.on('room:player-left', callback);
  },

  onMessage: (callback: (data: any) => void) => {
    getSocket()?.on('room:message', callback);
  },

  onGameStarted: (callback: (data: any) => void) => {
    getSocket()?.on('game:started', callback);
  },

  onRoomDestroyed: (callback: (data: any) => void) => {
    getSocket()?.on('room:destroyed', callback);
  }
};