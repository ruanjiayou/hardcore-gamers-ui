import React, { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx'
import store from '../stores'
import { ReceiveEvent, SendoutEvent, getSocket, socketEvents, syncRoomScore } from '../services/socket';
import { PlayerList } from '../components/PlayerList';
import { Chat } from '../components/Chat';
import '../styles/index.css';
import '../styles/room.css';
import GameCanvas from "../core/GameCanvas";
import { gameManager } from "../core/GameManager";
import { runInAction } from 'mobx';
import { notificationManager } from '../components/Notifications'
import { GameHeader } from '../components/GameHeader';
import { LoginRequiredPanel } from '../components/LoginRequired'
import { RoomStatus } from '../constant'

export const RoomPage = observer(() => {
  const { slug, room_id } = useParams<{ slug: string, room_id: string; }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    showAgreeDraw: false,
    loading: false,
    match_id: '',
    // 全屏对局中右上角抽屉（玩家列表/聊天）是否展开
    showPanel: false,
    // 计时配置（开局前双方可改，仅象棋）
    tcEnabled: false,
    tcStepSec: 30,
    tcTotalMin: 10,
    tcSaving: false,
    tick: 0, // 每秒自增，驱动倒计时重渲染
    setV(key: 'showAgreeDraw' | 'showPanel' | 'match_id' | 'loading' | 'tcEnabled' | 'tcStepSec' | 'tcTotalMin' | 'tcSaving' | 'tick', v: any) {
      // @ts-ignore - 动态字段赋值
      local[key] = v;
    }
  }));
  const init = (room_id?: string) => {
    if (!room_id || local.loading) {
      return;
    }
    // 游客不拉房间详情（也就不会创建玩家），页面只显示登录提示
    if (!store.auth.isLoggedIn) {
      return;
    }
    local.setV('loading', true)
    // 每次进入/刷新房间都以服务端为准重新拉取玩家状态：
    // 创建房间后本地缓存的 player 仍是 online，不刷新会导致"准备/开始"按钮不出现
    socketEvents.getGamePlayer(slug!, (player) => {
      store.game.setPlayer(player);
    })
    socketEvents.getRoomDetail(room_id, (data) => {
      const room = data?.room;
      local.setV('loading', false);
      // 房间已解散/不存在：服务端返回 room: null，继续渲染会让 roomInfo 相关读取出错
      if (!room) {
        store.room.clear();
        // 本地也清掉 room_id：否则回到游戏主页后又会被"已在房中"逻辑跳回这个死房间
        if (store.game.player) {
          store.game.setPlayer({ ...toJS(store.game.player), room_id: '', state: 'online' });
        }
        notificationManager.show('房间不存在或已解散', 'warning');
        navigate(`/game/${slug}`, { replace: true });
        return;
      }
      store.room.setCurrentRoom(room)
      // 服务端自愈（幽灵对局重置 / 无尽房补开局）后会给出新的对局 id：
      // 画布已经加载的话立刻补拉一次局面，否则会一直停在"连接中"
      const changed = !!data.match_id && data.match_id !== local.match_id;
      local.setV('match_id', data.match_id)
      if (changed) {
        socketEvents.excute(SendoutEvent.GetMatchState, { match_id: data.match_id, game_slug: slug }, (state: any) => {
          gameManager.game?.logic.setState(state);
        });
      }
      // 读取房间计时配置（开局前双方可改）
      const tc = room?.settings?.timeControl;
      if (tc) {
        local.setV('tcEnabled', tc.enabled === true);
        local.setV('tcStepSec', tc.stepLimitSec ?? 30);
        local.setV('tcTotalMin', tc.totalBudgetMin ?? 10);
      }
      console.log('加载玩家信息后加载游戏')
      local.setV('loading', false);
    });
  }
  const socket = getSocket();
  const onPlayerJoined = (data: any) => {
    store.room.addPlayer(data);
    store.room.addMessage({ player_id: data._id, player_name: "系统", message: `玩家 ${data.nickname} 加入房间` })
    if (data._id !== store.game.player_id) {
      init(room_id)
    }
  }
  const onPlayerReJoin = (data: any) => {
    store.room.addMessage({ player_id: data._id, player_name: "系统", message: `玩家 ${data.nickname} 重新连接` })
  }
  const onPlayerLeaved = (data: any) => {
    store.room.removePlayer(data._id);
    store.room.addMessage({ player_id: data._id, player_name: '系统', message: `玩家 ${data.nickname} 离开房间` })
    init(room_id)
  }
  const onPlayerChange = (data: { player_id: string, field: string, value: any }) => {
    store.game.changePlayer(data);
    store.room.changePlayer(data);
  }
  const onGameStart = (data: { room_id: string, match_id: string, timestamp: number }) => {
    store.room.setRoomStatus('playing')
    local.setV('match_id', data.match_id)
    loadState({ match_id: data.match_id, game_slug: slug });
  }
  const onGameOver = (data: { _id: string, nickname: string, reason?: string, draw?: boolean, solo?: boolean, score?: number }) => {
    if (data?.solo && typeof data.score === 'number') {
      // 单人游戏（2048 等）：展示本局得分，而非胜负
      notificationManager.show(`本局得分：${data.score}`, 'success')
    } else if (data?.draw) {
      notificationManager.show('和棋')
    } else if (data?.nickname) {
      const tail = data.reason === 'timeout' ? '（对方超时）' : '';
      notificationManager.show(`玩家 ${data.nickname} 胜利${tail}`)
    }
    store.room.clearClock();
    // 服务端 gameover 后房间回到 waiting；以服务端为准重新拉取，避免状态各说各话
    store.room.setRoomStatus('waiting')
    init(room_id)
  }
  const onClock = (data: any) => {
    if (!data?.enabled) {
      store.room.clearClock();
      return;
    }
    store.room.setClock(data);
  }
  const onTimeControlUpdated = (data: { timeControl: { enabled: boolean, stepLimitSec: number, totalBudgetMin: number } }) => {
    if (!data?.timeControl) return;
    local.setV('tcEnabled', data.timeControl.enabled === true);
    local.setV('tcStepSec', data.timeControl.stepLimitSec ?? 30);
    local.setV('tcTotalMin', data.timeControl.totalBudgetMin ?? 10);
    notificationManager.show('计时设置已更新', 'success');
  }
  const onRoomReady = (data?: any) => {
    // readied 仅表示"全员准备"，房间仍是 waiting 直到房主/自动 start-game
    store.room.setRoomStatus('waiting');
  }
  const onRoomMessage = (message: any) => {
    store.room.addMessage(message);
  }
  const onSettingsUpdated = (data: any) => {
    if (data && typeof data.allowSpectate === 'boolean') {
      store.room.setCurrentRoom({ ...store.room.roomInfo, allowSpectate: data.allowSpectate });
      notificationManager.show(data.allowSpectate ? '房间已允许观战' : '房间已禁止观战');
    }
  }
  const onReceiveDraw = (data: any) => {
    if (data.user_id !== store.auth.user?._id) {
      runInAction(() => {
        local.showAgreeDraw = true;
      })
    }
  }
  const onRoomDisband = () => {
    notificationManager.show('房间已解散', 'warning');
    store.room.clear();
    store.game.setPlayer({ ...store.game.player, room_id: '' });
    // 固定回游戏主页：用 history 回退可能回到已解散的房间地址
    navigate(`/game/${slug}`, { replace: true });
  }
  useEffect(() => {
    if (!room_id) {
      navigate('/lobby');
      return;
    }
    // 未登录：不订阅房间事件，只渲染登录提示
    if (!store.auth.isLoggedIn) {
      return;
    }
    init(room_id)
    // 直接刷新进房间时 store 里可能没有游戏列表，补拉一次：
    // 否则拿不到 variants/mode，单人对局会被当成房间对战（按钮显示"认输"、变体判断也错）
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    // 每秒驱动倒计时重渲染
    const ticker = setInterval(() => local.setV('tick', Date.now()), 1000);
    if (!socket) {
      console.log('此时没有 socket')
      return () => clearInterval(ticker);
    }
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange);
    socket.on(ReceiveEvent.PlayerJoined, onPlayerJoined);
    socket.on(ReceiveEvent.PlayerLeaved, onPlayerLeaved);
    socket.on(ReceiveEvent.PlayerReJoin, onPlayerReJoin);

    socket.on(ReceiveEvent.GameStart, onGameStart);
    socket.on(ReceiveEvent.GameOver, onGameOver);
    socket.on(ReceiveEvent.Clock, onClock);
    socket.on(ReceiveEvent.TimeControlUpdated, onTimeControlUpdated);
    socket.on(ReceiveEvent.RoomMessage, onRoomMessage);
    socket.on(ReceiveEvent.RoomReady, onRoomReady);
    socket.on(ReceiveEvent.SettingsUpdated, onSettingsUpdated);
    socket.on(ReceiveEvent.OfferDraw, onReceiveDraw);
    // 房主离开/解散房间后，房间内其他人同步退出
    socket.on(ReceiveEvent.RoomDisband, onRoomDisband);
    return () => {
      clearInterval(ticker);
      // 组件卸载（返回主页 / 浏览器后退 / 刷新）时也同步一次分数；服务端 disconnect 另有兜底
      syncRoomScore(room_id);
      gameManager.unload();
      store.room.clearClock();
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange);
      socket.off(ReceiveEvent.PlayerJoined, onPlayerJoined);
      socket.off(ReceiveEvent.PlayerLeaved, onPlayerLeaved);
      socket.off(ReceiveEvent.PlayerReJoin, onPlayerReJoin);
      socket.off(ReceiveEvent.GameStart, onGameStart);
      socket.off(ReceiveEvent.GameOver, onGameOver);
      socket.off(ReceiveEvent.Clock, onClock);
      socket.off(ReceiveEvent.TimeControlUpdated, onTimeControlUpdated);
      socket.off(ReceiveEvent.RoomMessage, onRoomMessage);
      socket.off(ReceiveEvent.RoomReady, onRoomReady);
      socket.off(ReceiveEvent.SettingsUpdated, onSettingsUpdated);
      socket.off(ReceiveEvent.OfferDraw, onReceiveDraw);
      socket.off(ReceiveEvent.RoomDisband, onRoomDisband);
    };
  }, [room_id, navigate]);

  // 兜底：进房后迟迟拿不到"进行中的对局"（match_id 仍为空）就重拉一次房间详情。
  // 服务端已经会自愈幽灵房，这里只防事件错过 / 网络抖动导致的空画面（表现为一直"连接中"）。
  useEffect(() => {
    if (!room_id || !store.auth.isLoggedIn || local.match_id) return;
    const timer = setTimeout(() => init(room_id), 2000);
    return () => clearTimeout(timer);
  }, [room_id, local.match_id]);

  const loadState = (data: { match_id: string, game_slug?: string }) => {
    console.log(data, '加载对局数据')
    socketEvents.excute(SendoutEvent.GetMatchState, data, (state: any) => {
      gameManager.game?.logic.setState(state)
    });
  }
  const handleAddRobot = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.AddRobot, { room_id }, (success: boolean, message?: string) => {
      if (success) {
        notificationManager.show('添加机器人成功', 'success')
      } else {
        notificationManager.show(message || '添加机器人失败', 'warning')
      }
    });
  }

  const handleStartGame = () => {
    if (!room_id) return;
    // 房主手动开始：服务端校验身份/状态/人数，失败时透传原因
    socketEvents.excute(SendoutEvent.StartGame, { room_id, player_id: store.game.player_id }, (success: boolean, message?: string) => {
      if (!success) {
        notificationManager.show(message || '人数不足，无法开始游戏', 'warning')
      }
    });
  }
  const handleLeaveRoom = () => {
    if (!room_id) return;
    syncRoomScore(room_id);
    socketEvents.excute(SendoutEvent.LeaveRoom, { room_id, player_id: store.game.player_id }, (success: boolean, message?: string) => {
      if (!success) {
        notificationManager.show(message || '无法离开房间', 'warning');
        return;
      }
      store.room.clear();
      store.game.setPlayer({ ...store.game.player, room_id: '' })
      // 服务端区分"房间已解散"（自建房房主/临时房）与"已离开房间"
      notificationManager.show(message || '已离开房间', 'success');
      // 固定回游戏主页：用 history 回退可能回到已解散的房间地址
    navigate(`/game/${slug}`, { replace: true });
    });
  };
  /** 解散房间：仅自建非官方房的房主可用（服务端强校验） */
  const handleDisband = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.Disband, { room_id }, (success: boolean, message?: string) => {
      if (!success) {
        notificationManager.show(message || '解散失败', 'warning');
        return;
      }
      store.room.clear();
      store.game.setPlayer({ ...store.game.player, room_id: '' });
      notificationManager.show('房间已解散', 'success');
      // 固定回游戏主页：用 history 回退可能回到已解散的房间地址
    navigate(`/game/${slug}`, { replace: true });
    });
  };
  /** 观战开关：房主在开局前切换（服务端仅等待态允许） */
  const handleToggleSpectate = (allow: boolean) => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.UpdateSettings, { room_id, allowSpectate: allow }, (success: boolean, message?: string) => {
      if (success) {
        store.room.setCurrentRoom({ ...store.room.roomInfo, allowSpectate: allow });
        notificationManager.show(allow ? '已允许观战' : '已禁止观战', 'success');
      } else {
        notificationManager.show(message || '设置失败', 'warning');
      }
    });
  };
  const handleRestart = () => {
    if (isSoloGame) {
      // 单人游戏：重新开始 = 另开一局（旧临时房在快开时会被服务端销毁）
      socketEvents.quickStart(slug!, roomVariant, (success, data: any, message?: string) => {
        if (success && data?.room_id) {
          navigate(`/game/${slug}/room/${data.room_id}`, { replace: true });
        } else {
          notificationManager.show(message || '重新开始失败', 'warning');
        }
      });
      return;
    }
    store.room.setRoomStatus('waiting')
    loadState({ game_slug: slug, match_id: '', })
  }
  const requestSurrender = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.PlayerSurrender, {
      room_id: room_id,
      match_id: local.match_id,
      player_id: store.game.player_id,
    }, (success: boolean) => {
      console.log(success, '认输')
    })
  }
  const handleRequestDraw = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.OfferDraw, room_id);
  }
  const handleSaveTimeControl = () => {
    if (!room_id || local.tcSaving) return;
    local.setV('tcSaving', true);
    socketEvents.excute(SendoutEvent.UpdateTimeControl, {
      room_id,
      timeControl: {
        enabled: local.tcEnabled,
        stepLimitSec: Number(local.tcStepSec),
        totalBudgetMin: Number(local.tcTotalMin),
      }
    }, (success: boolean, message?: string) => {
      local.setV('tcSaving', false);
      notificationManager.show(success ? '计时设置已保存' : (message || '保存失败'), success ? 'success' : 'warning');
    });
  }

  // ===== 倒计时展示（象棋读秒制）=====
  const fmt = (ms: number) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };
  // 与服务端 projectedRemaining 同公式：本回合超出步时限的部分从总额度扣除
  const projectRemaining = (playerId: string) => {
    const clock = store.room.clock;
    if (!clock) return 0;
    const base = clock.remaining[playerId] ?? clock.budgetMs;
    const startedAt = clock.turnStartedAt[playerId] ?? clock.serverNow;
    const now = store.room.serverNow();
    const overtime = Math.max(0, now - startedAt - clock.stepLimitMs);
    return base - overtime;
  };
  const stepLeft = () => {
    const clock = store.room.clock;
    if (!clock) return 0;
    const startedAt = clock.turnStartedAt[clock.curr_turn] ?? clock.serverNow;
    return clock.stepLimitMs - (store.room.serverNow() - startedAt);
  };
  const isXiangqi = slug === 'xiangqi';
  const gameInfo = store.game.games.find(g => g.slug === slug);
  // 玩法变体：贪吃蛇同一 slug 下有无尽/多人两种房间，房间设置里记录 variant。
  // 旧房间/异常数据没有 variant 时兜底：混合玩法游戏的非临时房一律按房间变体处理。
  const roomVariant = (store.room.roomInfo?.settings?.variant as string | undefined)
    || (gameInfo?.variants?.length
      ? (store.room.roomInfo?.transient
        ? gameInfo.variants.find(v => v.mode === 'solo')?.key
        : gameInfo.variants.find(v => v.mode === 'room')?.key)
      : undefined);
  // 单人玩法（无对手）：一人即可开局，不提供机器人/求和/认输。
  // 优先看房间 variant（混合玩法游戏），否则按游戏 mode / 人数兜底。
  const variantInfo = gameInfo?.variants?.find(v => v.key === roomVariant);
  const isSoloGame = variantInfo
    ? variantInfo.mode === 'solo'
    : (gameInfo?.mode ?? ((gameInfo?.numbers?.max ?? 2) <= 1 ? 'solo' : 'room')) === 'solo';
  // 实时对局（多人贪吃蛇）：没有求和机制，认输 = 自我淘汰
  const isRealtimeGame = slug === 'snake' && roomVariant === 'multi';
  // 无尽挑战竞技房：进房自动开局，死了自动重生，随时可以退出（不算逃跑）
  const isEndlessArena = slug === 'snake' && roomVariant === 'endless';
  // 官方无尽桌没有"开始游戏"：进房即开局
  const autoStarted = isEndlessArena && !!store.room.roomInfo?.official;
  const clock = store.room.clock;
  // 解散按钮仅自建非官方房的房主显示；官方房/他人房间/临时房只能"退出"
  const isOwner = store.room.roomInfo?.owner_id === store.game.player_id;
  const canDisband = isOwner && !store.room.roomInfo?.official && !store.room.roomInfo?.transient;
  // 贪吃蛇对局中切全屏沉浸：棋盘铺满视口，房间操作收进右上角悬浮按钮
  const immersive = slug === 'snake' && store.room.status === RoomStatus.playing;

  useEffect(() => {
    if (!immersive) return;
    // 锁住外层页面滚动（并隐藏导航栏），避免全屏时还能拖动页面
    document.body.classList.add('immersive-mode');
    return () => document.body.classList.remove('immersive-mode');
  }, [immersive]);

  // 未登录：直接打开房间地址也只显示登录提示
  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入房间对局" />;
  }

  return (
    <div className={`room-page${immersive ? ' immersive' : ''}`}>
      {/* 非沉浸对局：与游戏主页同一套顶栏，返回回该游戏主页 */}
      {!immersive && (
        <GameHeader
          title={gameInfo?.title || slug || '对局'}
          subtitle={store.room.roomInfo?.name || variantInfo?.label || ''}
          onBack={() => {
            // 玩家仍在房间里，游戏主页的"继续对局"逻辑会立刻把他弹回来；
            // 用一次性标记告诉游戏主页：这次是主动返回，不要自动回房
            sessionStorage.setItem('lobby:skipRoomResume', '1');
            syncRoomScore(room_id);
            navigate(`/game/${slug}`);
          }}
        />
      )}
      <div className='room-stage'>
      <div className='room-container'>
        <div className='game-main'>
          <GameCanvas
            // 必须等到「本房间」详情回来再加载游戏：roomInfo 初始是空壳，
            // 提前加载会拿不到 settings.variant（贪吃蛇会先按多人初始化再切换）
            ready={!!(store.game.player && store.room.roomInfo?._id === room_id)}
            onReady={(canvas: HTMLCanvasElement) => {
              const socket = getSocket()
              if (socket) {
                gameManager.load(slug!, canvas, socket, toJS(store.game.player), {
                  variant: roomVariant,
                  room: toJS(store.room.roomInfo),
                }).then(() => {
                  console.log('game loaded')
                  // 死亡弹框的「退出」：交给房间页走正常离房流程（无尽房直接退出，不结算）
                  const logic: any = gameManager.game?.logic
                  logic?.on?.('exit', () => handleLeaveRoom())
                  loadState({ game_slug: slug, match_id: local.match_id, })
                });
              }
            }}
          />
        </div>
        {immersive ? (
          /* 全屏对局：设置/退出悬浮在右上角，不占棋盘空间 */
          <div className="immersion-hud">
            <div className="hud-buttons">
              <button
                className="hud-btn"
                title="玩家与聊天"
                onClick={() => local.setV('showPanel', !local.showPanel)}
              >☰</button>
              {isSoloGame || isEndlessArena
                ? <button className="hud-btn danger" onClick={handleLeaveRoom}>退出</button>
                : (store.game.player?.member_type === 'player'
                  ? <button className="hud-btn danger" onClick={requestSurrender}>认输</button>
                  : null)}
            </div>
            {local.showPanel && (
              <div className="hud-drawer">
                <PlayerList room_id={room_id!} />
                <Chat room_id={room_id!} />
              </div>
            )}
          </div>
        ) : (
        <div className='game-info'>
          {/* 对局中：读秒制时钟（每步限时 + 个人总额度） */}
          {store.room.status === RoomStatus.playing && clock?.enabled && (
            <div className="clock-panel">
              <div className="clock-title">⏱️ 读秒 <span className="clock-step">{fmt(stepLeft())}</span> / 步</div>
              {store.room.players.map((p: any) => {
                const isTurn = p._id === clock.curr_turn;
                const remaining = projectRemaining(p._id);
                const danger = remaining <= 30000;
                return (
                  <div className={`clock-row ${isTurn ? 'active' : ''} ${danger ? 'danger' : ''}`} key={p._id}>
                    <span className="clock-role">{p.role === 'red' ? '红方' : '黑方'} {isTurn ? '●' : ''}</span>
                    <span className="clock-name">{p.nickname || '玩家'}</span>
                    <span className="clock-time">{fmt(remaining)}</span>
                  </div>
                );
              })}
              <div className="clock-hint">步时 {Math.round(clock.stepLimitMs / 1000)}s，超时部分从总额度扣</div>
            </div>
          )}

          {/* 开局前：双方均可配置计时（仅象棋） */}
          {isXiangqi && store.room.status === RoomStatus.waiting && (
            <div className="timecontrol-panel">
              <div className="tc-title">⏱️ 计时设置（开局前双方可改）</div>
              <label className="tc-row">
                <input type="checkbox" checked={local.tcEnabled}
                  onChange={(e) => local.setV('tcEnabled', e.target.checked)} />
                启用计时
              </label>
              {local.tcEnabled && (
                <Fragment>
                  <label className="tc-row">每步限时（秒）
                    <input type="number" min={5} max={300} value={local.tcStepSec}
                      onChange={(e) => local.setV('tcStepSec', e.target.value as any)} />
                  </label>
                  <label className="tc-row">每人总额度（分钟）
                    <input type="number" min={1} max={120} value={local.tcTotalMin}
                      onChange={(e) => local.setV('tcTotalMin', e.target.value as any)} />
                  </label>
                </Fragment>
              )}
              <button className="tc-save" disabled={local.tcSaving} onClick={handleSaveTimeControl}>
                {local.tcSaving ? '保存中…' : '保存计时设置'}
              </button>
            </div>
          )}

          {/* 开局前：房主可切换观战开关（官方房同样由房主管理） */}
          {store.room.status === RoomStatus.waiting && isOwner && (
            <div className="timecontrol-panel">
              <div className="tc-title">⚙️ 房间设置</div>
              <label className="tc-row">
                <input type="checkbox"
                  checked={store.room.roomInfo?.allowSpectate !== false}
                  onChange={(e) => handleToggleSpectate(e.target.checked)} />
                允许观战
              </label>
              {store.room.roomInfo?.official && <div className="clock-hint">官方房间：只能退出，不可解散</div>}
            </div>
          )}

          <div className="room-actions">
            {/* 单人游戏无需机器人；多人对战房主可为房间补 AI 对手 */}
            {!isSoloGame && !isEndlessArena && store.room.status === RoomStatus.waiting && isOwner && <button onClick={handleAddRobot}>添加机器人</button>}
            {/*
              所有玩家（不含观战）进房即自动 prepared，无需手动准备/取消按钮。
              开局完全由房主点"开始游戏"控制（服务端已移除"全员准备自动开局"）。
              单人游戏一人即可开局，多人对战至少 2 人。
            */}
            {store.room.status === RoomStatus.waiting
              && !autoStarted
              && isOwner
              && store.room.players.length >= (isSoloGame ? 1 : 2)
              && <button onClick={handleStartGame}>开始游戏</button>}
            {[RoomStatus.finished].includes(store.room.status) && <button onClick={handleRestart} className="danger">重新开始</button>}
            {/*
              等待/结束态：自建非官方房的房主显示"解散房间"，其余（官方房/他人房间/临时房）显示"退出"。
              对局进行中不允许离开（只能认输/求和），单人游戏除外——离开即销毁临时房。
            */}
            {[RoomStatus.waiting, RoomStatus.finished].includes(store.room.status) && (
              canDisband
                ? <button onClick={handleDisband} className="danger">解散房间</button>
                : <button onClick={handleLeaveRoom} className="danger">退出</button>
            )}
            {(isSoloGame || isEndlessArena) && store.room.status === RoomStatus.playing && (
              <button onClick={handleLeaveRoom} className="danger">退出</button>
            )}
            {store.room.status === RoomStatus.playing && !isEndlessArena && store.game.player?.member_type === 'player' && !isSoloGame && <Fragment>
              {!isRealtimeGame && <button onClick={handleRequestDraw}>求和</button>}
              <button onClick={requestSurrender} className="danger">认输</button>
            </Fragment>}
          </div>
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: '0.5rem' }}>
            <PlayerList room_id={room_id!} />
            <Chat room_id={room_id!} />
          </div>
        </div>
        )}
      </div>
      </div>
    </div>
  );
});