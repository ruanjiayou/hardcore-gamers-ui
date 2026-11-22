import { makeAutoObservable } from 'mobx';

/**
 * 全局 UI 状态：目前只有"需要登录"提示。
 * 未登录游客可以浏览大厅，但进入游戏/房间一律走这里弹提示（而不是直接跳登录页）。
 */
export default class UiStore {
  loginPromptOpen = false;
  loginPromptText = '登录后才能开始游戏';
  /** WebSocket 连接状态：驱动顶栏头像的绿色辉光 / 断线裂开效果 */
  socketConnected = false;

  constructor() {
    makeAutoObservable(this);
  }

  setSocketConnected(connected: boolean) {
    this.socketConnected = connected;
  }

  openLoginPrompt(text?: string) {
    this.loginPromptText = text || '登录后才能开始游戏';
    this.loginPromptOpen = true;
  }

  closeLoginPrompt() {
    this.loginPromptOpen = false;
  }
}
