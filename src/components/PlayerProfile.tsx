import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  getProfile, getRecords,
  type GameRecord, type ProfileGame, type PublicProfile,
} from '../services/api';
import ReplayModal from './Replay';
import { gameUrl, go } from '../navigation';
import '../styles/profile.css';

/** 有回放的棋类（与服务端白名单一致：国际象棋历史 ID 是 international-chess，不是 chess） */
const REPLAY_GAMES = ['gomoku', 'xiangqi', 'othello', 'international-chess'];

/**
 * 单游戏版玩家主页：从某个游戏主页进入，只展示该玩家在这一个游戏里的资料与战绩，
 * 不渲染横向游戏列表。
 */
export const PlayerProfile = observer(({ slug, playerId }: { slug: string; playerId: string }) => {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'records'>('overview');
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [replayId, setReplayId] = useState('');

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setError('');
    getProfile(playerId).then(res => {
      if (!alive) return;
      if (res.data.code !== 0) {
        setError(res.data.message || '用户不存在');
        return;
      }
      setProfile(res.data.data);
    }).catch(() => alive && setError('加载失败，请稍后再试'));
    return () => { alive = false; };
  }, [playerId]);

  useEffect(() => {
    if (!playerId || tab !== 'records') return;
    let alive = true;
    setRecordsLoading(true);
    getRecords(playerId, slug, 0, 20).then(res => {
      if (!alive) return;
      if (res.data.code === 0) {
        setRecords(res.data.data.list || []);
        setTotal(res.data.data.total || 0);
      }
    }).finally(() => alive && setRecordsLoading(false));
    return () => { alive = false; };
  }, [playerId, slug, tab]);

  if (error) {
    return (
      <div className="profile-page">
        <div className="profile-empty">{error}</div>
      </div>
    );
  }

  const game: ProfileGame | undefined = profile?.games.find(g => g.slug === slug);

  return (
    <div className="profile-page public-profile">
      <div className="profile-head">
        <button className="profile-back" onClick={() => go(gameUrl(slug))} aria-label="返回">←</button>
        <h2>玩家主页</h2>
      </div>

      {!profile && <div className="profile-empty">加载中…</div>}

      {profile && (
        <>
          <div className="public-header">
            <div className="public-avatar">
              {profile.user.avatar
                ? (/^(https?:)?\/\/|^data:image\//.test(profile.user.avatar)
                  ? <img src={profile.user.avatar} alt="" />
                  : <span>{profile.user.avatar}</span>)
                : <span>👤</span>}
            </div>
            <div className="public-name">
              <h1>{profile.user.nickname || profile.user.name}</h1>
              <p>@{profile.user.name} · 加入于 {new Date(profile.user.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {!game && <div className="profile-empty">还没有玩过这个游戏</div>}

          {game && (
            <>
              <div className="profile-tabs">
                <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>战绩总览</button>
                <button className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>对局记录</button>
              </div>

              {tab === 'overview' && (
                <section className="profile-card">
                  <h3>{game.title || game.slug} 战绩</h3>
                  <div className="stat-grid">
                    <div className="stat-cell"><span>等级</span><strong>Lv.{game.level}</strong></div>
                    <div className="stat-cell"><span>分数</span><strong>{game.score}</strong></div>
                    <div className="stat-cell"><span>对局</span><strong>{game.stats.matches}</strong></div>
                    <div className="stat-cell"><span>胜率</span><strong>{game.win_rate}%</strong></div>
                    <div className="stat-cell"><span>胜</span><strong className="win">{game.stats.winners}</strong></div>
                    <div className="stat-cell"><span>和</span><strong>{game.stats.draws}</strong></div>
                    <div className="stat-cell"><span>负</span><strong className="lose">{Math.max(0, game.stats.matches - game.stats.winners - game.stats.draws)}</strong></div>
                    <div className="stat-cell"><span>认输</span><strong>{game.stats.flees}</strong></div>
                  </div>
                  {game.boards && Object.keys(game.boards).length > 0 && (
                    <p className="profile-hint">
                      分榜最高分：{Object.entries(game.boards).map(([k, v]) => `${k} ${v}`).join(' · ')}
                    </p>
                  )}
                </section>
              )}

              {tab === 'records' && (
                <section className="profile-card">
                  <h3>对局记录 <small>共 {total} 局</small></h3>
                  {recordsLoading && <p className="profile-hint">加载中…</p>}
                  {!recordsLoading && !records.length && <p className="profile-hint">暂无对局记录</p>}
                  <div className="record-list">
                    {records.map(r => {
                      const rival = r.players.find(p => p._id !== r.me?._id);
                      const resultText = r.result === 'win' ? '胜' : r.result === 'lose' ? '负' : r.result === 'draw' ? '和' : '单人';
                      return (
                        <div className="record-row" key={r._id}>
                          <span className={`record-result ${r.result}`}>{resultText}</span>
                          <div className="record-main">
                            <span className="record-name">
                              {r.result === 'solo'
                                ? '单人挑战'
                                : `vs ${rival?.nickname || '玩家'}${rival?.role ? `（${rival.role === 'red' ? '红' : rival.role === 'black' ? '黑' : rival.role}方）` : ''}`}
                            </span>
                            <span className="record-time">{new Date(r.updatedAt || r.createdAt).toLocaleString()}</span>
                          </div>
                          {r.me && r.result !== 'solo' && <span className="record-score">{r.me.score > 0 ? `+${r.me.score}` : r.me.score}</span>}
                          {REPLAY_GAMES.includes(r.game_id) && (
                            <button className="record-replay" onClick={() => setReplayId(r._id)}>回放</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {replayId && <ReplayModal match_id={replayId} onClose={() => setReplayId('')} />}
    </div>
  );
});

export default PlayerProfile;
