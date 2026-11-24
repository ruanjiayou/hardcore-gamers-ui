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

export function changePassword(old_pass: string, new_pass: string) {
  return apiClient.post<ApiResult<boolean>>('/users/password', { old_pass, new_pass });
}

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
/** 单个游戏的音频配置；未配置的键回退到包级通用配置 */
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
  /** 包级通用配置（游戏未单独配置时使用） */
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
