import { Socket } from "socket.io-client";
import GameTransport from './GameTransport'

/**
 * 游戏按需加载管理器。
 *
 * 关键设计：游戏 chunk 由各自入口通过 registerLoader(slug, loader) 注入，
 * 管理器本身不再扫描 games 目录，因此每个入口只携带自己注册的游戏引擎：
 * - 象棋是纯 2D Canvas，chunk 极小（~10KB），不依赖 Babylon。
 * - 五子棋依赖 Babylon 引擎（~6MB），仅在该入口进入房间时才加载。
 * 因此首屏只加载主包，不会把所有游戏引擎一次性拉下来。
 *
 * 新增游戏时在对应入口调用 gameManager.registerLoader(slug, () => import(...))。
 */
type GameCtor = new (canvas: HTMLCanvasElement, socket: GameTransport, player: any, meta?: GameMeta) => IGameModule;

/** 进入对局时附带的房间元信息（如玩法变体 variant，贪吃蛇无尽/多人共用同一 slug） */
export interface GameMeta {
  variant?: string;
  room?: any;
}

interface IGameModule {
  logic: any;
  scene: {
    init(canvas?: HTMLCanvasElement): Promise<void>;
    dispose?(): void;
  };
  destroy(): void;
}

export type GameLoader = () => Promise<{ default: GameCtor }>;

class GameManager {
  game: IGameModule | null = null;

  // 由各入口注入的 slug -> 动态 import 映射（公共入口不注册任何游戏）
  private loaders = new Map<string, GameLoader>();
  // 同一 slug 的模块只 import 一次，浏览器会缓存 chunk，这里再缓存 promise 避免重复请求
  private moduleCache = new Map<string, Promise<GameCtor>>();
  // 竞态令牌：快速切换房间时，只有最后一次 load 的结果会生效
  private loadToken = 0;

  registerLoader(slug: string, loader: GameLoader): void {
    this.loaders.set(slug, loader);
  }

  private getCtor(slug: string): Promise<GameCtor> {
    const loader = this.loaders.get(slug);
    if (!loader) return Promise.reject(new Error(`未找到游戏模块: ${slug}`));
    let cached = this.moduleCache.get(slug);
    if (!cached) {
      cached = loader().then(mod => mod.default);
      this.moduleCache.set(slug, cached);
    }
    return cached;
  }

  async load(game_slug: string, canvas: HTMLCanvasElement, socket: Socket, player: any, meta?: GameMeta): Promise<IGameModule | undefined> {
    const token = ++this.loadToken;
    try {
      const Game = await this.getCtor(game_slug);
      // 加载期间用户已切到别的房间，丢弃这次结果
      if (token !== this.loadToken) return;

      // 若上一个游戏尚未释放，先清理，避免事件监听/渲染循环叠加
      if (this.game) this.unload();

      const game = new Game(canvas, new GameTransport(socket), player, meta);
      await game.scene.init(canvas);
      // init 期间又发生了切换，销毁本次实例，保留最后一次结果
      if (token !== this.loadToken) {
        game.destroy();
        return;
      }
      this.game = game;
      return game;
    } catch (err) {
      if (token === this.loadToken) console.error('[GameManager] 加载游戏失败:', game_slug, err);
      return;
    }
  }

  unload() {
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
  }
}

export const gameManager = new GameManager();
