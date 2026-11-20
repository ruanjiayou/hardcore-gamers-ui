import { makeAutoObservable } from 'mobx';
import { omit } from 'lodash';

export interface User {
  _id: string;
  name: string;
  avatar?: string;
  atline?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export default class AuthStore {
  user: User | null = null;
  /** 游客模式标记：未登录时也可能是游客（大厅可浏览、游戏需登录） */
  isGuest = false;
  token: string = '';

  constructor() {
    makeAutoObservable(this);
    this.loadFromStorage();
  }

  /** 是否已登录：以 token + user 为准（刷新后 isLoggedIn 不能丢） */
  get isLoggedIn() {
    return !!this.token && !!this.user?._id;
  }

  private loadFromStorage() {
    try {
      const session = localStorage.getItem('gameSession');
      if (session) {
        const { token = '', user = null } = JSON.parse(session);
        this.token = token || '';
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

  setLogin(token: string) {
    this.token = token;
    this.isGuest = false;
    this.saveToStorage();
    console.log('✅ 用户登陆成功:');
  }

  logout() {
    this.user = null;
    this.token = '';
    this.isGuest = true;
    this.clearStorage();
    console.log('🚪 用户已登出，转为游客');
  }

  private saveToStorage() {
    try {
      localStorage.setItem('gameSession', JSON.stringify({
        token: this.token,
        user: omit(this.user, ['atline']),
      }));
    } catch (error) {
      console.error('❌ 保存本地存储失败:', error);
    }
  }

  private clearStorage() {
    try {
      localStorage.removeItem('gameSession');
    } catch (error) {
      console.error('❌ 清除本地存储失败:', error);
    }
  }
}
