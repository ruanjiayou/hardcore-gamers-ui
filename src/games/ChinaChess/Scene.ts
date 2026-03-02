// ChessScene.ts

import * as BABYLON from "babylonjs";
import ChessLogic from "./Logic";

export default class ChinaChessScene {
  engine!: BABYLON.Engine;
  scene!: BABYLON.Scene;
  logic!: ChessLogic;
  inited: boolean = false;

  board: BABYLON.GroundMesh | null = null;
  pieceMap = new Map<string, BABYLON.TransformNode>();

  selected: { x: number; y: number } | null = null;

  constructor(state: any, player: any) {
    this.logic = new ChessLogic(state, player)
  }

  async init(canvas: HTMLCanvasElement) {
    if (this.inited) {
      return;
    } else {
      this.inited = true
    }
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);

    const camera = new BABYLON.ArcRotateCamera(
      "camera",
      Math.PI / 2,
      1.2,
      15,
      new BABYLON.Vector3(4, 0, 4.5),
      this.scene
    );
    camera.attachControl(canvas, true);

    const light = new BABYLON.HemisphericLight("light",
      new BABYLON.Vector3(0, 1, 0),
      this.scene);
    // 调低强度
    light.intensity = 0.5;   // 推荐 0.4 ~ 0.7

    // 上方光颜色（别太白）
    light.diffuse = new BABYLON.Color3(0.5, 0.5, 0.5);

    // 地面反射光调暗（关键！）
    light.groundColor = new BABYLON.Color3(0.05, 0.05, 0.05);


    this.createBoard();
    this.createPieces();
    this.setupPicking();

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  gridToWorld(col: number, row: number) {
    // const { cellSize } = this.boardConfig;
    const cellSize = 1;
    const offsetX = 4 * cellSize;     // 8/2
    const offsetZ = 4.5 * cellSize;   // 9/2

    return new BABYLON.Vector3(
      col * cellSize - offsetX,
      0.1,
      row * cellSize - offsetZ
    );
  }

  createBoard() {
    const cols = 9;
    const rows = 10;
    const cellSize = 1;
    const margin = 1;

    const width = (cols - 1) * cellSize + margin * 2;
    const height = (rows - 1) * cellSize + margin * 2;

    const board = BABYLON.MeshBuilder.CreateGround(
      "board",
      { width, height },
      this.scene
    );

    const texSize = 2048;

    const dt = new BABYLON.DynamicTexture(
      "boardTexture",
      texSize,
      this.scene,
      false
    );

    const ctx = dt.getContext();

    ctx.fillStyle = "#E8CFA5";
    ctx.fillRect(0, 0, texSize, texSize);

    ctx.strokeStyle = "#222";
    ctx.lineWidth = 4;

    // 像素比例
    const pxPerUnitX = texSize / width;
    const pxPerUnitY = texSize / height;

    // 关键：以世界中心为原点计算
    const halfLineWidth = ((cols - 1) * cellSize) / 2;
    const halfLineHeight = ((rows - 1) * cellSize) / 2;

    for (let row = 0; row < rows; row++) {
      const worldZ = row * cellSize - halfLineHeight;
      const y = texSize / 2 - worldZ * pxPerUnitY;

      ctx.beginPath();
      ctx.moveTo(
        texSize / 2 - halfLineWidth * pxPerUnitX,
        y
      );
      ctx.lineTo(
        texSize / 2 + halfLineWidth * pxPerUnitX,
        y
      );
      ctx.stroke();
    }

    for (let col = 0; col < cols; col++) {
      const worldX = col * cellSize - halfLineWidth;
      const x = texSize / 2 + worldX * pxPerUnitX;

      if (col === 0 || col === cols - 1) {
        ctx.beginPath();
        ctx.moveTo(x, texSize / 2 - halfLineHeight * pxPerUnitY);
        ctx.lineTo(x, texSize / 2 + halfLineHeight * pxPerUnitY);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, texSize / 2 - halfLineHeight * pxPerUnitY);
        ctx.lineTo(x, texSize / 2 - 0.5 * cellSize * pxPerUnitY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x, texSize / 2 + 0.5 * cellSize * pxPerUnitY);
        ctx.lineTo(x, texSize / 2 + halfLineHeight * pxPerUnitY);
        ctx.stroke();
      }
    }

    dt.update();

    const mat = new BABYLON.StandardMaterial("boardMat", this.scene);
    mat.backFaceCulling = false;
    mat.diffuseTexture = dt;
    mat.specularColor = BABYLON.Color3.Black();

    board.material = mat;
    board.position.x = 4;
    board.position.z = 4.5;
    board.position.y = -0.01

