// ChessScene.ts
import {
  Scene,
  Engine,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
  TransformNode,
  GroundMesh,
  HighlightLayer,
  Texture,
  DynamicTexture,
  Material,
  PointerEventTypes,
  Mesh,
  Animation,
  ArcRotateCamera,
  FxaaPostProcess,
  HemisphericLight,
} from "@babylonjs/core"
import { GridMaterial } from "@babylonjs/materials/grid";
import ChessLogic from "./Logic";

export default class ChinaChessScene {
  engine!: Engine;
  scene!: Scene;
  logic: ChessLogic;
  inited: boolean = false;

  board: GroundMesh | null = null;
  highlightLayer: HighlightLayer | null = null;

  pieceMap = new Map<string, TransformNode>();

  selected: string = '';

  constructor(canvas: HTMLCanvasElement, logic: ChessLogic) {
    this.logic = logic;
    this.logic.on('state', () => {
      this.clear()
      this.createPieces();
    });
    this.logic.on('move', (data: { from: { x: number, y: number }, to: { x: number, y: number } }) => {
      this.moveMesh(data.from, data.to)
    })

    this.engine = new Engine(canvas, true, {
      antialias: true,
      preserveDrawingBuffer: true,
      stencil: true
    });
    this.engine.setHardwareScalingLevel(1 / window.devicePixelRatio)

    this.scene = new Scene(this.engine);
    const camera = new ArcRotateCamera(
      "camera",
      this.logic.player.role === 'red' ? Math.PI / 2 : -Math.PI / 2,
      Math.PI / 6,
      15,
      new Vector3(4, 0, 4.5),
      this.scene
    );
    camera.attachControl(canvas, true);
    const fxaa = new FxaaPostProcess("fxaa", 1.0, null, 1, this.engine);
    camera.attachPostProcess(fxaa);

    const light = new HemisphericLight("light",
      new Vector3(1, 1, 1),
      this.scene);
    // // 调低强度
    // light.intensity = 0.5;   // 推荐 0.4 ~ 0.7

    // // 上方光颜色（别太白）
    // light.diffuse = new Color3(0.5, 0.5, 0.5);

    // // 地面反射光调暗（关键！）
    light.groundColor = new Color3(0.05, 0.05, 0.05);

    // 高亮层
    this.highlightLayer = new HighlightLayer("highlightLayer", this.scene);

    this.createBoard();
    // this.createDebugHelper({})
    this.setupPicking();

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  async init() {
    if (this.inited) {
      return;
    } else {
      this.inited = true
    }

    await this.scene.whenReadyAsync()
  }

  createDebugHelper(options: any) {

    const {
      size = 10,
      step = 1,
      gridSize = 10,
      axisDiameter = 0.04
    } = options;

    const root = new TransformNode("debugHelper", this.scene);

    const createMaterial = (color: any) => {
      const mat = new StandardMaterial("mat", this.scene);
      mat.emissiveColor = color;
      mat.disableLighting = true;
      return mat;
    }

    const matX = createMaterial(new Color3(1, 0, 0));
    const matY = createMaterial(new Color3(0, 1, 0));
    const matZ = createMaterial(new Color3(0, 0, 1));
    const matTick = createMaterial(new Color3(0.7, 0.7, 0.7));

    const createAxis = (dir: any, mat: any) => {

      const axis = MeshBuilder.CreateCylinder("axis", {
        height: size,
        diameter: axisDiameter
      }, this.scene);

      axis.material = mat;
      axis.parent = root;

      if (dir.x) axis.rotation.z = Math.PI / 2;
      if (dir.z) axis.rotation.x = Math.PI / 2;

      axis.position = dir.scale(size / 2);

      for (let i = step; i <= size; i += step) {

        const major = i % 5 === 0;

        const tick = MeshBuilder.CreateCylinder("tick", {
          height: major ? 0.5 : 0.25,
          diameter: axisDiameter * 0.6
        }, this.scene);

        tick.material = matTick;
        tick.parent = root;

        const p = dir.scale(i);

        if (dir.x) {
          tick.rotation.z = Math.PI / 2;
          tick.position = p;
        }

        if (dir.y) {
          tick.position = p;
        }

        if (dir.z) {
          tick.rotation.x = Math.PI / 2;
          tick.position = p;
        }
      }
    }

    createAxis(new Vector3(1, 0, 0), matX);
    createAxis(new Vector3(0, 1, 0), matY);
    createAxis(new Vector3(0, 0, 1), matZ);

    // 原点球
    const origin = MeshBuilder.CreateSphere("origin", {
      diameter: 0.15
    }, this.scene);

    origin.material = createMaterial(new Color3(1, 1, 0));
    origin.parent = root;

    // Grid
    const grid = MeshBuilder.CreateGround("grid", {
      width: gridSize,
      height: gridSize,
      subdivisions: gridSize
    }, this.scene);

    const gridMat = new GridMaterial("gridMat", this.scene);
    gridMat.majorUnitFrequency = 5;
    gridMat.minorUnitVisibility = 0.45;
    gridMat.gridRatio = 1;
    gridMat.backFaceCulling = false;
    gridMat.mainColor = new Color3(0.4, 0.4, 0.4);
    gridMat.lineColor = new Color3(0.7, 0.7, 0.7);
    gridMat.opacity = 0.6;

    grid.material = gridMat;
    grid.parent = root;

    return root;
  }
  createBoard() {
    const cols = 9;
    const rows = 10;
    const cellSize = 1;
    const margin = 1;

    const width = (cols - 1) * cellSize + margin * 2;
    const height = (rows - 1) * cellSize + margin * 2;

    const board = MeshBuilder.CreateGround(
      "board",
      { width, height },
      this.scene
    );

    const texSize = 2048;

    const dt = new DynamicTexture(
      "boardTexture",
      texSize,
      this.scene,
      true
    );
    // 纹理采样优化
    dt.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
    dt.anisotropicFilteringLevel = 16; // 各向异性过滤

    const ctx = dt.getContext() as CanvasRenderingContext2D;

    ctx.fillStyle = "#E8CFA5";
    ctx.fillRect(0, 0, texSize, texSize);

    ctx.strokeStyle = "#222";
    ctx.lineWidth = 5;

    // 3. 开启抗锯齿
    ctx.imageSmoothingEnabled = true;
    ctx.translate(0.5, 0.5); // 避免线条模糊

    // 像素比例
    const pxPerUnitX = texSize / width;
    const pxPerUnitY = texSize / height;

    // 关键：以世界中心为原点计算
    const halfLineWidth = ((cols - 1) * cellSize) / 2;
    const halfLineHeight = ((rows - 1) * cellSize) / 2;

    ctx.beginPath();
    ctx.moveTo(pxPerUnitX * 4, pxPerUnitY * 3)
    ctx.lineTo(pxPerUnitX * 6, pxPerUnitY * 1);

    ctx.moveTo(pxPerUnitX * 4, pxPerUnitY * 1)
    ctx.lineTo(pxPerUnitX * 6, pxPerUnitY * 3);


    ctx.moveTo(pxPerUnitX * 4, pxPerUnitY * 8)
    ctx.lineTo(pxPerUnitX * 6, pxPerUnitY * 10);

    ctx.moveTo(pxPerUnitX * 6, pxPerUnitY * 8)
    ctx.lineTo(pxPerUnitX * 4, pxPerUnitY * 10);
    ctx.stroke()

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

    const mat = new StandardMaterial("boardMat", this.scene);
    mat.backFaceCulling = false;
    mat.diffuseTexture = dt;
    mat.specularColor = Color3.Black();

    board.material = mat;
    board.position.x = 4;
    board.position.z = 4.5;
    board.position.y = -0.01

    this.board = board;
  }

  // 独立的文字纹理创建方法
  createTextTexture(id: string, type: string, color: "red" | "black") {
    // 使用更高分辨率
    const size = 1024; // 增加分辨率
    const texture = new DynamicTexture(
      id + "-text",
      { width: size, height: size },
      this.scene,
      true // 生成mipmap
    );

    // 纹理采样优化
    texture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
    texture.anisotropicFilteringLevel = 16;

    // 获取Canvas上下文
    const ctx = texture.getContext() as CanvasRenderingContext2D;

    // 清除背景（透明）
    ctx.clearRect(0, 0, size, size);

    // 设置文字样式
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 文字描边和填充，使边缘更清晰
    const text = this.getChineseChar(type, color);
    const fontSize = 500; // 增大字号
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", "Arial Unicode MS", sans-serif`;

    // 先画描边
    ctx.strokeStyle = color === "red" ? "#8B0000" : "#333333";
    ctx.lineWidth = 20;
    ctx.strokeText(text, size / 2, size / 2);

    // 再画填充
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2);

    // 可选：添加轻微的阴影增加立体感
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.fillText(text, size / 2, size / 2);

    // 重置阴影
    ctx.shadowColor = "transparent";

    texture.update();

    return texture;
  }

