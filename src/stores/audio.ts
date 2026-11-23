import { makeAutoObservable, runInAction } from 'mobx';
import { getVoicePacks, selectVoicePack, type GameAudio, type VoicePack } from '../services/api';
import audioPlayer, { resolveGameAudio, type SfxKey } from '../services/audio';

const SETTINGS_KEY = 'gameAudioSettings';
const AUDIO_GAME_IDS = ['gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris', 'snake'];

/** 服务端不可用时至少保留默认包，游戏仍有基础音效（含各游戏专属操作音） */
const fallbackGames: Record<string, GameAudio> = Object.fromEntries(
  AUDIO_GAME_IDS.map(game => [game, {
    bgm: [],
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
  bgm: [{ url: '/audio/classic/common/bgm.mp3', label: '经典主题' }],
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
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || '网络异常，请重试' };
    }
  }

  /** 进入游戏页时调用：切到该游戏专属的 BGM 与音效 */
  setGame(gameId: string) {
    if (!gameId || this.currentGame === gameId) return;
    this.currentGame = gameId;
    audioPlayer.setGame(gameId);
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

  play(key: SfxKey) { audioPlayer.playSfx(key); }
  startBgm() { audioPlayer.playBgm(); }
  stopBgm() { audioPlayer.stopBgm(); }
  nextBgm() { audioPlayer.nextBgm(); }
}
