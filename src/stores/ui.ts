import { makeAutoObservable } from 'mobx';

/** 房间邀请（服务端 invite:received 推送）：右上角常驻，接受/拒绝后才消失 */
export interface RoomInvite {
  invite_id: string;
  room_id: string;
  slug: string;
  game_title?: string;
  room_name?: string;
  from: { user_id: string, nickname: string, avatar?: string };
  expires_at?: number;
}

/**
 * 全局 UI 状态："需要登录"提示、连接状态、房间邀请。
 * 未登录游客可以浏览大厅，但进入游戏/房间一律走这里弹提示（而不是直接跳登录页）。
 */
export default class UiStore {
  loginPromptOpen = false;
  loginPromptText = '登录后才能开始游戏';
  /** WebSocket 连接状态：驱动顶栏头像的绿色辉光 / 断线裂开效果 */
  socketConnected = false;
  /** 待处理的房间邀请（可能多条） */
  invites: RoomInvite[] = [];

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

  addInvite(invite: RoomInvite) {
    if (!invite?.invite_id) return;
    if (this.invites.some(i => i.invite_id === invite.invite_id)) return;
    this.invites.push(invite);
  }

  removeInvite(invite_id: string) {
    this.invites = this.invites.filter(i => i.invite_id !== invite_id);
  }
}
