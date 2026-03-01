export interface IGameModule {
  init(canvas: HTMLCanvasElement): Promise<void>;
  destroy(): void;
}

class GameManager {
  private currentGame: IGameModule | null = null;

  async load(gameId: string, canvas: HTMLCanvasElement, state: any) {
    if (this.currentGame) {
      return;
    }

    const Game = (await import(/* @vite-ignore */`../games/${gameId}/index`)).default;
    this.currentGame = new Game(state);
    // @ts-ignore
    await this.currentGame.init(canvas);
  }

  unload() {
    if (this.currentGame) {
      this.currentGame.destroy();
      this.currentGame = null;
    }
  }
}

export const gameManager = new GameManager();