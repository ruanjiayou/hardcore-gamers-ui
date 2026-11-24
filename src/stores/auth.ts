import { makeAutoObservable } from 'mobx';
import { omit } from 'lodash';

export interface User {
  _id: string;
  /** 登录名（不可改） */
  name: string;
  /** 展示昵称（个人中心可改，缺省等于 name） */
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  atline?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export default class AuthStore {
  user: User | null = null;
  /** 游客模式标记：未登录时也可能是游客（大厅可浏览、游戏需登录） */
  isGuest = false;
  token: string = '';
  /** 续期令牌：access_token 过期时用它换新（30d） */
  refreshToken: string = '';

  constructor() {
    makeAutoObservable(this);
    this.loadFromStorage();
  }

  /** 是否已登录：以 token + user 为准（刷新后 isLoggedIn 不能丢） */
  get isLoggedIn() {
    return !!this.token && !!this.user?._id;
  }

  /** 界面统一显示昵称，老数据没有 nickname 时回退登录名 */
  get displayName() {
    return this.user?.nickname || this.user?.name || '-';
  }

  private loadFromStorage() {
    // 非浏览器环境（bun test）没有 localStorage：跳过，别让单测因为模块初始化就炸
    if (typeof localStorage === 'undefined') return;
    try {
      const session = localStorage.getItem('gameSession');
      if (session) {
        const { token = '', refresh_token = '', user = null } = JSON.parse(session);
        this.token = token || '';
        this.refreshToken = refresh_token || '';
        this.user = user || null;
        // token 为空/用户信息缺失一律按游客处理（旧版本可能只存了 user）
        this.isGuest = !this.isLoggedIn;
        console.log('📦 从本地存储加载会话');
      }
    } catch (error) {
      console.error('❌ 加载本地存储失败:', error);
      this.clearStorage();
    }
  }

  setUser(user: User) {
    this.user = user;
    this.isGuest = false;
    this.saveToStorage();
  }

  changeUser(data: { user_id: string, field: string, value: any }) {
    if (this.user && data.user_id === this.user._id) {
      // @ts-ignore
      this.user[data.field] = data.value;
    }
  }

  setLogin(token: string, refreshToken?: string) {
    this.token = token;
    if (refreshToken !== undefined) this.refreshToken = refreshToken;
    this.isGuest = false;
    this.saveToStorage();
  }

  logout() {
    this.user = null;
    this.token = '';
    this.refreshToken = '';
    this.isGuest = true;
    this.clearStorage();
    console.log('🚪 用户已登出，转为游客');
  }

  private saveToStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('gameSession', JSON.stringify({
        token: this.token,
        refresh_token: this.refreshToken,
        user: omit(this.user, ['atline']),
      }));
    } catch (error) {
      console.error('❌ 保存本地存储失败:', error);
    }
  }

  private clearStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem('gameSession');
    } catch (error) {
      console.error('❌ 清除本地存储失败:', error);
    }
  }
}

/** 单例：services/api.ts 直接引用这个实例（不经过 stores/index，避免循环依赖） */
export const authStore = new AuthStore();
