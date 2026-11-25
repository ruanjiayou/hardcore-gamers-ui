import { makeAutoObservable, runInAction } from 'mobx';
import { getVoicePacks, selectVoicePack, type GameAudio, type VoicePack } from '../services/api';
import audioPlayer, { resolveGameAudio, type SfxKey } from '../services/audio';
import { loadGameAssets } from '../services/assets';

const SETTINGS_KEY = 'gameAudioSettings';
const AUDIO_GAME_IDS = ['gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris', 'snake'];

/**
 * 服务端不可用时至少保留默认包，游戏仍有基础音效。
 *
 * **按游戏拆**：每个游戏有自己的 BGM 与操作音 URL，不共用一份配置；
 * 包级只留 UI 通用音（click/win/lose）。
 * 兜底曲目指向默认包素材（每个游戏各一行配置，运营可在后台换成各自的曲子）。
 */
const fallbackGames: Record<string, GameAudio> = Object.fromEntries(
  AUDIO_GAME_IDS.map(game => [game, {
    bgm: [{ url: '/audio/classic/common/bgm.mp3', label: '经典主题' }],
    sfx: {
      move: `/audio/classic/${game}/move.mp3`,
      collect: `/audio/classic/${game}/collect.mp3`,
    },
  }]),
);

export const FALLBACK_PACK: VoicePack = {
  id: 'classic',
  name: '经典',
  desc: '默认音效',
  cover: '🎵',
  isDefault: true,
  requirePermission: false,
  hasPermission: true,
  // 包级只留 UI 通用音；BGM 与游戏操作音都在 games 里按游戏各一份
  bgm: [],
  sfx: {
    click: '/audio/classic/common/click.mp3',
    win: '/audio/classic/common/win.mp3',
    lose: '/audio/classic/common/lose.mp3',
  },
  games: fallbackGames,
};

export default class AudioStore {
  packs: VoicePack[] = [];
  selected = FALLBACK_PACK.id;
  hasPermission = false;
  loading = false;
  muted = false;
  volume = 0.6;
  /** 当前所在游戏（game_id / slug），决定播放哪一套游戏音效 */
  currentGame = '';

  constructor() {
    makeAutoObservable(this);
    this.loadLocalSettings();
    audioPlayer.applyPack(FALLBACK_PACK);
  }

  get currentPack(): VoicePack {
    return this.packs.find(p => p.id === this.selected) || FALLBACK_PACK;
  }

  /** 当前游戏实际生效的音频配置（面板展示与调试用） */
  get currentAudio(): GameAudio {
    return resolveGameAudio(this.currentPack, this.currentGame);
  }

  canUse(pack: VoicePack) {
    return pack.hasPermission || pack.isDefault;
  }

  private loadLocalSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      this.muted = settings.muted === true;
      if (typeof settings.volume === 'number') this.volume = Math.max(0, Math.min(1, settings.volume));
    } catch { /* 忽略损坏的本地设置 */ }
    audioPlayer.setMuted(this.muted);
    audioPlayer.setVolume(this.volume);
  }

  private saveLocalSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }));
    } catch { /* 隐私模式下不持久化 */ }
  }

  /** 从服务端拉取配置；失败时用内置默认包，不影响游戏 */
  async load() {
    this.loading = true;
    try {
      const { data } = await getVoicePacks();
      if (data?.code !== 0 || !data.data?.list?.length) throw new Error('语音包配置为空');
      runInAction(() => {
        this.packs = data.data.list;
        this.selected = data.data.selected || FALLBACK_PACK.id;
        this.hasPermission = data.data.hasPermission === true;
      });
      audioPlayer.applyPack(this.currentPack);
    } catch (err) {
      console.warn('[audio] 语音包配置加载失败，使用默认包:', err);
      runInAction(() => {
        this.packs = [FALLBACK_PACK];
        this.selected = FALLBACK_PACK.id;
        this.hasPermission = false;
      });
      audioPlayer.applyPack(FALLBACK_PACK);
    } finally {
      runInAction(() => { this.loading = false; });
    }
  }

  /** 选择语音包：服务端校验权限，失败时保持原选择 */
  async select(packId: string): Promise<{ success: boolean; message?: string }> {
    const target = this.packs.find(p => p.id === packId);
    if (!target || !this.canUse(target)) return { success: false, message: '该语音包暂不可用' };
    let loggedIn = false;
    try { loggedIn = !!JSON.parse(localStorage.getItem('gameSession') || '{}')?.token; } catch { /* 游客 */ }
    if (!loggedIn) return { success: false, message: '登录后才能更换语音包' };
    try {
      const { data } = await selectVoicePack(packId);
      if (data?.code !== 0) return { success: false, message: data?.message || '设置失败' };
      runInAction(() => {
        this.selected = data.data?.selected || packId;
        this.hasPermission = data.data?.hasPermission === true;
      });
      audioPlayer.applyPack(this.currentPack);
      // 换包 = 换整套资源，音频也要按新包的 assets 重新取
      if (this.currentGame) void this.syncGameAudio(this.currentGame);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || '网络异常，请重试' };
    }
  }

  /**
   * 进入游戏页时调用：切到该游戏专属的 BGM 与音效。
   *
   * 先按包元信息 + 内置兜底切一次（保证立刻有声音），再用 `manifest.audio`
   * 覆盖成服务端 `assets` 表里真实的配置——资源的唯一事实来源是 resources 表，
   * 包接口已不再携带 bgm/sfx。
   */
  setGame(gameId: string) {
    if (!gameId || this.currentGame === gameId) return;
    this.currentGame = gameId;
    audioPlayer.setGame(gameId);
    void this.syncGameAudio(gameId);
  }

  /** 用资源清单里的音频覆盖当前播放器配置（清单没到/加载失败就保持兜底） */
  private async syncGameAudio(gameId: string) {
    const manifest = await loadGameAssets(gameId);
    if (!manifest || this.currentGame !== gameId) return;
    audioPlayer.applyAudio(manifest.audio);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    audioPlayer.setMuted(muted);
    this.saveLocalSettings();
  }

  setVolume(volume: number) {
    this.volume = volume;
    audioPlayer.setVolume(volume);
    this.saveLocalSettings();
  }

  /** 播放音效；minIntervalMs 用于给高频事件（实时快照等）做节流 */
  play(key: SfxKey, minIntervalMs = 0) { audioPlayer.playSfx(key, minIntervalMs); }
  startBgm() { audioPlayer.playBgm(); }
  stopBgm() { audioPlayer.stopBgm(); }
  nextBgm() { audioPlayer.nextBgm(); }
}
