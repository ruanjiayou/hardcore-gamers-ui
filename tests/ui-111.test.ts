import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

describe('UI-111 皮肤即改即显 / 清单过桥 / 合并加载态', () => {
  test('assets 服务提供清单过桥 API：持久化 + 首帧恢复 + 预解码', () => {
    const code = compact(read('src/services/assets.ts'));
    expect(code).toContain('exportfunctionsaveGameManifest(');
    expect(code).toContain('exportfunctionhydrateGameAssets(');
    expect(code).toContain('exportasyncfunctionprewarmGameAssets(');
    expect(code).toContain('sessionStorage.setItem(SESSION_MANIFEST_PREFIX+game');
    expect(code).toContain('sessionStorage.getItem(SESSION_MANIFEST_PREFIX+game');
  });

  test('markEquipped 不可变更新、广播事件并返回新清单', () => {
    const code = compact(read('src/services/assets.ts'));
    const body = code.slice(code.indexOf('exportfunctionmarkEquipped('));
    expect(body).toContain('saveGameManifest(game,next)');
    expect(body).not.toContain('m.equippedByGroup={');
    expect(code).toContain("ASSETS_CHANGED_EVENT='lobby:assets-changed'");
    expect(body).toContain('newCustomEvent(ASSETS_CHANGED_EVENT');
    expect(body).toContain('returnnext');
  });

  test('皮肤页与主页当前皮肤都监听清单变更', () => {
    for (const file of [
      'src/pages/game/snake/Skins.tsx',
      'src/pages/game/snake/index.tsx',
    ]) {
      expect(compact(read(file))).toContain('subscribeAssets(');
    }
  });

  // GM-snake-42：外观（皮肤/食物/道具）从设置弹框里整块移走，改在主页与皮肤列表页展示。
  // 这里锁死「设置里不再出现外观」——否则以后又会有人顺手把皮肤小图塞回去。
  test('设置弹框不再包含外观分区', () => {
    const settings = compact(read('src/components/GameSettings.tsx'));
    expect(settings).not.toContain('assetSections');
    expect(settings).not.toContain('SkinPreview');
    expect(settings).not.toContain('equipSkin(');
    expect(settings).not.toContain('settings-packs');
  });

  test('进度页把按游戏清单写进会话存储，供下一份文档首帧复用', () => {
    const code = read('src/navigation.ts');
    const prefetch = code.slice(code.indexOf('export async function prefetchTarget('), code.indexOf('// ---- 热导航标记'));
    expect(prefetch).toContain('saveGameManifest(');
  });

  test('AppBootstrap 在游戏入口同步 hydrate，不再出现旋转 Loading 中间态', () => {
    const code = compact(read('src/bootstrap/AppBootstrap.tsx'));
    expect(code).toContain('hydrateGameAssets(');
    expect(code).toContain('prewarmGameAssets(');
    // 游戏入口冷启动用进度层，不再 setIsLoading(true)
    expect(code).toContain('constshowSpinner=!bootedRef.current&&!warmRef.current&&!gameSlugOf(');
    // 进度层只在 finally 收尾，预取结束不提前撤
    expect((code.match(/stopEntryLoader\(\)/g) || []).length).toBe(1);
    const finallyAt = code.lastIndexOf('finally{');
    expect(code.indexOf('stopEntryLoader()', finallyAt)).toBeGreaterThan(finallyAt);
    expect(code.indexOf('startEntryLoader()')).toBeLessThan(finallyAt);
  });

  test('主页清单未就绪时不写默认皮肤文案', () => {
    const code = read('src/pages/game/snake/index.tsx');
    expect(code).not.toContain('默认皮肤');
  });
});
