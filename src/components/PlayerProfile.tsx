import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import {
  getPlayerProfile, getPlayerRecords,
  type GameRecord, type PlayerProfileData,
} from '../services/api';
import ReplayModal from './Replay';
import '../styles/profile.css';

/** 有回放的棋类（与服务端白名单一致：国际象棋历史 ID 是 international-chess，不是 chess） */
const REPLAY_GAMES = ['gomoku', 'xiangqi', 'othello', 'international-chess'];

/**
 * 玩家公开主页（player 表）：路由 `/lobby/game/<slug>/player/:player_id`，
 * 只展示该玩家在这一个游戏里的资料与战绩，数据取自 player 表，不是 user 表。
 */
export const PlayerProfile = observer(({ slug, playerId }: { slug: string; playerId: string }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PlayerProfileData | null>(null);
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
    getPlayerProfile(slug, playerId).then(res => {
      if (!alive) return;
      if (res.data.code !== 0) {
        setError(res.data.message || '玩家不存在');
        return;
      }
      setProfile(res.data.data.player);
    }).catch(() => alive && setError('加载失败，请稍后再试'));
    return () => { alive = false; };
  }, [playerId, slug]);

  useEffect(() => {
    if (!playerId || tab !== 'records') return;
    let alive = true;
    setRecordsLoading(true);
    getPlayerRecords(slug, playerId, 0, 20).then(res => {
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

  return (
    <div className="profile-page public-profile">
      <div className="profile-head">
        <button className="profile-back" onClick={() => navigate(-1)} aria-label="返回">←</button>
        <h2>玩家公开主页</h2>
      </div>

      {!profile && <div className="profile-empty">加载中…</div>}

      {profile && (
        <>
          <div className="public-header">
            <div className="public-avatar">
              {profile.avatar
                ? (/^(https?:)?\/\/|^data:image\//.test(profile.avatar)
                  ? <img src={profile.avatar} alt="" />
                  : <span>{profile.avatar}</span>)
                : <span>👤</span>}
            </div>
            <div className="public-name">
              <h1>{profile.nickname}</h1>
              <p>本游戏玩家 · Lv.{profile.level} · {profile.score} 分</p>
            </div>
          </div>

          <div className="profile-tabs">
            <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>战绩总览</button>
            <button className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>对局记录</button>
          </div>

          {tab === 'overview' && (
            <section className="profile-card">
              <h3>本游戏战绩</h3>
              <div className="stat-grid">
                <div className="stat-cell"><span>等级</span><strong>Lv.{profile.level}</strong></div>
                <div className="stat-cell"><span>分数</span><strong>{profile.score}</strong></div>
                <div className="stat-cell"><span>对局</span><strong>{profile.stats.matches}</strong></div>
                <div className="stat-cell"><span>胜率</span><strong>{profile.win_rate}%</strong></div>
                <div className="stat-cell"><span>胜</span><strong className="win">{profile.stats.winners}</strong></div>
                <div className="stat-cell"><span>和</span><strong>{profile.stats.draws}</strong></div>
                <div className="stat-cell"><span>负</span><strong className="lose">{Math.max(0, profile.stats.matches - profile.stats.winners - profile.stats.draws)}</strong></div>
                <div className="stat-cell"><span>认输</span><strong>{profile.stats.flees}</strong></div>
              </div>
              {profile.boards && Object.keys(profile.boards).length > 0 && (
                <p className="profile-hint">
                  分榜最高分：{Object.entries(profile.boards).map(([k, v]) => `${k} ${v}`).join(' · ')}
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

      {replayId && <ReplayModal match_id={replayId} onClose={() => setReplayId('')} />}
    </div>
  );
});

export default PlayerProfile;
