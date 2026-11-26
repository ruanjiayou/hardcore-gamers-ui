import React, { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx';
import store from '../stores'
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents, syncRoomScore } from '../services/socket';
import { loadGameAssets } from '../services/assets';
import { Leaderboard } from '../components/Leaderboard';
import { LoginRequiredPanel } from '../components/LoginRequired';
import { GameHeader } from '../components/GameHeader';
import { GameSettings } from '../components/GameSettings';
import { notificationManager } from '../components/Notifications';
import { getManifest } from '../services/assets';
import '../styles/index.css';
import '../styles/game.css';
import '../styles/room.css';

export const GamePage = observer(() => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    type: 'create',
    name: '',
    show: false,
    allowSpectate: true,
    starting: false,
    matching: false,
    // 排队等位（竞技场满员时）：waiting=true 表示人已在服务端队列里
    waiting: false,
    queueSize: 0,
    // 顶栏排行榜弹框（下方排行榜已移除，UI-067）
    showBoard: false,
    // 资源清单异步到达后触发一次重渲染，让「当前皮肤」立刻刷新（UI-069）
    skinTick: 0,
    // 官方房间列表（只展示官方桌，私有房不显示）
    rooms: [] as any[],
    setV(o: object) {
      for (let k in o) {
        // @ts-ignore
        local[k] = o[k];
      }
    },
  }))

  const game = store.game.games.find(g => g.slug === slug);
  const variants = game?.variants || [];
  // 玩法变体（贪吃蛇：无尽/多人）：默认选第一个
  const [activeVariant, setActiveVariant] = useState<string>('');
  useEffect(() => {
    setActiveVariant(prev => (prev && variants.some(v => v.key === prev) ? prev : (variants[0]?.key || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, variants.length]);

  const variantInfo = variants.find(v => v.key === activeVariant);
  // 游戏主页形态：solo=单人直接开局；room=房间制（棋类/组队）。
  // 有变体时以变体为准；否则按 mode（未加载时按人数回退：1 人即单人）。
  const isSolo = variantInfo
    ? variantInfo.mode === 'solo'
    : (game?.mode ?? ((game?.numbers?.max ?? 2) <= 1 ? 'solo' : 'room')) === 'solo';

  /** 单人玩法：一键开一局（服务端建临时房并立即开局，无需房间） */
  const handleQuickStart = () => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能开始游戏');
      return;
    }
    if (local.starting) return;
    local.setV({ starting: true });
    socketEvents.quickStart(slug!, variantInfo?.key, (success, data, message) => {
      local.setV({ starting: false });
      if (success && data?.room_id) {
        navigate(`/game/${slug}/room/${data.room_id}`);
      } else {
        alert(message || '开始游戏失败');
      }
    });
  };

  /**
   * 匹配：在已有的官方桌里找一张还有空位的桌子。
   * - 找到空位 → 直接进房间；
   * - 全部满员 → 进等待队列（服务端排队，有空位就把我拉进去）。
   */
  const handleMatch = (variantKey?: string) => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能匹配');
      return;
    }
    if (local.matching) return;
    local.setV({ matching: true });
    socketEvents.match(slug!, variantKey ?? variantInfo?.key, (success, player, message) => {
      local.setV({ matching: false });
      // 排队中：不是错误，是"桌子满了，等一会儿"
      if (success && player?.waiting) {
        local.setV({ waiting: true, queueSize: player.queue_size || 1 });
        return;
      }
      const room_id = player?.room_id;
      if (success && room_id) {
        navigate(`/game/${slug}/room/${room_id}`);
      } else {
        alert(message || '匹配失败，请重试');
      }
    });
  };

  /** 取消排队 */
  const handleCancelMatch = () => {
    socketEvents.cancelMatch((success) => {
      if (success) local.setV({ waiting: false, queueSize: 0 });
    });
  };

  const handleCreateRoom = (variantKey?: string) => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能创建房间');
      return;
    }
    socketEvents.excute(SendoutEvent.CreateRoom, {
      slug,
      // 玩法按钮直接建房（不再走命名弹框），给个默认名避免空房间名
      name: local.name || `${store.auth.displayName || '玩家'} 的${variants.find(v => v.key === (variantKey ?? variantInfo?.key))?.label || '游戏'}房间`,
      allowSpectate: local.allowSpectate,
      variant: variantKey ?? variantInfo?.key,
    }, (success: boolean, room_id: string, error?: string) => {
      if (success && room_id) {
        navigate(`/game/${slug}/room/${room_id}`);
        local.setV({ show: false });
      } else {
        alert(error || '创建房间失败');
      }
    });
  };

  const onPlayerChange = (data: { player_id: string, field: string, value: any }) => {
    store.game.changePlayer(data);
    store.room.changePlayer(data);
  }

  const onRoomCreated = () => {

  }
  const socket = getSocket();
  /** 刷新官方房间列表：只展示官方桌，私有房/临时房不对外显示（贪吃蛇主页不展示房间列表，跳过） */
  const loadOfficialRooms = () => {
    if (isSnakeHome || !game?._id || !socket) return;
    socketEvents.getRooms(game._id, (rooms: any[]) => {
      local.setV({ rooms: (rooms || []).filter(r => r.official === true) });
    });
  };
  useEffect(() => {
    if (!slug || !socket) return;
    // 进入游戏主页就切到该游戏的专属音效配置（早于匹配/开局，房间页会幂等再设一次）
    store.audio.setGame(slug);
    // 图片资源（皮肤）在加载阶段一次拉完并预加载：对局内不再发图片请求
    loadGameAssets(slug).then(() => local.setV({ skinTick: local.skinTick + 1 }));
    // 直接打开/刷新游戏主页时 store 里还没有游戏列表，需要自己拉一次，
    // 否则拿不到 mode/variants，单人会误显示成房间对战
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    // 从房间页主动点了返回：本次不要自动回房，否则返回按钮形同虚设
    const skipResume = sessionStorage.getItem('lobby:skipRoomResume') === '1';
    if (skipResume) sessionStorage.removeItem('lobby:skipRoomResume');
    if (store.auth.isLoggedIn) {
      // **每次进游戏主页都拉一次当前游戏的 player**（不能只在 store 为空时拉）：
      // store.game.player 是全局单例、不区分游戏，玩过 A 再点 B 时它非空，
      // 旧逻辑会直接跳过拉取 → 拿不到 B 的 room_id → 明明人在房里却停在游戏主页。
      socketEvents.getGamePlayer(slug, (player) => {
        if (!player) return;
        store.game.setPlayer(player);
        // 已在房间里（如从大厅点进游戏、或刷新后回来）→ 直接回到那个房间。
        //
        // 自动回房前必须确认房间还在：player.room_id 可能是历史遗留的脏指针
        // （房间已解散 / 玩家早已不在成员表里）。直接跳过去会进一个死房间，
        // 房间页再把玩家弹回来，形成"进游戏页 → 弹回房间 → 再弹回游戏页"的循环，
        // 表现为反复弹出"已离开房间"。
        const roomId = player?.room_id;
        if (roomId && !skipResume) {
          socketEvents.getRoomDetail(roomId, (detail: any) => {
            if (detail?.room) {
              navigate(`/game/${slug}/room/${roomId}`);
            } else {
              // 房间没了：清掉本地指针，别再往死房间里跳
              store.game.setPlayer({ ...toJS(player), room_id: '', state: 'online' });
            }
          });
        }
      })
    }
    // 房间玩法才拉官方房列表；单人游戏没有房间
    if (!isSolo) loadOfficialRooms();
    socket.on(ReceiveEvent.RoomCreated, onRoomCreated)
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange)
    socket.on(ReceiveEvent.PlayerJoined, loadOfficialRooms)
    socket.on(ReceiveEvent.PlayerLeaved, loadOfficialRooms)
    return () => {
      socket.off(ReceiveEvent.RoomCreated, onRoomCreated)
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange)
      socket.off(ReceiveEvent.PlayerJoined, loadOfficialRooms)
      socket.off(ReceiveEvent.PlayerLeaved, loadOfficialRooms)
    }
  }, [slug, navigate]);

  // 未登录：直接打开游戏地址也只显示登录提示（不渲染房间/战绩等需要身份的内容）
  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入游戏、创建房间或上榜" />;
  }

  // 贪吃蛇主页单独排版：玩法按钮 + 当前皮肤 + 底部提示；
  // 不再展示官方房间列表（无尽竞技房常驻 playing，列表里永远是"对局中 + 加入不可用"，纯误导）
  const isSnakeHome = slug === 'snake';
  // 首帧 variants 还没回填时 activeVariant 为空，退回第一个玩法，避免按钮闪成另一个玩法
  const isEndlessVariant = (activeVariant || variants[0]?.key) === 'endless';
  const isBusyMode = local.matching || local.starting;

  /** 玩法按钮（UI-070）：贪吃蛇无尽=直接匹配、团队=直接建房；其余游戏仍是选中变体 */
  const handleVariant = (v: any) => {
    if (isSnakeHome) {
      if (isBusyMode || local.waiting) return;
      if ((activeVariant || variants[0]?.key) !== v.key) setActiveVariant(v.key);
      if (v.arena || v.key === 'endless') handleMatch(v.key);
      else handleCreateRoom(v.key);
      return;
    }
    setActiveVariant(v.key);
  };
  const modeButtons = variants.length > 0 && (
    <div className="mode-buttons">
      {variants.map(v => (
        <button
          key={v.key}
          className={`mode-btn${(activeVariant || variants[0]?.key) === v.key ? ' active' : ''}`}
          disabled={isSnakeHome && isBusyMode}
          onClick={() => handleVariant(v)}
        >
          <span className="mode-label">{v.label}</span>
        </button>
      ))}
    </div>
  );

  // 顶栏中间入口（icon 左、名称右）：商店只有贪吃蛇有（UI-076），排行榜所有游戏都有
  const headerCenter = (
    <>
      {isSnakeHome && (
        <button className="game-header-center-btn" onClick={() => notificationManager.show('商店即将开放', 'warning')}>
          <span className="game-header-center-icon" aria-hidden>🛒</span><span>商店</span>
        </button>
      )}
      <button className="game-header-center-btn" onClick={() => local.setV({ showBoard: true })}>
        <span className="game-header-center-icon" aria-hidden>🏆</span><span>排行榜</span>
      </button>
    </>
  );

  // 顶栏右侧业务入口（UI-076）：好友只在多人游戏出现，设置（音效）各游戏都有。
  // GameHeader 只共用一个头像下拉 + 关闭按钮，这些入口由本页按游戏组装。
  const headerExtra = (
    <>
      {!isSolo && (
        <button
          className="game-header-icon-btn"
          title="好友"
          aria-label="好友"
          onClick={() => navigate(`/game/${slug}/friends`)}
        >
          <span aria-hidden="true">👥</span>
        </button>
      )}
      <GameSettings game={slug} />
    </>
  );

  // 当前皮肤预览（UI-069）：取已装备那件的图，没图回退 emoji
  void local.skinTick; // 依赖：manifest 到达后重新计算
  const currentSkin = (() => {
    const m = getManifest(slug || '');
    const id = m?.equipped || '';
    const item = m?.skins?.find(s => s.id === id);
    return { url: item?.url || '', label: item?.label || '默认皮肤' };
  })();

  return (
    <div className="game-page">
      {/* 游戏主页顶栏（UI-067）：左头像+昵称+badge，中商店/榜单，右好友/设置/关闭 */}
      <GameHeader
        title={game?.title || slug || '游戏'}
        subtitle={isSolo ? '单人挑战' : (variantInfo?.label || '房间对战')}
        mode="game"
        profileGame={slug}
        center={headerCenter}
        extra={headerExtra}
        onBack={() => {
          // 点返回回大厅时把当前分同步进排行榜（对局仍在房间里，不影响继续玩）
          syncRoomScore();
          navigate('/lobby');
        }}
      />
      <div className="game-body">
        <div className={`game-container${isSnakeHome ? ' snake-home' : ''}`}>
          {/* 当前皮肤只有贪吃蛇有（UI-076）；皮肤在上、玩法横向按钮在下（UI-073） */}
          {isSnakeHome && (
            <div className="current-skin">
              <div className="current-skin-preview">
                {currentSkin.url ? <img src={currentSkin.url} alt={currentSkin.label} /> : <span aria-hidden>🐍</span>}
                {/* 刷新/sync 图标压在皮肤预览图右上，点进皮肤页（UI-073） */}
                <button
                  className="current-skin-refresh"
                  onClick={() => navigate(`/game/${slug}/skins`)}
                  title="更换皮肤"
                  aria-label="更换皮肤"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 11a8.1 8.1 0 0 0-14.5-5L3 9" /><path d="M3 4v5h5" />
                    <path d="M4 13a8.1 8.1 0 0 0 14.5 5L21 15" /><path d="M21 20v-5h-5" />
                  </svg>
                </button>
              </div>
              <div className="current-skin-label">当前皮肤 · {currentSkin.label}</div>
            </div>
          )}
          {modeButtons}

          {/* 房间玩法：匹配/创建收进一条工具栏，不再挤在标题行（贪吃蛇改走底部大按钮） */}
          {!isSolo && !isSnakeHome && (
            <div className="game-toolbar">
              <button className="primary" disabled={local.matching} onClick={() => handleMatch()}>
                {local.matching ? '匹配中…' : '匹配'}
              </button>
              <button
                className="ghost"
                onClick={() => local.setV({ type: 'create', show: true, allowSpectate: true })}
              >创建房间</button>
            </div>
          )}

          {/* 官方房间列表：只有该游戏预建了官方桌时才显示，私有房不展示（贪吃蛇不展示） */}
          {!isSolo && !isSnakeHome && local.rooms.length > 0 && (
            <div className="room-list">
              <div className="room-list-header">
                <h3>🏛️ 官方房间</h3>
              </div>
              <div className="room-cells">
                {local.rooms.map((room: any) => {
                  const playing = room.status === 'playing';
                  const full = (room.members?.length || 0) >= (room.numbers?.max || 2);
                  // 玩家已经在这个房间里：按钮是「进入」而不是「加入」。
                  // 「加入」在这种状态下是灰的（对局中或满员），玩家看着像被挡在门外，
                  // 实际上他自己就在这个房里 —— 应该能直接跳进去。
                  const isMyRoom = !!store.game.player?.room_id && store.game.player.room_id === room._id;
                  return (
                    <div key={room._id} className={`room-cell${playing || full ? ' playing' : ''}`}>
                      <div>
                        <h4>{room.name}</h4>
                        <p>{room.members?.length || 0}/{room.numbers?.max || 2} 人{playing ? ' · 对局中' : ''}</p>
                      </div>
                      <button
                        disabled={!isMyRoom && (playing || full)}
                        onClick={() => {
                          if (isMyRoom) {
                            navigate(`/game/${slug}/room/${room._id}`);
                            return;
                          }
                          if (!store.auth.isLoggedIn) {
                            store.ui.openLoginPrompt('登录后才能加入房间');
                            return;
                          }
                          socketEvents.joinRoom({ room_id: room._id }, (success) => {
                            if (success) navigate(`/game/${slug}/room/${room._id}`);
                            else alert('加入房间失败，请重试');
                          });
                        }}
                      >{isMyRoom ? '进入' : '加入'}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 单人玩法：排行榜之上，开始按钮用 margin-top:auto 固定在靠近底部的位置 */}
          {isSolo && (
            <div className="solo-start">
              <button className="solo-start-btn" disabled={local.starting} onClick={handleQuickStart}>
                {local.starting ? '正在开局…' : `▶ 开始${variantInfo?.label || '游戏'}`}
              </button>
              <p className="solo-hint">单人模式，无需房间，成绩实时计入{variantInfo?.board === 'endless' ? '无尽榜' : '排行榜'}</p>
            </div>
          )}

          {/* 贪吃蛇：玩法按钮已在上方横向排列，这里只保留排队状态与提示 */}
          {isSnakeHome && (
            <div className="snake-actions">
              {local.matching && <p className="solo-hint">正在进入竞技场…</p>}
              {local.waiting ? (
                <div className="match-waiting">
                  <p>🎮 当前竞技场已满，正在排队等待空位（前面还有 {local.queueSize} 人）…</p>
                  <button className="snake-join-btn" onClick={handleCancelMatch}>取消排队</button>
                </div>
              ) : (
                <p className="solo-hint">
                  {isEndlessVariant ? '进入无尽竞技房，与场上玩家、人机同图刷分' : '最多 6 队同场，每队 5 人，最后存活的一队获胜'}
                </p>
              )}
            </div>
          )}

          {/* 创建房间模态框（仅房间玩法） */}
          {local.show && (
            <div className="modal">
              <div className="modal-content">
                <h3>创建房间</h3>
                <input
                  type="text"
                  placeholder="房间名称"
                  value={local.name}
                  onChange={(e) => local.setV({ name: e.target.value })}
                />
                {/* 房间列表已下线（改用匹配），私密房没有"被找到"的入口，这里只留公开房设置 */}
                <label>
                  <input
                    type="checkbox"
                    checked={local.allowSpectate}
                    onChange={(e) => local.setV({ allowSpectate: e.target.checked })}
                  />
                  允许观战
                </label>
                <div className="modal-actions">
                  <button onClick={() => local.setV({ show: false })}>取消</button>
                  <button onClick={() => handleCreateRoom()}>创建</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 排行榜弹框：下方排行榜已移除，入口收进顶栏中间（UI-067） */}
      {local.showBoard && (
        <div className="modal" onMouseDown={() => local.setV({ showBoard: false })}>
          <div className="modal-content board-modal" onMouseDown={e => e.stopPropagation()}>
            <button className="settings-close" onClick={() => local.setV({ showBoard: false })} aria-label="关闭">×</button>
            <Leaderboard slug={slug as string} limit={10} boards={game?.boards} />
          </div>
        </div>
      )}
    </div>
  );
});
