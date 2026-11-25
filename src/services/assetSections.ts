/**
 * 每个游戏自己的外观分区声明（UI-058）。
 *
 * 分组名由资源表给：服务端只按名字分组、不解释含义，所以**清单里有哪些分组，
 * 这个游戏就显示哪些分区** —— 黑白棋的清单里没有贪吃蛇的 `snake` 分组，
 * 它的设置弹框里也就不会出现蛇皮肤。
 *
 * 这里登记的只是「这个分组在界面上叫什么、什么图标」，是纯展示文案：
 * - 登记过的分组用登记的标题；
 * - 没登记但清单里有的分组（后台新配的）用通用词表兜底，再不行就显示分组名。
 *
 * 新增游戏只加自己那一项，不会影响别的游戏。
 */
export interface AssetSection {
  /** 资源分组名（与 `manifest.groups` 的 key 对应） */
  group: string;
  /** 界面标题 */
  title: string;
  /** 标题前的图标 */
  icon: string;
}

/** 各游戏的外观分区登记（只登记本游戏用到的分组） */
const SECTIONS: Record<string, AssetSection[]> = {
  snake: [
    { group: 'snake', title: '蛇皮肤', icon: '🐍' },
    { group: 'food', title: '食物外观', icon: '🍎' },
    { group: 'items', title: '道具外观', icon: '🧲' },
  ],
};

/** 没在游戏登记里的分组的通用标题 */
const FALLBACK_TITLES: Record<string, string> = {
  board: '棋盘',
  piece: '棋子',
  avatar: '头像',
};

/**
 * 按清单算出这个游戏要显示哪些分区。
 * @param game 游戏 slug
 * @param groups 清单里实际存在的分组名（`Object.keys(manifest.groups)`）
 */
export function assetSections(game: string, groups: string[]): AssetSection[] {
  const registered = SECTIONS[game] || [];
  const known = new Set(registered.map(s => s.group));
  const out: AssetSection[] = [];
  // 登记过的按登记顺序排前面
  for (const s of registered) {
    if (groups.includes(s.group)) out.push(s);
  }
  // 清单里有但没登记的（后台新配的分组）接在后面，标题用通用词表兜底
  for (const g of groups) {
    if (known.has(g)) continue;
    out.push({ group: g, title: FALLBACK_TITLES[g] || g, icon: '🎨' });
  }
  return out;
}
