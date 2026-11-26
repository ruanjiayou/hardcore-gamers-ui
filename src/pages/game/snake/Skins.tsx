import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../../../stores';
import { getManifest, loadGameAssets, markEquipped } from '../../../services/assets';
import { equipSkin, type AssetManifest, type AssetManifestItem } from '../../../services/api';
import { notificationManager } from '../../../components/Notifications';
import { gameUrl, go } from '../../../navigation';
import '../../../styles/skins.css';

const slug = 'snake' as const;

/** 皮肤页（UI-069）：manifest.skins 多行多列 grid，卡片底部「已拥有 / 获取」。 */
export const SkinsPage = observer(() => {
  const [manifest, setManifest] = useState<AssetManifest | null>(() => getManifest(slug) || null);

  useEffect(() => {
    let alive = true;
    setManifest(getManifest(slug) || null);
    loadGameAssets(slug).then(m => { if (alive && m) setManifest(m); });
    return () => { alive = false; };
  }, [slug]);

  const choose = async (item: AssetManifestItem) => {
    if (!item.owned) { notificationManager.show('该皮肤尚未拥有，请在商店获取', 'warning'); return; }
    if (!store.auth.isLoggedIn) { store.ui.openLoginPrompt('登录后才能更换皮肤'); return; }
    try {
      const res = await equipSkin(slug, item.id);
      if (res.data?.code !== 0) { notificationManager.show(res.data?.message || '更换失败', 'warning'); return; }
      markEquipped(slug, item.id);
      setManifest(getManifest(slug) || null);
      notificationManager.show('皮肤已更换，下一局生效', 'success');
    } catch (e: any) {
      notificationManager.show(e?.message || '更换失败', 'warning');
    }
  };

  const skins = manifest?.skins || [];
  const equipped = manifest?.equipped || '';

  return (
    <div className="skins-page">
      <header className="skins-header">
        <button className="game-back is-close" onClick={() => go(gameUrl(slug))} aria-label="返回">×</button>
        <h2>🎨 皮肤</h2>
      </header>
      <div className="skins-body">
        {skins.length === 0 ? (
          <p className="skins-empty">当前游戏暂无可选皮肤</p>
        ) : (
          <div className="skins-grid">
            {skins.map(item => (
              <div key={item.id} className={`skin-card${item.id === equipped ? ' equipped' : ''}${item.owned ? '' : ' locked'}`}>
                <div className="skin-cover">
                  {item.url
                    ? <img src={item.url} alt={item.label} />
                    : <span aria-hidden>🐍</span>}
                </div>
                <div className="skin-name">{item.label}</div>
                <div className="skin-foot">
                  {item.id === equipped
                    ? <span className="skin-state active">使用中</span>
                    : item.owned
                      ? <button onClick={() => void choose(item)}>已拥有</button>
                      : <span className="skin-state">获取</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default SkinsPage;
