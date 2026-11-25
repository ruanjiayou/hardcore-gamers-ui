/**
 * 语音包播放器：只依赖服务端下发的配置 URL，不内置任何音频。
 *
 * - **按游戏拆**：每个游戏有自己的 bgm 列表与 sfx 表；包级只留 UI 通用音
 *   （click/win/lose），游戏级同名键覆盖包级
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
  /**
   * 音效元素池：url -> 可复用的 HTMLAudioElement 列表。
   * 之前每次播放都 cloneNode() 新建一个媒体元素，实时游戏每秒能触发十几次，
   * 在手机上是实打实的媒体栈开销（还会撞上 iOS 同时存在的媒体元素上限）。
   * 改成"取一个空闲的复用，用完还池"。
   */
  private sfxPool = new Map<string, HTMLAudioElement[]>();
  /** 正在播放的音效；静音时要逐个停掉，光调 volume 不够 */
  private activeSfx = new Set<HTMLAudioElement>();
  /** 每个音效 key 的最小播放间隔（ms）：防止同一音效被高频事件刷屏 */
  private sfxLastAt = new Map<string, number>();
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
    this.applyAudio(resolveGameAudio(this.pack, this.gameId));
  }

  /**
   * 直接套用一份已经解析好的音频配置（来自 `assets.manifest.json`）。
   *
   * 资源的唯一事实来源是 `assets` 表：包接口只下发包元信息，不再带 bgm/sfx，
   * 所以「哪个游戏用哪首 BGM、哪个音效」一律以清单为准。清单没到之前用内置
   * FALLBACK_PACK 兜底，保证离线/慢网也有声音。
   */
  applyAudio(audio: GameAudio) {
    this.audio = { bgm: audio.bgm || [], sfx: { ...(audio.sfx || {}) } };
    this.sfxCache.clear();
    this.sfxPool.clear();
    this.sfxLastAt.clear();
    for (const url of Object.values(this.audio.sfx)) {
      if (!url) continue;
      const element = new Audio(url);
      element.preload = 'auto';
      element.volume = this.sfxVolume();
      this.sfxCache.set(url, element);
      this.sfxPool.set(url, []);
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
  playSfx(key: SfxKey, minIntervalMs = 0) {
    const url = this.audio.sfx?.[key];
    if (!url) return;
    // 同一音效的最小间隔：实时类事件（20Hz 快照等）高频触发时直接丢弃，
    // 避免同一秒里播放十几次同一个音（手机上的媒体栈开销 + 听觉噪声）。
    const now = performance.now();
    if (minIntervalMs > 0) {
      const last = this.sfxLastAt.get(key) ?? -Infinity;
      if (now - last < minIntervalMs) return;
    }
    this.sfxLastAt.set(key, now);

    const audio = this.takeSfx(url);
    if (!audio) return;
    audio.volume = this.sfxVolume();
    audio.currentTime = 0;
    // 记录播放中的元素，静音时才能把它们一起停掉；播放结束/失败后归还池
    this.activeSfx.add(audio);
    const cleanup = () => {
      this.activeSfx.delete(audio);
      audio.onended = null;
      audio.onerror = null;
      this.giveBackSfx(url, audio);
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  }

  /**
   * 取一个可复用的音效元素：优先用池里空闲的，没有就从模板 clone 一个。
   * 池上限很小（同一音效最多 4 个并发），保证不会无限创建媒体元素。
   */
  private takeSfx(url: string): HTMLAudioElement | null {
    const pool = this.sfxPool.get(url);
    if (pool) {
      const reused = pool.pop();
      if (reused) return reused;
    }
    const base = this.sfxCache.get(url);
    if (!base) return null;
    return base.cloneNode() as HTMLAudioElement;
  }

  /** 播放结束把元素还回池里（下一个音效直接复用，不再新建媒体元素） */
  private giveBackSfx(url: string, audio: HTMLAudioElement) {
    const pool = this.sfxPool.get(url);
    if (!pool) return;
    if (pool.length >= 4) return; // 并发上限，避免无限堆积
    try { audio.pause(); } catch { /* ignore */ }
    pool.push(audio);
  }
}

export const audioPlayer = new AudioPlayer();
export default audioPlayer;
