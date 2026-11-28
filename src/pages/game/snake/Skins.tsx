import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../../../stores';
import { getManifest, subscribeAssets, loadGameAssets, markEquipped } from '../../../services/assets';
import { equipSkin, type AssetManifest, type AssetManifestItem } from '../../../services/api';
import { notificationManager } from '../../../components/Notifications';
import SkinPreview from '../../../components/SkinPreview';
import { gameUrl, go } from '../../../navigation';
import '../../../styles/skins.css';

const slug = 'snake' as const;

/**
 * 皮肤页（UI-069 / GM-snake-42）：manifest.skins 多行多列 grid。
 *
 * 卡片封面用 `SkinPreview` 画一条**竖着的整蛇**（头在上、尾在下），
 * 而不是单张身体贴图 —— 身体图只是一节花纹，头身 / 交替 / 有尾的皮肤在方块缩略图里
 * 全都长得一样，分不清买的是哪一个。
 * 底部三态：已装备「使用中」、已拥有「使用」、未拥有「🔒 未解锁」。
 */
export const SkinsPage = observer(() => {
  const [manifest, setManifest] = useState<AssetManifest | null>(() => getManifest(slug) || null);

  useEffect(() => {
    let alive = true;
    setManifest(getManifest(slug) || null);
    loadGameAssets(slug).then(m => { if (alive && m) setManifest(m); });
    const unsubscribe = subscribeAssets(slug, () => {
      if (alive) setManifest(getManifest(slug) || null);
    });
    return () => { alive = false; unsubscribe(); };
  }, [slug]);

  const choose = async (item: AssetManifestItem) => {
    if (!item.owned) { notificationManager.show('该皮肤尚未拥有，请在商店获取', 'warning'); return; }
    if (!store.auth.isLoggedIn) { store.ui.openLoginPrompt('登录后才能更换皮肤'); return; }
    try {
      const res = await equipSkin(slug, item.id);
      if (res.data?.code !== 0) { notificationManager.show(res.data?.message || '更换失败', 'warning'); return; }
      setManifest(markEquipped(slug, item.id) || null);
      notificationManager.show('皮肤已更换', 'success');
    } catch (e: any) {
      notificationManager.show(e?.message || '更换失败', 'warning');
    }
  };

  const skins = manifest?.skins || [];
  const equipped = manifest?.equipped || '';

  return (
    <div className="skins-page">
      <header className="skins-header">
        {/* GM-snake-46：皮肤页是「返回上一级」，不是关闭弹窗 —— 换成左箭头 */}
        <button className="game-back" onClick={() => go(gameUrl(slug))} aria-label="返回">
          <span className="game-back-arrow" aria-hidden />
        </button>
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
                  <SkinPreview game={slug} item={item} units={3} className="skin-cover-canvas" />
                </div>
                <div className="skin-name">{item.label}</div>
                <div className="skin-foot">
                  {item.id === equipped
                    ? <span className="skin-state active">使用中</span>
                    : item.owned
                      ? <button onClick={() => void choose(item)}>使用</button>
                      : <span className="skin-state lock">🔒 未解锁</span>}
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
