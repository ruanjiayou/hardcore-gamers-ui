import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx';
import store from '../stores';
import { updateProfile } from '../services/api';
import { notificationManager } from '../components/Notifications';
import { LoginRequiredPanel } from '../components/LoginRequired';
import '../styles/profile.css';

/**
 * 玩家中心 / 个人中心（UI-044、UI-051）：头像菜单进入。
 * 只留**头像 + 昵称 + 登录名（只读）**；手机、邮箱、密码都已按需求移除。
 * 昵称/头像由服务端同步到该用户在各游戏的 player（房间、排行榜显示的是 player）。
 *
 * `?game=slug` 表示「从某个游戏里进来的」：右上角的公开主页锁到本游戏，
 * 进去只看这个游戏的战绩与对局记录，而不是跨游戏的全部数据。
 */
export const ProfilePage = observer(() => {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const scopedGame = search.get('game') || '';
  const user = store.auth.user;
  const local = useLocalObservable(() => ({
    nickname: user?.nickname || user?.name || '',
    avatar: user?.avatar || '',
    saving: false,
    setV(o: Record<string, any>) {
      for (const k in o) {
        // @ts-ignore
        local[k] = o[k];
      }
    },
  }));

  // socket 拿到的用户信息可能比本地缓存新（改名/换头像后另一台设备也在改）
  useEffect(() => {
    if (!user) return;
    local.setV({
      nickname: user.nickname || user.name || '',
      avatar: user.avatar || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id, user?.nickname, user?.avatar]);

  if (!store.auth.isLoggedIn || !user) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入个人中心" />;
  }

  const saveProfile = async () => {
    if (local.saving) return;
    if (!local.nickname.trim()) {
      notificationManager.show('昵称不能为空', 'warning');
      return;
    }
    local.setV({ saving: true });
    try {
      const res = await updateProfile({
        nickname: local.nickname.trim(),
        avatar: local.avatar.trim(),
      });
      if (res.data.code !== 0) {
        notificationManager.show(res.data.message || '保存失败', 'warning');
        return;
      }
      const fresh = res.data.data;
      store.auth.setUser({ ...(toJS(store.auth.user) as any), ...fresh });
      // 房间/排行榜用的是 player 的昵称头像，本地也同步一份，避免刚改完名字列表还是旧的
      if (store.game.player) {
        store.game.setPlayer({ ...toJS(store.game.player), nickname: fresh.nickname, avatar: fresh.avatar });
      }
      notificationManager.show('资料已保存', 'success');
    } catch {
      notificationManager.show('保存失败，请稍后再试', 'warning');
    } finally {
      local.setV({ saving: false });
    }
  };

  const avatarIsImage = /^(https?:)?\/\/|^data:image\//.test(local.avatar.trim());

  return (
    <div className="profile-page">
      <div className="profile-head">
        <button className="profile-back" onClick={() => navigate(-1)} aria-label="返回">←</button>
        <h2>个人中心</h2>
        <button className="profile-link" onClick={() => navigate(`/user/${user._id}${scopedGame ? `?game=${scopedGame}` : ''}`)}>
          公开主页 →
        </button>
      </div>

      <section className="profile-card">
        <h3>基本资料</h3>
        <div className="profile-avatar-row">
          <div className="profile-avatar">
            {local.avatar
              ? (avatarIsImage
                ? <img src={local.avatar} alt="" />
                : <span>{local.avatar}</span>)
              : <span>👤</span>}
          </div>
          <div className="profile-avatar-input">
            <label>头像</label>
            <input
              type="text"
              placeholder="图片地址或 emoji（如 https://… 或 🐯）"
              value={local.avatar}
              onChange={e => local.setV({ avatar: e.target.value })}
            />
            <p className="profile-hint">暂不支持上传文件：填图片 URL 或一个 emoji 即可。</p>
          </div>
        </div>

        <label className="profile-field">
          <span>昵称</span>
          <input
            type="text"
            maxLength={20}
            placeholder="展示给其他玩家的名字"
            value={local.nickname}
            onChange={e => local.setV({ nickname: e.target.value })}
          />
        </label>
        <label className="profile-field">
          <span>登录名</span>
          <input type="text" value={user.name} disabled />
        </label>

        <div className="profile-actions">
          <button className="primary" disabled={local.saving} onClick={saveProfile}>
            {local.saving ? '保存中…' : '保存资料'}
          </button>
        </div>
      </section>
    </div>
  );
});

export default ProfilePage;
