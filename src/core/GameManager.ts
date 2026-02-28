export interface IGameModule {
  init(canvas: HTMLCanvasElement): Promise<void>;
  destroy(): void;
}

class GameManager {
  private currentGame: IGameModule | null = null;

  async load(gameId: string, canvas: HTMLCanvasElement) {
    if (this.currentGame) {
      // this.currentGame.destroy();
      // this.currentGame = null;
      return;
    }

    const module = await import(`../games/${gameId}/index`);
    this.currentGame = new module.default();
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