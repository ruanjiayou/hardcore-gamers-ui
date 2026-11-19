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
    socket = io(window.location.origin.replace('http', 'ws'), {
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

export const ReceiveEvent = {
  // 玩家事件
  PlayerChange: 'player:change',
  // 游戏事件
  GameStart: 'room:game-start',
  GameOver: 'room:game-over',
  Clock: 'room:clock',
  TimeControlUpdated: 'room:timecontrol-updated',
  OfferDraw: 'room:offer-draw',
  DecideDraw: 'room:decide-draw',
  UserChange: 'user:change',
  UserKicked: 'user:kicked',
  // 房间事件（与服务端 emit 名称严格一致）
  RoomCreated: 'room:created',
  RoomReady: 'room:room-ready',
  RoomDisband: 'lobby:room-destroyed',
  RoomMessage: 'room:message',
  PlayerJoined: 'room:player-joined',
  PlayerReJoin: 'room:player-rejoined',
  PlayerLeaved: 'room:player-leaved',
  PlayerAction: 'room:player-action',
  PlayerKicked: 'room:player-kicked',
  TransfereeOwner: 'room:transferee-owner',
  SettingsUpdated: 'room:settings-updated',
} as const;
export const SendoutEvent = {
  KickPlayer: 'room:kick-player',
  TransferorOwner: 'room:transferor-owner',
  AddRobot: 'room:add-robot',
  LeaveRoom: 'room:leave',
  Disband: 'room:disband',
  UpdateSettings: 'room:update-settings',
  SendMessage: 'room:send-message',
  StartGame: 'room:start-game',
  GetMatchState: 'room:get-match-state',
  PlayerSurrender: 'room:player-surrender',
  UpdateTimeControl: 'room:update-timecontrol',
  OfferDraw: 'room:offer-draw',
  DecideDraw: 'room:decide-draw',

  LobbyStats: 'lobby:get-stats',
  LobbyGames: 'lobby:get-games',
  GameRanks: 'lobby:get-leaderboard',
  GetRooms: 'lobby:get-rooms',

  CreateRoom: 'lobby:create-room',
  JoinRoom: 'lobby:join-room',
  JoinInviteRoom: 'lobby:join-invite-room',
  QuickStart: 'lobby:quick-start',
} as const;
// 定义一个通用的 ValueOf 工具类型
type ValueOf<T> = T[keyof T];
type TSendoutEvent = ValueOf<typeof SendoutEvent>

// 事件监听器
export const socketEvents = {
  excute: (...args: [TSendoutEvent, ...any[]]) => {
    getSocket()?.emit(...args);
  },
  getRooms: (game_id: string, callback: (rooms: any[]) => void) => {
    getSocket()?.emit('lobby:get-rooms', { game_id }, callback);
  },
  getGamePlayer: (slug: string, callback: (player: any) => void) => {
    getSocket()?.emit('lobby:get-game-player', slug, callback);
  },
  joinRoom: (data: { room_id: string, type?: string, password?: string }, callback?: (success: boolean, player?: any) => void) => {
    getSocket()?.emit('lobby:join-room', data, callback);
  },
  /** 单人游戏快开：一键开一局（服务端建临时房并立即开局），无需房间列表 */
  quickStart: (
    slug: string,
    callback?: (success: boolean, data?: { room_id: string, match_id: string }, message?: string) => void,
  ) => {
    getSocket()?.emit('lobby:quick-start', { slug }, callback);
  },
  getRoomDetail: (room_id: string, callback?: (data: { room: any, match_id: string }) => void) => {
    getSocket()?.emit('room:detail', { room_id }, callback);
  },
  playerReadyChange: (data: { room_id: string, player_id: string, ready: boolean }, callback: (success: boolean) => void) => {
    getSocket()?.emit('room:player-ready', data, callback);
  },
  playerNetworkChange: () => {

  },
};
