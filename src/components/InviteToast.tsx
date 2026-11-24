import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores';
import type { RoomInvite } from '../stores/ui';
import { getSocket, SendoutEvent } from '../services/socket';
import { notificationManager } from './Notifications';
import '../styles/invite.css';

/**
 * 房间邀请提示（UI-048）：
 * 房间内的玩家可以按用户名邀请好友，被邀请人右上角出现一条常驻卡片，
 * **点接受或拒绝后才会消失**（服务端同时删掉邀请，2 分钟未处理自动失效）。
 * 接受成功直接跳进该游戏的那个房间。
 */
export const InviteToasts = observer(() => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string>('');

  const respond = (invite: RoomInvite, accept: boolean) => {
    if (busy) return;
    setBusy(invite.invite_id);
    const socket = getSocket();
    if (!socket) {
      setBusy('');
      return;
    }
    socket.emit(SendoutEvent.RespondInvite, { invite_id: invite.invite_id, accept }, (ok: boolean, message?: string) => {
      setBusy('');
      // 无论接受还是拒绝，这条提示都消失
      store.ui.removeInvite(invite.invite_id);
      if (accept && ok) {
        notificationManager.show(message || '已加入房间', 'success');
        // 服务端已把自己加入房间，直接跳进该房间
        navigate(`/game/${invite.slug}/room/${invite.room_id}`);
        return;
      }
      if (accept) notificationManager.show(message || '加入失败', 'warning');
    });
  };

  if (!store.ui.invites.length) return null;

  return (
    <div className="invite-toasts">
      {store.ui.invites.map(invite => {
        const from = invite.from || { user_id: '', nickname: '玩家' };
        return (
          <div className="invite-card" key={invite.invite_id} role="dialog" aria-label="房间邀请">
            <div className="invite-head">
              <span className="invite-avatar">{from.avatar || '👤'}</span>
              <div className="invite-text">
                <strong>{from.nickname}</strong>
                <p>邀请你加入「{invite.room_name || invite.game_title || '房间'}」</p>
              </div>
            </div>
            <div className="invite-meta">{invite.game_title || invite.slug} · 2 分钟内有效</div>
            <div className="invite-actions">
              <button
                className="invite-reject"
                disabled={busy === invite.invite_id}
                onClick={() => respond(invite, false)}
              >拒绝</button>
              <button
                className="invite-accept"
                disabled={busy === invite.invite_id}
                onClick={() => respond(invite, true)}
              >{busy === invite.invite_id ? '加入中…' : '接受'}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default InviteToasts;
