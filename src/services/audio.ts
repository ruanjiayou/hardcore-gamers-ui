/**
 * 语音包播放器：只依赖服务端下发的配置 URL，不内置任何音频。
 *
 * - 每套语音包下每个游戏有独立的 bgm/sfx，未配置的键回退到包级通用配置
 * - 一个 BGM 元素轮播当前游戏的 bgm；切换游戏即切换曲目与音效
 * - 音效按 URL 预建 Audio，播放时 clone 一份以支持重叠
 * - 浏览器自动播放策略：首次 play 被拒时挂一次性手势监听，用户点击后再恢复 BGM
 */
import type { GameAudio, VoicePack } from './api';

export type SfxKey = 'click' | 'move' | 'collect' | 'win' | 'lose';

/**
 * 用户音量条是「总音量」，实际播放时按用途分流：
 * - BGM 长时间铺底，压到 BGM_GAIN（当前 15%），不盖过提示音
 * - 落子/选中/吃子等操作音是即时反馈，放大到 SFX_GAIN（当前 140%，上限 1）
 */
export const BGM_GAIN = 0.15;
export const SFX_GAIN = 1.4;

/** 按游戏解析实际生效的音频：游戏级 sfx 覆盖包级同名键，bgm 有则整体覆盖 */
export function resolveGameAudio(pack: VoicePack | null | undefined, gameId?: string): GameAudio {
  const base: GameAudio = {
    bgm: pack?.bgm || [],
    sfx: { ...(pack?.sfx || {}) },
  };
  if (!pack || !gameId) return base;
  const game = pack.games?.[gameId];
  if (!game) return base;
  return {
    bgm: game.bgm?.length ? game.bgm : base.bgm,
    sfx: { ...base.sfx, ...(game.sfx || {}) },
  };
}

class AudioPlayer {
  pack: VoicePack | null = null;
  /** 当前游戏 id（game_id / slug）；进入对局页时设置 */
  gameId?: string;
  muted = false;
  volume = 0.6;

  private audio: GameAudio = { bgm: [], sfx: {} };
  private sfxCache = new Map<string, HTMLAudioElement>();
  /** 正在播放的音效克隆体；静音时要逐个停掉，光调 volume 不够 */
  private activeSfx = new Set<HTMLAudioElement>();
  private bgm: HTMLAudioElement | null = null;
  private bgmIndex = 0;
  private wantsBgm = false;
  private unlockBound = false;

  applyPack(pack: VoicePack | null) {
    if (!pack) return;
    this.pack = pack;
    this.reload();
  }

  /** 切换游戏：音效和 BGM 立即切到该游戏的专属配置 */
  setGame(gameId?: string) {
    if (this.gameId === gameId) return;
    this.gameId = gameId;
    if (this.pack) this.reload();
  }

  /** 重新解析当前游戏配置，重建音效缓存，并按播放意图切换 BGM */
  private reload() {
    this.audio = resolveGameAudio(this.pack, this.gameId);
    this.sfxCache.clear();
    for (const url of Object.values(this.audio.sfx)) {
      if (!url) continue;
      const element = new Audio(url);
      element.preload = 'auto';
      element.volume = this.sfxVolume();
      this.sfxCache.set(url, element);
    }
    if (this.wantsBgm) {
      if (this.bgm) {
        this.bgm.onended = null;
        this.bgm.pause();
        this.bgm = null;
      }
      this.bgmIndex = 0;
      this.playBgm();
    }
  }

  /**
   * 背景音乐开关：只暂停/恢复 BGM，不影响落子、选子、将军等音效。
   * 之前的实现把音效克隆体也一起 pause 了，导致用户关背景音时把操作音也关掉；
   * 操作音是一次性反馈，不应该被背景音乐开关吞掉。
   * pause 而非只调 volume=0：手势恢复/切歌时才不会偷偷把 BGM 又放出来。
   */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyVolume(); // 只更新 BGM 元素音量（音效不受 muted 影响）
    if (muted) {
      if (this.bgm) {
        this.bgm.onended = null;
        this.bgm.pause();
      }
      return;
    }
    if (this.wantsBgm) {
      if (this.bgm && this.bgm.paused) {
        this.bgm.play().catch(() => this.bindUnlock());
      } else if (!this.bgm) {
        this.playBgm();
      }
    }
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  /** 实际播放音量：总音量 × 用途增益，静音时为 0 */
  private bgmVolume() {
    return this.muted ? 0 : Math.min(1, this.volume * BGM_GAIN);
  }

  private sfxVolume() {
    // 不受 muted 影响：音效是即时反馈，关背景音乐时仍需保持
    return Math.min(1, this.volume * SFX_GAIN);
  }

  private applyVolume() {
    // 静音开关只作用于 BGM；操作音（落子/选子/吃子/胜负）始终按总音量播放。
    // 音效元素仍要随总音量变化同步更新（但不受 muted 影响）。
    if (this.bgm) this.bgm.volume = this.bgmVolume();
    for (const audio of this.sfxCache.values()) audio.volume = this.sfxVolume();
    for (const audio of this.activeSfx) audio.volume = this.sfxVolume();
  }

  /** 开始/继续背景音乐（进入对局页时调用） */
  playBgm() {
    this.wantsBgm = true;
    // 静音时只记下意图，不真正起播；取消静音时在 setMuted(false) 里恢复
    if (this.muted) return;
    if (!this.audio.bgm.length) return;
    if (this.bgm && !this.bgm.paused) return;
    const track = this.audio.bgm[this.bgmIndex % this.audio.bgm.length];
    if (!track?.url) return;
    const audio = new Audio(track.url);
    audio.loop = this.audio.bgm.length === 1;
    audio.volume = this.bgmVolume();
    audio.onended = () => {
      if (!this.wantsBgm || this.bgm !== audio) return;
      this.bgmIndex = (this.bgmIndex + 1) % this.audio.bgm.length;
      this.bgm = null;
      this.playBgm();
    };
    this.bgm = audio;
    audio.play().catch(() => this.bindUnlock());
  }

  stopBgm() {
    this.wantsBgm = false;
    if (this.bgm) {
      this.bgm.onended = null;
      this.bgm.pause();
      this.bgm = null;
    }
  }

  /** 切下一首 BGM（面板按钮） */
  nextBgm() {
    if (!this.audio.bgm.length) return;
    this.bgmIndex = (this.bgmIndex + 1) % this.audio.bgm.length;
    this.stopBgm();
    this.playBgm();
  }

  private bindUnlock() {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    const resume = () => {
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
      window.removeEventListener('touchstart', resume, true);
      this.unlockBound = false;
      if (!this.muted && this.wantsBgm && this.bgm) this.bgm.play().catch(() => undefined);
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
    window.addEventListener('touchstart', resume, true);
  }

  /** 播放当前游戏的音效；未加载语音包 / 无对应 URL 时静默跳过。背景音乐开关不影响音效。 */
  playSfx(key: SfxKey) {
    const url = this.audio.sfx?.[key];
    if (!url) return;
    const base = this.sfxCache.get(url);
    const audio = base ? (base.cloneNode() as HTMLAudioElement) : new Audio(url);
    // cloneNode 会复制 base 的 volume，这里按当前总音量重新算操作音音量
    audio.volume = this.sfxVolume();
    // 记录克隆体，静音时才能把它们一起停掉；播放结束/失败后自动移除
    this.activeSfx.add(audio);
    const cleanup = () => {
      this.activeSfx.delete(audio);
      audio.onended = null;
      audio.onerror = null;
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  }
}

export const audioPlayer = new AudioPlayer();
export default audioPlayer;
