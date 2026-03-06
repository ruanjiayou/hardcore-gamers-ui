import { Socket } from "socket.io-client";
import GameTransport from './GameTransport'

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
    const Game = (await import(/* @vite-ignore */`../games/${game_slug}`)).default;
    this.game = new Game(canvas, new GameTransport(socket), player);
    // @ts-ignore
    await this.game?.scene.init();
    return this.game;
  }

  unload() {
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
  }
}

export const gameManager = new GameManager();