import GameTransport from '../../core/GameTransport'
import Logic from './Logic'
import Scene from './Scene2D'

export default class GameTetris {
  logic: Logic;
  scene: Scene;

  constructor(canvas: HTMLCanvasElement, socket: GameTransport, player: any) {
    this.logic = new Logic(socket, player);
    this.scene = new Scene(canvas, this.logic);
  }

  destroy() {
    // 离开房间/切换页面前兜底上报当前最高分（进度语义），避免中途退出丢分
    this.logic.flushScore();
    this.logic.destroy();
    if (this.scene) this.scene.dispose();
  }
}
