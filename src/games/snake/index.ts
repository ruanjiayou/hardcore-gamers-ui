import GameTransport from '../../core/GameTransport'
import Logic from './Logic'
import Scene from './Scene2D'

/** 游戏入口：variant 由房间设置传入（endless=无尽挑战 / team=团队模式） */
export default class GameSnake {
  logic: Logic;
  scene: Scene;

  constructor(canvas: HTMLCanvasElement, socket: GameTransport, player: any, meta?: { variant?: string, room?: any }) {
    this.logic = new Logic(socket, player, meta?.variant, meta?.room);
    this.scene = new Scene(canvas, this.logic);
    // 开发期调试钩子：E2E 用它读取逻辑/镜头状态（打包后不存在）
    if (import.meta.env.DEV) (window as any).__snake = this;
  }

  destroy() {
    this.logic.destroy();
    if (this.scene) this.scene.dispose();
  }
}
