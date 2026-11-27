import axios from 'axios';
import { authStore } from '../stores/auth';

/**
 * 统一 API 请求入口。
 * 开发期由 Vite 把 /api 代理到游戏服务端，生产期由同域 Nginx 转发。
 */
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

// 统一带登录 token（与 socket 的 auth.token 同源），语音包选择、个人中心等写操作需要登录
apiClient.interceptors.request.use((config) => {
  const token = authStore.token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 裸 axios（不带拦截器）用于续期本身，避免 401 → 续期 → 401 的递归
const plain = axios.create({ baseURL: '/api', timeout: 10000 });

let refreshPromise: Promise<string | null> | null = null;

/**
 * 用 refresh_token 换新的 access_token（并发调用共享同一个请求）。
 * access_token 只有 30h，过期后不该把用户踢回登录页——先续期，成功就继续。
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const refresh_token = authStore.refreshToken;
  if (!refresh_token) return Promise.resolve(null);

  refreshPromise = plain
    .post<ApiResult<LoginResult>>('/oauth/refresh', { refresh_token })
    .then(res => {
      const data = res.data?.data;
      if (res.data?.code !== 0 || !data?.token?.access_token) return null;
      authStore.setLogin(data.token.access_token, data.token.refresh_token);
      if (data.user) authStore.setUser(data.user);
      console.log('🔁 access_token 已自动续期');
      return data.token.access_token;
    })
    .catch(() => null)
    .finally(() => { refreshPromise = null; });

  return refreshPromise;
}

apiClient.interceptors.response.use(
  res => res,
  async (error) => {
    const cfg: any = error?.config;
    // 401 = 未登录/过期：续期一次后重放原请求
    if (error?.response?.status === 401 && cfg && !cfg._retried) {
      cfg._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${token}` };
        return apiClient(cfg);
      }
    }
    return Promise.reject(error);
  },
);

export interface LoginPayload {
  name: string;
  pass: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  [key: string]: any;
}

export interface LoginResult {
  token: TokenPair;
  user: any;
}

export interface ApiResult<T> {
  code: number;
  data: T;
  message?: string;
}

/** 账号密码登录 */
export function login(payload: LoginPayload) {
  return apiClient.post<ApiResult<LoginResult>>('/oauth/login', payload);
}

// ===== 个人中心 / 公开主页 =====

/** 单个游戏的战绩行（公开主页横向游戏列表 + 战绩总览都读它） */
export interface ProfileGame {
  game_id: string;
  slug: string;
  title: string;
  icon: string;
  level: number;
  score: number;
  exp: number;
  boards?: Record<string, number>;
  stats: { matches: number, winners: number, draws: number, flees: number };
  win_rate: number;
  last_played?: string;
}

export interface PublicProfile {
  user: { _id: string, name: string, nickname: string, avatar?: string, atline?: boolean, createdAt: string };
  games: ProfileGame[];
}

/** 对局记录（棋类带 role/score，可配回放） */
export interface GameRecord {
  _id: string;
  game_id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  result: 'win' | 'lose' | 'draw' | 'solo';
  me?: { _id: string, role: string, score: number, is_winner: boolean, nickname: string, avatar?: string };
  players: { _id: string, role: string, score: number, is_winner: boolean, nickname: string, avatar?: string }[];
}

export function getProfile(user_id: string) {
  return apiClient.get<ApiResult<PublicProfile>>(`/users/${user_id}/profile`);
}

export function getRecords(user_id: string, game_id?: string, skip = 0, limit = 20) {
  return apiClient.get<ApiResult<{ total: number, list: GameRecord[] }>>(`/users/${user_id}/records`, {
    params: { game_id, skip, limit },
  });
}

export function updateProfile(payload: { nickname?: string, avatar?: string, email?: string, phone?: string }) {
  return apiClient.put<ApiResult<any>>('/users/profile', payload);
}

// ===== 玩家中心 / 玩家公开主页（player 表，按游戏隔离，UI-107/108 / SB-065） =====

/** 单个 player 的只读资料（player 表，不含 user 的邮箱/手机） */
export interface PlayerProfileData {
  player_id: string;
  nickname: string;
  avatar: string;
  level: number;
  score: number;
  exp: number;
  boards?: Record<string, number>;
  stats: { matches: number, winners: number, draws: number, flees: number };
  win_rate: number;
}

/** 玩家公开主页：按 player_id + 游戏取（只读） */
export function getPlayerProfile(slug: string, player_id: string) {
  return apiClient.get<ApiResult<{ player: PlayerProfileData }>>(`/players/${slug}/profile/${player_id}`);
}

/** 玩家公开主页的对局记录：按 player_id + 游戏取（与 user 版按 user_id 跨游戏区分） */
export function getPlayerRecords(slug: string, player_id: string, skip = 0, limit = 20) {
  return apiClient.get<ApiResult<{ total: number, list: GameRecord[] }>>(
    `/players/${slug}/profile/${player_id}/records`,
    { params: { skip, limit } },
  );
}

/** 玩家中心：按 user_id+game 取自己的 player（需 Bearer） */
export function getMyPlayerProfile(slug: string) {
  return apiClient.get<ApiResult<{ player: PlayerProfileData }>>(`/players/${slug}/me`);
}

/** 玩家中心：只改本游戏 player 的昵称/头像，不回写 user 表 */
export function updateMyPlayerProfile(slug: string, payload: { nickname?: string, avatar?: string }) {
  return apiClient.put<ApiResult<{ player: PlayerProfileData }>>(`/players/${slug}/me`, payload);
}

export function changePassword(old_pass: string, new_pass: string) {
  return apiClient.post<ApiResult<boolean>>('/users/password', { old_pass, new_pass });
}

// ===== 好友（SB-060）：主体是玩家 ID，按游戏隔离，所有接口带 slug =====

export interface FriendUser {
  player_id: string;
  nickname: string;
  avatar?: string;
  level?: number;
  atline?: boolean;
}
/** 最近同玩玩家（SB-063）：好友信息 + 最近一次同场时间 */
export interface RecentPlaymate extends FriendUser {
  last_played_at?: string;
}
export interface FriendRequestItem {
  invite_id: string;
  /** from / to 都是玩家 ID（不是用户 ID） */
  from: string;
  to: string;
  created_at: string;
  user: FriendUser | null;
}

const q = (slug: string) => `?slug=${encodeURIComponent(slug)}`;

export const getFriends = (slug: string) =>
  apiClient.get<ApiResult<{ list: FriendUser[] }>>(`/friends${q(slug)}`);
export const getRecentPlaymates = (slug: string) =>
  apiClient.get<ApiResult<{ list: RecentPlaymate[] }>>(`/friends/recent${q(slug)}`);
export const getFriendRequests = (slug: string) => apiClient.get<ApiResult<{
  incoming: FriendRequestItem[]; outgoing: FriendRequestItem[];
}>>(`/friends/requests${q(slug)}`);
export const sendFriendRequest = (slug: string, target: string) =>
  apiClient.post<ApiResult<{ invite_id: string }>>('/friends/requests', { slug, target });
export const acceptFriendRequest = (id: string) =>
  apiClient.post<ApiResult<boolean>>(`/friends/requests/${id}/accept`);
export const rejectFriendRequest = (id: string) =>
  apiClient.post<ApiResult<boolean>>(`/friends/requests/${id}/reject`);
export const cancelFriendRequest = (id: string) =>
  apiClient.delete<ApiResult<boolean>>(`/friends/requests/${id}`);
export const removeFriend = (slug: string, player_id: string) =>
  apiClient.delete<ApiResult<boolean>>(`/friends/${encodeURIComponent(player_id)}${q(slug)}`);

/** 回放：frames 是每次落子后的棋盘快照，前端按帧渲染 */
export interface ReplayData {
  _id: string;
  game_id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  players: { _id: string, role: string, team?: string, score: number, is_winner: boolean, nickname: string, avatar?: string }[];
  init_state: any;
  final_board: any;
  frames: { index: number, board: any, at: number, player_id?: string }[];
}

export function getReplay(match_id: string) {
  return apiClient.get<ApiResult<ReplayData>>(`/matches/${match_id}/replay`);
}

// ===== 语音包 =====

/** 语音包配置：文件 URL 由服务端下发，前端只按 URL 加载播放 */
/** 单个游戏的音频配置：BGM 与音效都按游戏各一份，通用层只留 UI 音 */
export interface GameAudio {
  bgm: { url: string; label: string }[];
  sfx: Record<string, string>;
}

export interface VoicePack {
  id: string;
  name: string;
  desc: string;
  cover: string;
  isDefault: boolean;
  requirePermission: boolean;
  /** 服务端计算的虚拟字段：当前玩家是否有权使用 */
  hasPermission: boolean;
  /** 包级通用配置：只有 UI 通用音（click/win/lose），游戏专属音在 games 里 */
  bgm: { url: string; label: string }[];
  sfx: Record<string, string>;
  /** 按游戏区分的配置：key 为 game_id / slug */
  games?: Record<string, GameAudio>;
}

export interface VoicePackData {
  list: VoicePack[];
  selected: string;
  hasPermission: boolean;
}

/** 拉取语音包配置（游客可读，仅返回默认包可用） */
export function getVoicePacks() {
  return apiClient.get<ApiResult<VoicePackData>>('/voice-packs');
}

/** 选择语音包：无权限时服务端拒绝并回退默认包 */
export function selectVoicePack(packId: string) {
  return apiClient.post<ApiResult<{ selected: string; hasPermission: boolean }>>('/voice-packs/select', { pack_id: packId });
}

// ===== 资源（皮肤图 + 音频，按游戏 + 资源包） =====

/**
 * 资源清单：一次拿到该游戏全部图片与音频。
 * `images` 的 key 是 **asset_id**（资源表主键），不是 `food.small` 这种字符串——
 * 快照里也只带 asset_id，两边对得上才不会串图。
 */

/** 清单里的一条外观资源 */
export interface AssetManifestItem {
  id: string;
  /** 分组名（游戏自定义：snake 的 `snake`/`food`/`items`/`corpse`） */
  group: string;
  key: string;
  label: string;
  /** 展示用身体图（其他分组就是资源图） */
  url: string;
  body: string;
  /** 蛇头图（只有皮肤配了才有） */
  head?: string;
  /** 玩家级可装备（能在设置里勾选装备） */
  equippable: boolean;
  /** 玩家是否有权使用（free 或已授权） */
  owned: boolean;
  /** 是否是当前装备的那一件 */
  equipped: boolean;
}

export interface AssetManifest {
  game: string;
  /** 缓存键：任意一条资源改过就变 */
  revision: string;
  /** asset_id → 身体图 URL；`<id>:head` → 蛇头图 URL */
  images: Record<string, string>;
  /** 本游戏的外观资源，按分组下发 */
  groups: Record<string, { items: AssetManifestItem[] }>;
  /** 玩家级可装备的外观（groups 里 equippable 的汇总） */
  skins: AssetManifestItem[];
  /** 当前玩家装备的蛇身 asset_id（兼容旧字段） */
  equipped: string;
  /** 按槽位区分的装备：snake=蛇身/蛇头，corpse=死亡残骸 */
  equippedByGroup: Record<string, string>;
  /** 音频：BGM + 音效，随清单一次下发（按游戏各一份） */
  audio: { bgm: { url: string; label: string }[]; sfx: Record<string, string> };
}

/** 一次拿到该游戏的全部资源（游客可读；游戏名在 path 上） */
export function getAssetManifest(game: string) {
  return apiClient.get<ApiResult<AssetManifest>>(`/assets/${encodeURIComponent(game)}/manifest.json`);
}

/** 装备外观（传 asset_id；slot=snake 蛇身/蛇头，corpse 死亡残骸） */
export function equipSkin(game: string, assetId: string, slot: 'skin' | 'corpse' = 'skin') {
  return apiClient.post<ApiResult<{ slot: string; asset_id: string }>>('/assets/equip', {
    game, asset_id: assetId, slot,
  });
}
