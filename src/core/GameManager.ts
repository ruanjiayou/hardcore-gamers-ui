import { Socket } from "socket.io-client";
import GameTransport from './GameTransport'

const loadFile = async (name: 'xiangqi' | 'gomoku') => {
  // 通过注释告诉 Vite 可能的导入
  switch (name) {
    case 'xiangqi':
      return import('../games/xiangqi')
    case 'gomoku':
      return import('../games/gomoku')
    default:
      return null;
  }
}

export interface IGameModule {
  logic: any;
  scene: {
    init(canvas: HTMLCanvasElement): Promise<void>;
  };
  destroy(): void;
}

class GameManager {
  game: IGameModule | null = null;

  async load(game_slug: string, canvas: HTMLCanvasElement, socket: Socket, player: any) {
    const File = await loadFile(game_slug as any);
    if (File) {
      const Game = File.default;
      this.game = new Game(canvas, new GameTransport(socket), player);
      // @ts-ignore
      await this.game.scene.init();
      return this.game;

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