import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import {
  getMyPlayerProfile, updateMyPlayerProfile,
  type PlayerProfileData,
} from '../services/api';
import { go, playerUrl } from '../navigation';
import '../styles/profile.css';

/** 头像：完整 URL / data:image 用 img，否则当 emoji 文本 */
const Avatar = ({ value }: { value: string }) => {
  if (!value) return <span>👤</span>;
  if (/^(https?:)?\/\/|^data:image\//.test(value)) return <img src={value} alt="" />;
  return <span>{value}</span>;
};

/**
 * 玩家中心（player 表，UI-107）：路由 `/lobby/game/<slug>/me`，
 * 展示并可编辑**本游戏 player** 的昵称/头像；改的是 player 表，不回写 user 表。
 */
export const PlayerCenter = observer(({ slug }: { slug: string }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PlayerProfileData | null>(null);
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setError('');
    getMyPlayerProfile(slug).then(res => {
      if (!alive) return;
      if (res.data.code !== 0) {
        setError(res.data.message || '请先登录');
        return;
      }
      const p = res.data.data.player;
      setProfile(p);
      setNickname(p.nickname);
      setAvatar(p.avatar);
    }).catch(() => alive && setError('加载失败，请稍后再试'));
    return () => { alive = false; };
  }, [slug]);

  const save = async () => {
    if (!profile || saving) return;
    setSaving(true);
    try {
      const res = await updateMyPlayerProfile(slug, { nickname, avatar });
      if (res.data.code === 0) setProfile(res.data.data.player);
      else setError(res.data.message || '保存失败');
    } catch {
      setError('保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="profile-page">
        <div className="profile-head">
          <button className="profile-back" onClick={() => navigate(-1)} aria-label="返回">←</button>
          <h2>玩家中心</h2>
        </div>
        <div className="profile-empty">{error}</div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-head">
        <button className="profile-back" onClick={() => navigate(-1)} aria-label="返回">←</button>
        <h2>玩家中心</h2>
        {profile && (
          <button className="profile-link" onClick={() => go(playerUrl(slug, profile.player_id))}>
            玩家公开主页 →
          </button>
        )}
      </div>

      {!profile && <div className="profile-empty">加载中…</div>}

      {profile && (
        <>
          <section className="profile-card">
            <h3>本游戏玩家资料</h3>
            <div className="profile-avatar-row">
              <div className="profile-avatar"><Avatar value={avatar || profile.avatar} /></div>
              <p className="profile-hint">头像支持 emoji 或图片 URL，暂不支持上传文件。</p>
            </div>
            <label className="profile-field">
              <span>玩家昵称</span>
              <input value={nickname} maxLength={20} onChange={e => setNickname(e.target.value)} />
            </label>
            <label className="profile-field">
              <span>头像（emoji / URL）</span>
              <input value={avatar} maxLength={500} onChange={e => setAvatar(e.target.value)} />
            </label>
            <div className="profile-actions">
              <button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存资料'}</button>
            </div>
          </section>

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
        </>
      )}
    </div>
  );
});

export default PlayerCenter;