    this.board = board;
  }

  createPiece(id: string, x: number, y: number, type: string, color: "red" | "black") {

    const root = new BABYLON.TransformNode(id, this.scene);

    // 1️⃣ 主体圆柱
    const body = BABYLON.MeshBuilder.CreateCylinder(
      id + "-body",
      { diameter: 0.9, height: 0.3 },
      this.scene
    );
    body.parent = root;
    body.position.y = 0.15;

    const bodyMat = new BABYLON.StandardMaterial("bodyMat", this.scene);
    bodyMat.diffuseColor = new BABYLON.Color3(0.9, 0.8, 0.6);
    body.material = bodyMat;

    // 降低反射光
    bodyMat.specularColor = BABYLON.Color3.Black();
    bodyMat.specularPower = 0;

    // 2️⃣ 顶部圆盘（专门放文字）
    const top = BABYLON.MeshBuilder.CreateDisc(
      id + "-top",
      { radius: 0.42 },
      this.scene
    );
    top.parent = root;
    top.position.y = 0.31;
    top.rotation.z = Math.PI;
    top.rotation.x = Math.PI / 2; // 让圆盘朝上

    // 3️⃣ 文字贴图
    const texture = new BABYLON.DynamicTexture(
      id + "-text",
      { width: 512, height: 512 },
      this.scene,
      true
    );
    texture.vScale = -1;
    texture.vOffset = 1;
    texture.hasAlpha = true;

    texture.drawText(
      this.getChineseChar(type, color),
      null,
      340,
      "bold 300px SimHei",
      color === "red" ? "red" : "black",
      "transparent",
      true
    );

    const textMat = new BABYLON.StandardMaterial("textMat", this.scene);
    textMat.useAlphaFromDiffuseTexture = true;
    textMat.backFaceCulling = false;
    textMat.diffuseTexture = texture;
    textMat.specularColor = BABYLON.Color3.Black();

    top.material = textMat;

    body.isPickable = true
    // 4️⃣ 整体位置
    root.position.set(x, 0, y);

    return root;
  }

  createPieces() {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const piece = this.logic.getPiece(x, y);
        if (!piece) continue;

        const mesh = this.createPiece(`piece-${x}-${y}`, x, y, piece.type, piece.color)

        this.pieceMap.set(`${x}-${y}`, mesh);
      }
    }
  }

  getChineseChar(type: string, color: string) {
    const map: any = {
      r: { red: "车", black: "車" },
      n: { red: "马", black: "馬" },
      b: { red: "相", black: "象" },
      a: { red: "仕", black: "士" },
      k: { red: "帅", black: "将" },
      c: { red: "炮", black: "砲" },
      p: { red: "兵", black: "卒" }
    };

    return map[type][color];
  }

  setupPicking() {
    this.scene.onPointerObservable.add(pointer => {
      if (!pointer.pickInfo?.hit) return;
      const name = pointer.pickInfo.pickedMesh?.name;
      if (!name) return;

      let moveto: { x: number, y: number } | null = null;
      if (name.startsWith("piece")) {
        const [, x, y] = name.split("-");
        const selected = { x: +x, y: +y };
        if (!this.selected) {
          this.selected = selected;
          return;
        } else {
          moveto = this.selected
        }
      }
      if (name.startsWith('board')) {
        const x = Math.round(pointer.pickInfo.pickedPoint?._x || -1)
        const y = Math.round(pointer.pickInfo.pickedPoint?._z || -1)
        if (x <= 8 && x >= 0 && y >= 0 && y <= 9) {
          if (this.selected) {
            moveto = { x: +x, y: +y };
          }
        }
      }

      if (moveto && this.selected) {
        const success = this.logic.move(this.selected.x, this.selected.y, moveto.x, moveto.y);
        if (success) {
          this.moveMesh(
            this.selected.x,
            this.selected.y,
            moveto.x,
            moveto.y,
          );
        }
        this.selected = null;
      }
    }, BABYLON.PointerEventTypes.POINTERDOWN);
  }

  moveMesh(fx: number, fy: number, tx: number, ty: number) {
    const key = `${fx}-${fy}`;
    const mesh = this.pieceMap.get(key);
    if (!mesh) return;

    this.pieceMap.delete(key);
    this.pieceMap.set(`${tx}-${ty}`, mesh);

    BABYLON.Animation.CreateAndStartAnimation(
      "move",
      mesh,
      "position",
      60,
      30,
      mesh.position.clone(),
      new BABYLON.Vector3(tx, 0.2, ty),
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );
  }

  dispose() {
    this.scene.dispose();
    this.engine.dispose();
  }
}