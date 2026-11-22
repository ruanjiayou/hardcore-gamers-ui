import axios from 'axios';

/**
 * 统一 API 请求入口。
 * 开发期由 Vite 把 /api 代理到游戏服务端，生产期由同域 Nginx 转发。
 */
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
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
