/**
 * 对局页左上角关闭按钮的语义决策（纯函数，无副作用，便于单测）。
 *
 * 背景：同一个「×」在不同场景下的语义完全不同，不能一律走"离开房间"：
 * - 单人游戏（临时房 transient）：离开即销毁房间 → 对用户是「退出游戏」，
 *   提示语不能说"房间已解散"（那是内部实现，用户并不关心）。
 * - 官方房间（official）/ 等待态房间：房间是公共桌，离开不销毁 → 对用户是「退出房间」。
 * - 多人房间对局中（组队/回合制）：服务端禁止直接离开，只能先结束本局
 *   → 对用户是「结束游戏」，结束后留在房间界面。
 *
 * 判定顺序：单人 > 无尽竞技（常驻对局，随时可走）> 对局中（结束本局）> 等待态（退出房间）。
 */
export type ExitIntentKind = 'exit-game' | 'exit-room' | 'end-game' | 'disband-room' | 'leave-room';

export interface ExitIntentContext {
  /** 单人玩法（无对手）：临时房，离开即销毁 */
  isSoloGame: boolean;
  /** 房间状态：waiting / playing / finished */
  roomStatus: string;
  /** 无尽竞技房：常驻对局，随时可以退出（不算逃跑） */
  isEndlessArena: boolean;
  /** 本局已自行结束（组队模式认输后）：已不在对局中，按退出房间处理 */
  endedMatch?: boolean;
  /** 团队房（UI-101）：房主解散、其他人离开；不传则维持旧的「退出房间」 */
  isTeamRoom?: boolean;
  /** 自建非官方房的房主：可真解散（服务端强校验）；团队房据此分化文案 */
  canDisband?: boolean;
}

export interface ExitIntent {
  kind: ExitIntentKind;
  /** 弹框标题 */
  title: string;
  /** 弹框提示 */
  hint: string;
  /** 主按钮文案 */
  confirmText: string;
  /** 成功后的提示 */
  successMessage: string;
  /** 主按钮是否表示"结束本局"（而不是离开房间） */
  endsMatch: boolean;
}

const EXIT_GAME: ExitIntent = {
  kind: 'exit-game',
  title: '退出游戏',
  hint: '确定要退出当前游戏吗？',
  confirmText: '退出游戏',
  successMessage: '已退出游戏',
  endsMatch: false,
};

const EXIT_ROOM: ExitIntent = {
  kind: 'exit-room',
  title: '退出房间',
  hint: '确定要退出当前房间吗？',
  confirmText: '退出房间',
  successMessage: '已退出房间',
  endsMatch: false,
};

const END_GAME: ExitIntent = {
  kind: 'end-game',
  title: '结束游戏',
  hint: '确定要结束本局并回到房间吗？',
  confirmText: '结束游戏',
  successMessage: '本局已结束，已回到房间',
  endsMatch: true,
};

/** 团队房房主：房间是固定房主的私人队房，关闭即解散（UI-101） */
const DISBAND_ROOM: ExitIntent = {
  kind: 'disband-room',
  title: '解散房间',
  hint: '确定要解散房间吗？解散后所有人都会离开。',
  confirmText: '解散房间',
  successMessage: '房间已解散',
  endsMatch: false,
};

/** 团队房非房主：只能离开，不能解散（UI-101） */
const LEAVE_ROOM: ExitIntent = {
  kind: 'leave-room',
  title: '离开房间',
  hint: '确定要离开当前房间吗？',
  confirmText: '离开房间',
  successMessage: '已离开房间',
  endsMatch: false,
};

/**
 * 解析关闭按钮的退出意图。
 *
 * - 单人游戏 → exit-game（退出游戏）
 * - 无尽竞技房 → exit-room（退出房间，常驻对局随时可走；即便房主也绝不解散）
 * - 团队房：对局中 → end-game（结束本局回到房间）；等待/结束态房主 → disband-room、其他人 → leave-room
 * - 其它房间对局中（回合制）→ end-game（结束游戏，回到房间）
 * - 官方房 / 等待态房间 → exit-room（退出房间）
 */
export function resolveExitIntent(ctx: ExitIntentContext): ExitIntent {
  // 单人游戏：临时房，离开即销毁，对用户而言就是"退出游戏"
  if (ctx.isSoloGame) return EXIT_GAME;
  // 无尽竞技房是常驻对局，随时可以退出（不算逃跑）；房间是公共桌，永不解散
  if (ctx.isEndlessArena) return EXIT_ROOM;
  // 团队房（UI-101）：房主解散、其他人离开；正在对局（未认输）时仍只能先结束本局
  if (ctx.isTeamRoom) {
    if (ctx.roomStatus === 'playing' && !ctx.endedMatch) return END_GAME;
    // 本局已自行结束：回到房间面板后恢复房主/非房主的房间级语义
    return ctx.canDisband ? DISBAND_ROOM : LEAVE_ROOM;
  }
  // 本局已自行结束（非团队房认输后）：已不在对局中，按退出房间处理
  if (ctx.endedMatch) return EXIT_ROOM;
  // 对局进行中不能直接离开（服务端会拒绝），只能先结束本局
  if (ctx.roomStatus === 'playing') return END_GAME;
  // 官方房与自建房的等待态/结束态都只是"退出房间"
  return EXIT_ROOM;
}

/**
 * 离开/结束成功后的提示文案。
 *
 * 服务端对"临时房销毁"会回 '房间已解散'，但那只是内部实现：
 * - 单人游戏：用户只是"退出游戏"，不该被"房间已解散"吓到 → 统一说"已退出游戏"。
 * - 结束本局：说"本局已结束，已回到房间"。
 * - 退出房间：自建房房主离开时房间真的没了，保留服务端提示；其余说"已退出房间"。
 */
export function resolveLeaveToast(intent: ExitIntent, serverMessage?: string): string {
  if (intent.kind !== 'exit-room') return intent.successMessage;
  if (serverMessage && serverMessage.includes('解散')) return serverMessage;
  return intent.successMessage;
}
