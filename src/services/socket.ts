import io, { Socket } from 'socket.io-client';
import store from '../stores'

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
        token: store.auth.token,
      },
      reconnection: false,
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
    getSocket()?.emit('lobby:get-leaderboard', { limit: 10 }, callback);
  },
  getRooms: (gameId: string, callback: (rooms: any[]) => void) => {
    getSocket()?.emit('lobby:get-rooms', { gameId }, callback);
  },
  getGamePlayer: (gameId: string, user_id: string, callback: (roomPlayer: any) => void) => {
    getSocket()?.emit('lobby:get-game-player', { gameId, user_id }, callback);
  },
  createRoom: (data: any, callback: (success: boolean, room_id?: string, error?: string) => void) => {
    getSocket()?.emit('lobby:create-room', data, callback);
  },
  joinInviteRoom: (data: any, callback: (success: boolean, room_id?: string, error?: string) => void) => {
    getSocket()?.emit('lobby:join-invite-room', data, callback);
  },
  joinRoom: (data: { room_id: string, type?: string, password?: string }, callback?: (success: boolean, player?: any) => void) => {
    getSocket()?.emit('lobby:join-room', data, callback);
  },

  getRoomDetail: (room_id: string, callback?: (data: { room: any, match_id: string }) => void) => {
    getSocket()?.emit('room:detail', { room_id }, callback);
  },

  leaveRoom: (data: { room_id: string, player_id: string }, callback?: (success: boolean) => void) => {
    getSocket()?.emit('room:leave', data, callback);
  },

  sendMessage: (room_id: string, message: string, callback?: (success: boolean) => void) => {
    getSocket()?.emit('room:send-message', { room_id, message }, callback);
  },

  startGame: (data: { room_id: string, player_id: string }, callback?: (match_id: string, error?: string) => void) => {
    getSocket()?.emit('room:start-game', data, callback);
  },
  getMatchState: (data: { room_id: string, match_id?: string }, callback: (state: any) => void) => {
    getSocket()?.emit('room:get-match-state', data, callback);
  },
  surrender: (data: { room_id: string, match_id?: string, player_id: string }, callback: (success: boolean) => void) => {
    getSocket()?.emit('room:surrender', data, callback);
  },
  seekdraw: (room_id: string) => {
    getSocket()?.emit('room:seek-draw', { room_id });
  },
  agreeDraw: (room_id: string, agree: boolean) => {
    getSocket()?.emit('room:agree-draw', { room_id, agree });
  },
  playerReadyChange: (data: { room_id: string, player_id: string, ready: boolean }, callback: (success: boolean) => void) => {
    getSocket()?.emit('room:player-ready', data, callback);
  },
  recordAction: (room_id: string, data: any, callback: (success: boolean) => void) => {
    getSocket()?.emit('room:player-action', data, callback);
  }
};

// 事件订阅
export const socketListeners = {
  onPlayerNetwork: (callback: (data: any) => void) => {
    getSocket()?.on('room:player-network', callback);
  },
  onRoomCreated: (callback: (room: any) => void) => {
    getSocket()?.on('room:created', callback);
  },

  onPlayerJoined: (callback: (data: any) => void) => {
    getSocket()?.on('room:player-joined', callback);
  },

  onPlayerActioin: (callback: (data: any) => void) => {
    getSocket()?.on('room:player-action', callback);
  },
  onGameOver: (callback: (data: any) => void) => {
    getSocket()?.on('room:game-over', callback);
  },
  onPlayerLeaved: (callback: (data: any) => void) => {
    getSocket()?.on('room:player-leaved', callback);
  },

  onRoomReady: (callback: (data: any) => void) => {
    getSocket()?.on('room:room-ready', callback);
  },

  onMessage: (callback: (data: any) => void) => {
    getSocket()?.on('room:message', callback);
  },

  onGameStarted: (callback: (data: { room_id: string, match_id: string, timestamp: number }) => void) => {
    getSocket()?.on('room:game-started', callback);
  },
  onSeekDraw: (callback: (data: any) => void) => {
    getSocket()?.on('room:seek-draw', callback);
  },
  onRoomDestroyed: (callback: (data: any) => void) => {
    getSocket()?.on('room:destroyed', callback);
  }
};