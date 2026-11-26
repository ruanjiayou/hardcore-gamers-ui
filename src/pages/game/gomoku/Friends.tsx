import React, { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  getFriends, getRecentPlaymates, getFriendRequests, sendFriendRequest, acceptFriendRequest,
  rejectFriendRequest, cancelFriendRequest, removeFriend,
  type FriendUser, type FriendRequestItem, type RecentPlaymate,
} from '../../../services/api';
import { getSocket, ReceiveEvent } from '../../../services/socket';
import { notificationManager } from '../../../components/Notifications';
import { gameUrl, go } from '../../../navigation';
import '../../../styles/friends.css';

const slug = 'gomoku' as const;

/**
 * 好友页（UI-068 / UI-071）：从游戏主页顶栏多人 icon 进入。
 * 主体是**玩家**（player_id）、按游戏隔离；申请 30min TTL，实时推送后自动刷新。
 */
export const FriendsPage = observer(() => {
  const [tab, setTab] = useState<'friends' | 'recent'>('friends');
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [recent, setRecent] = useState<RecentPlaymate[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, p, r] = await Promise.all([getFriends(slug), getRecentPlaymates(slug), getFriendRequests(slug)]);
      if (f.data?.code === 0) setFriends(f.data.data?.list || []);
      if (p.data?.code === 0) setRecent(p.data.data?.list || []);
      if (r.data?.code === 0) {
        setIncoming(r.data.data?.incoming || []);
        setOutgoing(r.data.data?.outgoing || []);
      }
    } catch (e: any) {
      notificationManager.show(e?.message || '加载好友失败', 'warning');
    }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  // 玩家可能正停在好友页等着：收到申请/结果就重新拉一遍（UI-071）
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => { void load(); };
    socket.on(ReceiveEvent.FriendRequest, refresh);
    socket.on(ReceiveEvent.FriendResult, refresh);
    return () => {
      socket.off(ReceiveEvent.FriendRequest, refresh);
      socket.off(ReceiveEvent.FriendResult, refresh);
    };
  }, [load]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res.data?.code === 0) { notificationManager.show(ok, 'success'); await load(); }
      else notificationManager.show(res.data?.message || '操作失败', 'warning');
    } catch (e: any) {
      notificationManager.show(e?.message || '操作失败', 'warning');
    } finally { setBusy(false); }
  };

  const display = (u: FriendUser | null, fallback: string) => u?.nickname || fallback;
  const avatar = (u: FriendUser | null) => u?.avatar || '👤';
  const time = (s: string) => s ? new Date(Number(s)).toLocaleString() : '';

  return (
    <div className="friends-page">
      <header className="friends-header">
        <button className="game-back is-close" onClick={() => go(gameUrl(slug))} aria-label="返回">×</button>
        <h2>👥 好友</h2>
      </header>

      <div className="friends-body">
        <section className="friends-section">
          <h3>添加好友</h3>
          <div className="friends-add">
            <input
              type="text"
              value={target}
              placeholder="对方玩家 ID 或昵称"
              onChange={e => setTarget(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && target.trim() && !busy) {
                void run(() => sendFriendRequest(slug, target.trim()), '申请已发出，等对方同意');
                setTarget('');
              } }}
            />
            <button
              disabled={busy || !target.trim()}
              onClick={() => { void run(() => sendFriendRequest(slug, target.trim()), '申请已发出，等对方同意'); setTarget(''); }}
            >发送申请</button>
          </div>
          <p className="friends-hint">好友按游戏区分；添加需要对方同意，申请 30 分钟内有效。</p>
        </section>

        <section className="friends-section">
          <h3>收到的申请 {incoming.length > 0 && <span className="friends-count">{incoming.length}</span>}</h3>
          {incoming.length === 0 ? <p className="friends-empty">暂无新申请</p> : (
            <ul className="friends-list">
              {incoming.map(r => (
                <li key={r.invite_id}>
                  <span className="friends-avatar">{avatar(r.user)}</span>
                  <span className="friends-name">{display(r.user, r.from)}</span>
                  <span className="friends-time">{time(r.created_at)}</span>
                  <button disabled={busy} onClick={() => void run(() => acceptFriendRequest(r.invite_id), '已添加为好友')}>接受</button>
                  <button className="ghost" disabled={busy} onClick={() => void run(() => rejectFriendRequest(r.invite_id), '已拒绝')}>拒绝</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="friends-section">
          <h3>发出的申请 {outgoing.length > 0 && <span className="friends-count">{outgoing.length}</span>}</h3>
          {outgoing.length === 0 ? <p className="friends-empty">没有待处理的申请</p> : (
            <ul className="friends-list">
              {outgoing.map(r => (
                <li key={r.invite_id}>
                  <span className="friends-avatar">{avatar(r.user)}</span>
                  <span className="friends-name">{display(r.user, r.to)}</span>
                  <span className="friends-time">{time(r.created_at)}</span>
                  <button className="ghost" disabled={busy} onClick={() => void run(() => cancelFriendRequest(r.invite_id), '已撤回申请')}>撤回</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="friends-section">
          <div className="friends-tabs" role="tablist">
            <button
              className={`friends-tab ${tab === 'friends' ? 'active' : ''}`}
              role="tab" aria-selected={tab === 'friends'}
              onClick={() => setTab('friends')}
            >好友 <span className="friends-count">{friends.length}</span></button>
            <button
              className={`friends-tab ${tab === 'recent' ? 'active' : ''}`}
              role="tab" aria-selected={tab === 'recent'}
              onClick={() => setTab('recent')}
            >最近 <span className="friends-count">{recent.length}</span></button>
          </div>
          {tab === 'friends' ? (
            friends.length === 0 ? <p className="friends-empty">还没有好友，去添加一位吧</p> : (
              <ul className="friends-list">
                {friends.map(f => (
                  <li key={f.player_id}>
                    <span className="friends-avatar">{avatar(f)}</span>
                    <span className="friends-name">{display(f, f.player_id)} · Lv.{f.level ?? 1}</span>
                    <button
                      className="ghost danger"
                      disabled={busy}
                      onClick={() => void run(() => removeFriend(slug, f.player_id), '已删除好友')}
                    >删除</button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            recent.length === 0 ? <p className="friends-empty">还没有最近一起玩过的玩家</p> : (
              <ul className="friends-list">
                {recent.map(p => {
                  const isFriend = friends.some(f => f.player_id === p.player_id);
                  return (
                    <li key={p.player_id}>
                      <span className="friends-avatar">{avatar(p)}</span>
                      <span className="friends-name">{display(p, p.player_id)} · Lv.{p.level ?? 1}</span>
                      {isFriend ? (
                        <span className="friends-badge">友</span>
                      ) : (
                        <button
                          className="friends-add-icon"
                          title="加好友"
                          aria-label="加好友"
                          disabled={busy}
                          onClick={() => void run(() => sendFriendRequest(slug, p.player_id), '申请已发出，等对方同意')}
                        >＋</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </section>
      </div>
    </div>
  );
});

export default FriendsPage;
