import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx';
import store from '../stores';
import { changePassword, updateProfile } from '../services/api';
import { notificationManager } from '../components/Notifications';
import { LoginRequiredPanel } from '../components/LoginRequired';
import '../styles/profile.css';

/**
 * 个人中心（UI-044）：头像菜单「个人资料」升级而来。
 * 可改昵称、头像、手机、邮箱，以及修改密码。
 * 昵称/头像由服务端同步到该用户在各游戏的 player（房间、排行榜显示的是 player）。
 */
export const ProfilePage = observer(() => {
  const navigate = useNavigate();
  const user = store.auth.user;
  const local = useLocalObservable(() => ({
    nickname: user?.nickname || user?.name || '',
    avatar: user?.avatar || '',
    email: user?.email || '',
    phone: user?.phone || '',
    saving: false,
    oldPass: '',
    newPass: '',
    newPass2: '',
    changing: false,
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
      email: user.email || '',
      phone: user.phone || '',
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
        email: local.email.trim(),
        phone: local.phone.trim(),
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

  const savePassword = async () => {
    if (local.changing) return;
    if (local.newPass.length < 6 || local.newPass.length > 18) {
      notificationManager.show('新密码长度需为 6–18 位', 'warning');
      return;
    }
    if (local.newPass !== local.newPass2) {
      notificationManager.show('两次输入的新密码不一致', 'warning');
      return;
    }
    local.setV({ changing: true });
    try {
      const res = await changePassword(local.oldPass, local.newPass);
      if (res.data.code !== 0) {
        notificationManager.show(res.data.message || '修改失败', 'warning');
        return;
      }
      local.setV({ oldPass: '', newPass: '', newPass2: '' });
      notificationManager.show('密码已修改', 'success');
    } catch {
      notificationManager.show('修改失败，请稍后再试', 'warning');
    } finally {
      local.setV({ changing: false });
    }
  };

  const avatarIsImage = /^(https?:)?\/\/|^data:image\//.test(local.avatar.trim());

  return (
    <div className="profile-page">
      <div className="profile-head">
        <button className="profile-back" onClick={() => navigate(-1)} aria-label="返回">←</button>
        <h2>个人中心</h2>
        <button className="profile-link" onClick={() => navigate(`/user/${user._id}`)}>公开主页 →</button>
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
        <label className="profile-field">
          <span>手机</span>
          <input
            type="tel"
            placeholder="选填"
            value={local.phone}
            onChange={e => local.setV({ phone: e.target.value })}
          />
        </label>
        <label className="profile-field">
          <span>邮箱</span>
          <input
            type="email"
            placeholder="选填"
            value={local.email}
            onChange={e => local.setV({ email: e.target.value })}
          />
        </label>

        <div className="profile-actions">
          <button className="primary" disabled={local.saving} onClick={saveProfile}>
            {local.saving ? '保存中…' : '保存资料'}
          </button>
        </div>
      </section>

      <section className="profile-card">
        <h3>修改密码</h3>
        <label className="profile-field">
          <span>旧密码</span>
          <input type="password" value={local.oldPass} onChange={e => local.setV({ oldPass: e.target.value })} />
        </label>
        <label className="profile-field">
          <span>新密码</span>
          <input type="password" placeholder="6–18 位" value={local.newPass} onChange={e => local.setV({ newPass: e.target.value })} />
        </label>
        <label className="profile-field">
          <span>确认新密码</span>
          <input type="password" value={local.newPass2} onChange={e => local.setV({ newPass2: e.target.value })} />
        </label>
        <div className="profile-actions">
          <button className="ghost" disabled={local.changing} onClick={savePassword}>
            {local.changing ? '提交中…' : '修改密码'}
          </button>
        </div>
      </section>
    </div>
  );
});

export default ProfilePage;
