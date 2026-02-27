import { makeAutoObservable } from 'mobx';

export interface User {
  _id: string;
  name: string;
  email?: string;
  avatar?: string;
  level?: number;
  rating?: number;
  stats?: {
    wins: number;
    losses: number;
    totalGames: number;
    winRate: number;
  };
}

class AuthStore {
  user_id: string | null = null;
  user: User | null = null;
  isLoggedIn = false;
  isGuest = false;
  token: string | null = null;

  constructor() {
    makeAutoObservable(this);
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const session = localStorage.getItem('gameSession');
      if (session) {
        const { user_id, isLoggedIn, isGuest } = JSON.parse(session);
        this.user_id = user_id;
        this.isLoggedIn = isLoggedIn;
        this.isGuest = isGuest;
        console.log('📦 从本地存储加载会话:', { user_id, isLoggedIn, isGuest });
      }
    } catch (error) {
      console.error('❌ 加载本地存储失败:', error);
      this.clearStorage();
    }
  }

  setLogin(user: User, token: string) {
    this.user = user;
    this.user_id = user._id;
    this.token = token;
    this.isLoggedIn = true;
    this.isGuest = false;
    this.saveToStorage();
    console.log('✅ 用户登陆成功:', user.name);
  }

  setGuest(user_id: string) {
    this.user_id = user_id;
    this.isLoggedIn = false;
    this.isGuest = true;
    this.saveToStorage();
    console.log('✅ 游客模式:', user_id);
  }

  logout() {
    this.user_id = null;
    this.user = null;
    this.token = null;
    this.isLoggedIn = false;
    this.isGuest = false;
    this.clearStorage();
    console.log('🚪 用户已登出');
  }

  private saveToStorage() {
    try {
      localStorage.setItem('gameSession', JSON.stringify({
        user_id: this.user_id,
        isLoggedIn: this.isLoggedIn,
        isGuest: this.isGuest
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

export const authStore = new AuthStore();