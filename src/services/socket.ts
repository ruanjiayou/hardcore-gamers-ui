import io, { Socket } from 'socket.io-client';
import store from '../stores'

let socket: Socket | null = null;

/** 创建实例但不等待连接：热导航时页面 effect 拿到的也不再是 null（UI-079）。 */
function createSocket(): Socket {
  const s = io(window.location.origin.replace('http', 'ws'), {
    auth: { token: store.auth.token },
    reconnection: false,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling'],
    upgrade: true,
    rejectUnauthorized: false
  });
  s.on('connect', () => store.ui.setSocketConnected(true));
  s.on('disconnect', reason => {
    store.ui.setSocketConnected(false);
    console.log('断开原因', reason);
  });
  s.on('connect_error', () => store.ui.setSocketConnected(false));
  return s;
}

/** 挂载 React 前同步创建实例；node 测试环境不创建。 */
export function ensureSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (!socket) socket = createSocket();
  return socket;
}

export async function initSocket(): Promise<{ success: boolean, error?: any }> {
  const s = ensureSocket();
  if (!s) return { success: false, error: new Error('Socket 未初始化') };

  // 身份可能已变化（游客→登录、退出登录）：更新 auth 后直接连接，不先断开再建实例
  const token = store.auth.token;
  const currentAuth = s.auth as { token?: string } | undefined;
  if (currentAuth?.token !== token) s.auth = { token };
  if (s.connected) {
    store.ui.setSocketConnected(true);
    console.log('🔄 Socket 已连接，直接返回');
    return { success: true };
  }

  console.log('🔌 初始化 Socket.io 连接...');
  return await new Promise<{ success: true }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Socket 连接超时'));
    }, 10000);

    const onConnect = () => {
      cleanup();
      console.log('✅ WebSocket 连接成功');
      store.ui.setSocketConnected(true);
      resolve({ success: true });
    };
    const onError = (error: any) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      s.off('connect', onConnect);
      s.off('connect_error', onError);
    };

    s.once('connect', onConnect);
    s.once('connect_error', onError);
    s.connect();
  }).catch(error => {
    console.error('❌ Socket 初始化异常:', error);
    store.ui.setSocketConnected(false);
    return { success: false, error };
  });
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  const wasConnected = socket.connected;
  socket.disconnect();
  // 没连上过（跨入口新文档）不写断线态，避免头像先裂一下再恢复（UI-078/UI-079）
  if (wasConnected) store.ui.setSocketConnected(false);
  console.log('🔌 Socket 已断开');
}

// 浏览器网络状态变化时同步头像状态（socket 尚未回调时的即时反馈）
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => store.ui.setSocketConnected(false));
  window.addEventListener('online', () => {
    if (socket?.connected) store.ui.setSocketConnected(true);
  });
}

export const ReceiveEvent = {
  // 玩家事件
  PlayerChange: 'player:change',
  // 游戏事件
  GameStart: 'room:game-start',
  GameOver: 'room:game-over',
  Clock: 'room:clock',
  TimeControlUpdated: 'room:timecontrol-updated',
  UserChange: 'user:change',
  UserKicked: 'user:kicked',
  // 邀请好友（替代已废弃的 lobby:join-invite-room：服务端没有该 handler）
  InviteReceived: 'invite:received',
  InviteResult: 'invite:result',
  InviteAccepted: 'invite:accepted',
  // 好友申请实时推送（`SB-061` / `UI-071`）
  FriendRequest: 'friend:request',
  FriendResult: 'friend:result',
  // 匹配队列：竞技场满员时排队等待，分配到桌后服务端推这个事件
  MatchFound: 'lobby:match-found',
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
  // 团队合局池状态（SB-064）：还需几支队伍才开局
  TeamMatchStatus: 'room:team-match-status',
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
  // 邀请好友进房：room:invite 由房内玩家发，invite:respond 由被邀请人回
  Invite: 'room:invite',
  RespondInvite: 'invite:respond',

  LobbyStats: 'lobby:get-stats',
  LobbyGames: 'lobby:get-games',
  GameRanks: 'lobby:get-leaderboard',
  GetRooms: 'lobby:get-rooms',

  CreateRoom: 'lobby:create-room',
  JoinRoom: 'lobby:join-room',
  MatchRoom: 'lobby:match',
  MatchCancel: 'lobby:match-cancel',
  QuickStart: 'lobby:quick-start',
} as const;
// 定义一个通用的 ValueOf 工具类型
type ValueOf<T> = T[keyof T];
type TSendoutEvent = ValueOf<typeof SendoutEvent>

/**
 * 点击「关闭 / 返回 / 离开」时同步贪吃蛇分数：只发一个信号，分数由服务端按实时局面结算。
 * 与瞄准/加速上报是完全独立的通道，网络慢也不会因为这条消息丢了就少记分
 * （服务端在 room:leave 和 disconnect 时还会各兜一次）。
 */
export function syncRoomScore(room_id?: string, player_id?: string) {
  const player: any = store.game.player;
  const rid = room_id || player?.room_id;
  const pid = player_id || player?._id;
  if (!socket || !rid || !pid) return;
  socket.emit('room:sync-score', { room_id: rid, player_id: pid });
}

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
  /**
 * 匹配：服务端在**已有的官方桌**里找一张还有空位的桌子。
 *
 * - 找到空位 → 回调拿到 `room_id`，直接进房间；
 * - 全部满员 → 回调拿到 `{ waiting: true, queue_size }`，进入排队等位；
 * - 排到位置时服务端另发 `lobby:match-found`（带 room_id），由 App 全局跳转。
 */
  match: (
    slug: string,
    variant?: string,
    callback?: (success: boolean, player?: any, message?: string) => void,
  ) => {
    getSocket()?.emit('lobby:match', { slug, variant }, callback);
  },
  /** 取消排队（竞技场满员时主动退出等待） */
  cancelMatch: (callback?: (success: boolean, data?: any, message?: string) => void) => {
    getSocket()?.emit('lobby:match-cancel', callback);
  },
  /** 单人游戏快开：一键开一局（服务端建临时房并立即开局），无需房间列表 */
  quickStart: (
    slug: string,
    /** 玩法变体（贪吃蛇：endless）；纯单人游戏可省略 */
    variant?: string,
    callback?: (success: boolean, data?: { room_id: string, match_id: string }, message?: string) => void,
  ) => {
    getSocket()?.emit('lobby:quick-start', { slug, variant }, callback);
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