  createPiece(x: number, y: number, type: string, color: "red" | "black") {
    const id = `piece-${type}-${this.getChineseChar(type, color)}-${color}`
    const root = new TransformNode(id, this.scene);

    // 1️⃣ 主体圆柱
    const body = MeshBuilder.CreateCylinder(
      id + "-body",
      { diameter: 0.9, height: 0.3 },
      this.scene
    );
    body.parent = root;
    body.position.y = 0.15;

    const bodyMat = new StandardMaterial("bodyMat", this.scene);
    bodyMat.diffuseColor = new Color3(0.9, 0.8, 0.6);
    body.material = bodyMat;

    // 降低反射光
    bodyMat.specularColor = Color3.Black();
    bodyMat.specularPower = 0;

    // 2️⃣ 顶部圆盘（专门放文字）
    const top = MeshBuilder.CreateDisc(
      id + "-top",
      { radius: 0.42 },
      this.scene
    );
    top.parent = root;
    top.position.y = 0.31;
    top.rotation.z = this.logic.player.role === 'red' ? Math.PI : 0;
    top.rotation.x = Math.PI / 2; // 让圆盘朝上

    // 3️⃣ 文字贴图
    const texture = new DynamicTexture(
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

    const textMat = new StandardMaterial("textMat", this.scene);
    textMat.useAlphaFromDiffuseTexture = true;
    textMat.backFaceCulling = false;
    textMat.diffuseTexture = texture;
    textMat.specularColor = Color3.Black();
    // 设置材质透明度
    textMat.transparencyMode = Material.MATERIAL_ALPHABLEND;

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

        const mesh = this.createPiece(x, y, piece.type, piece.color)
        this.pieceMap.set(`${y}-${x}`, mesh);
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

  clear() {
    console.log('dispose')
    this.pieceMap.forEach((mesh, key) => {
      if (mesh) {
        mesh.dispose();
      }
    });

    // 清空 Map
    this.pieceMap.clear();

    // 可选：强制触发场景更新
    this.scene.render();
  }

  setupPicking() {
    this.scene.onPointerObservable.add(pointer => {
      if (this.logic.isPendding) {
        return;
      }
      if (!pointer.pickInfo?.hit) return;
      const name = pointer.pickInfo.pickedMesh?.name;
      if (!name) return;
      const color = name.includes('red') ? 'red' : 'black'
      if (!this.logic.isMyTurn()) {
        return;
      }

      const p = {
        x: Math.round(pointer.pickInfo.pickedPoint?._x || -1),
        y: Math.round(pointer.pickInfo.pickedPoint?._z || -1),
      }
      const idx = [p.y, p.x]
      let moveto: { x: number, y: number } | null = null;
      if (!this.selected) {
        // 选中自己的棋子
        this.selected = idx.join('-');
        this.addPieceHightlight()
        return;
      } else {
        if (name.startsWith('piece')) {
          if (color === this.logic.player.role) {
            // 切换选中的棋子
            this.cancelPieceHighlight()
            this.selected = idx.join('-');
            this.addPieceHightlight()
            return;
          } else {
            moveto = { x: +p.x, y: +p.y };
          }
        } else if (name.startsWith('board')) {
          //棋盘上移动
          if (p.x <= 8 && p.x >= 0 && p.y >= 0 && p.y <= 9) {
            if (this.selected) {
              moveto = { x: p.x, y: p.y };
            }
          }
        }

      }

      if (moveto && this.selected) {
        const [y, x] = this.selected.split('-')
        const success = this.logic.move(+x, +y, moveto.x, moveto.y);
      }
    }, PointerEventTypes.POINTERDOWN);
  }

  cancelPieceHighlight() {
    const piece = this.pieceMap.get(this.selected);
    if (piece) {
      piece.getChildMeshes().forEach(mesh => {
        this.highlightLayer?.removeMesh(mesh as Mesh);
      })
    }
    this.selected = ''
  }
  addPieceHightlight() {
    const piece = this.pieceMap.get(this.selected);
    const color = Color3.Yellow();
    if (piece && this.highlightLayer) {
      piece.getChildMeshes().forEach(mesh => {
        this.highlightLayer?.addMesh(mesh as Mesh, color)
      })
    }
  }

  moveMesh(from: { x: number, y: number }, to: { x: number, y: number }) {
    const src_key = `${from.y}-${from.x}`
    const dst_key = `${to.y}-${to.x}`;
    const piece = this.pieceMap.get(src_key);
    if (!piece) return;
    this.cancelPieceHighlight();
    Animation.CreateAndStartAnimation(
      "move",
      piece,
      "position",
      60,
      30,
      piece.position.clone(),
      new Vector3(to.x, 0, to.y),
      Animation.ANIMATIONLOOPMODE_CONSTANT,
      undefined,
      () => {
        const deleted_piece = this.pieceMap.get(dst_key);
        this.pieceMap.delete(src_key);
        this.pieceMap.set(dst_key, piece);
        if (deleted_piece) {
          deleted_piece.dispose()
        }
      },
      this.scene
    );
  }

  dispose() {
    this.scene.dispose();
    this.engine.dispose();
  }
}