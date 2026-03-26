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
  isLoggedIn = false;
  isGuest = false;
  token: string = '';

  constructor() {
    makeAutoObservable(this);
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const session = localStorage.getItem('gameSession');
      if (session) {
        const { token = '', user } = JSON.parse(session);
        this.token = token;
        this.user = user;
        console.log('📦 从本地存储加载会话');
      }
    } catch (error) {
      console.error('❌ 加载本地存储失败:', error);
      this.clearStorage();
    }
  }

  setUser(user: User) {
    this.user = user;
    this.isLoggedIn = true;
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
    this.isLoggedIn = true;
    this.isGuest = false;
    this.saveToStorage();
    console.log('✅ 用户登陆成功:');
  }

  setGuest(user_id: string) {
    this.isLoggedIn = true;
    this.isGuest = true;
    this.saveToStorage();
    console.log('✅ 游客模式:', user_id);
  }

  logout() {
    this.user = null;
    this.token = '';
    this.isLoggedIn = false;
    this.isGuest = false;
    this.clearStorage();
    console.log('🚪 用户已登出');
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
