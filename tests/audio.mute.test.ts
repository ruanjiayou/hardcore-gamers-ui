import { describe, test, expect, beforeEach } from 'bun:test';

/** 用可控的假 Audio 验证：背景音乐开关只停 BGM，操作音不受影响 */
class FakeAudio {
  static all: FakeAudio[] = [];
  src: string;
  volume = 1;
  loop = false;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playCount = 0;
  pauseCount = 0;
  constructor(src: string) {
    this.src = src;
    FakeAudio.all.push(this);
  }
  play() {
    this.playCount += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCount += 1;
    this.paused = true;
  }
  cloneNode() {
    return new FakeAudio(this.src);
  }
}

(globalThis as any).Audio = FakeAudio;

const { default: audioPlayer, BGM_GAIN, SFX_GAIN } = await import('../src/services/audio');
const { FALLBACK_PACK } = await import('../src/stores/audio');

const reset = () => {
  FakeAudio.all = [];
  audioPlayer.applyPack(FALLBACK_PACK);
  audioPlayer.setGame('gomoku');
  audioPlayer.stopBgm();
  audioPlayer.setMuted(false);
  audioPlayer.setVolume(0.6);
  FakeAudio.all = []; // 清掉初始化产生的元素，只考察测试内新建的
};

describe('背景音乐开关', () => {
  beforeEach(reset);

  test('静音会真正暂停 BGM', () => {
    audioPlayer.playBgm();
    const bgm = FakeAudio.all.find(a => a.src.includes('bgm.mp3'))!;
    expect(bgm.paused).toBe(false);

    audioPlayer.setMuted(true);
    expect(bgm.pauseCount).toBeGreaterThan(0);
    expect(bgm.paused).toBe(true);
  });

  test('静音不影响落子音效：仍在播放且音量不为 0', () => {
    audioPlayer.playSfx('move');
    const sfx = FakeAudio.all.find(a => a.src.includes('/gomoku/move.mp3'))!;
    expect(sfx.paused).toBe(false);

    audioPlayer.setMuted(true);
    expect(sfx.paused).toBe(false); // 操作音继续播放
    expect(sfx.volume).toBeGreaterThan(0);
    expect(sfx.pauseCount).toBe(0);
  });

  test('静音期间仍可播放新的落子/将军音效', () => {
    audioPlayer.setMuted(true);
    const before = FakeAudio.all.length;
    audioPlayer.playSfx('move');
    expect(FakeAudio.all.length).toBe(before + 1);
    const sfx = FakeAudio.all[FakeAudio.all.length - 1];
    expect(sfx.paused).toBe(false);
  });

  test('静音期间不新建 BGM，取消静音后恢复', () => {
    audioPlayer.playBgm();
    const before = FakeAudio.all.length;
    audioPlayer.setMuted(true);
    audioPlayer.playBgm();
    expect(FakeAudio.all.length).toBe(before);

    audioPlayer.setMuted(false);
    expect(FakeAudio.all.some(a => a.src.includes('bgm.mp3') && !a.paused)).toBe(true);
  });
});

describe('音量分配：BGM 压低、操作音放大', () => {
  beforeEach(reset);

  test('同一总音量下操作音明显大于 BGM', () => {
    audioPlayer.playBgm();
    audioPlayer.playSfx('move');
    const bgm = FakeAudio.all.find(a => a.src.includes('bgm.mp3'))!;
    const sfx = FakeAudio.all.find(a => a.src.includes('/gomoku/move.mp3'))!;
    expect(bgm.volume).toBeCloseTo(0.6 * BGM_GAIN);
    expect(sfx.volume).toBeCloseTo(0.6 * SFX_GAIN);
    expect(sfx.volume).toBeGreaterThan(bgm.volume * 3);
  });

  test('调总音量时两类音量同步变化，操作音不超过 1', () => {
    audioPlayer.playBgm();
    audioPlayer.playSfx('move');
    const bgm = FakeAudio.all.find(a => a.src.includes('bgm.mp3'))!;
    const sfx = FakeAudio.all.find(a => a.src.includes('/gomoku/move.mp3'))!;

    audioPlayer.setVolume(1);
    expect(bgm.volume).toBeCloseTo(BGM_GAIN);
    expect(sfx.volume).toBe(1);

    audioPlayer.setVolume(0.2);
    expect(bgm.volume).toBeCloseTo(0.2 * BGM_GAIN);
    expect(sfx.volume).toBeCloseTo(0.2 * SFX_GAIN);
  });

  test('静音后 BGM 音量为 0，操作音音量保持；取消静音恢复 BGM', () => {
    audioPlayer.playBgm();
    audioPlayer.playSfx('move');
    const bgm = FakeAudio.all.find(a => a.src.includes('bgm.mp3'))!;
    const sfx = FakeAudio.all.find(a => a.src.includes('/gomoku/move.mp3'))!;

    audioPlayer.setMuted(true);
    expect(bgm.volume).toBe(0);
    expect(sfx.volume).toBeCloseTo(0.6 * SFX_GAIN);

    audioPlayer.setMuted(false);
    expect(bgm.volume).toBeCloseTo(0.6 * BGM_GAIN);
  });
});
