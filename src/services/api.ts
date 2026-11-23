import axios from 'axios';

/**
 * 统一 API 请求入口。
 * 开发期由 Vite 把 /api 代理到游戏服务端，生产期由同域 Nginx 转发。
 */
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

// 统一带登录 token（与 socket 的 auth.token 同源），语音包选择等写操作需要登录
apiClient.interceptors.request.use((config) => {
  try {
    const session = JSON.parse(localStorage.getItem('gameSession') || '{}');
    if (session?.token) config.headers.Authorization = `Bearer ${session.token}`;
  } catch { /* localStorage 不可用时按游客请求 */ }
  return config;
});

export interface LoginPayload {
  name: string;
  pass: string;
}

export interface LoginResult {
  token: { access_token: string; [key: string]: any };
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
