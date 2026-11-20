import { makeAutoObservable } from 'mobx';

/**
 * 全局 UI 状态：目前只有"需要登录"提示。
 * 未登录游客可以浏览大厅，但进入游戏/房间一律走这里弹提示（而不是直接跳登录页）。
 */
export default class UiStore {
  loginPromptOpen = false;
  loginPromptText = '登录后才能开始游戏';

  constructor() {
    makeAutoObservable(this);
  }

  openLoginPrompt(text?: string) {
    this.loginPromptText = text || '登录后才能开始游戏';
    this.loginPromptOpen = true;
  }

  closeLoginPrompt() {
    this.loginPromptOpen = false;
  }
}
