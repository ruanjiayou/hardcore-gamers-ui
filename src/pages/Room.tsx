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
import { resolveExitIntent, resolveLeaveToast } from '../core/exitIntent';
import { runInAction } from 'mobx';
import { notificationManager } from '../components/Notifications'
import { GameHeader } from '../components/GameHeader';
import { GameSettings } from '../components/GameSettings';
import { LoginRequiredPanel } from '../components/LoginRequired'
import { RoomStatus } from '../constant'

// 落子音节流：同一帧多个动作只播一次，避免批量快照把音效叠成噪音
let lastMoveSfxAt = 0;

export const RoomPage = observer(() => {
  const { slug, room_id } = useParams<{ slug: string, room_id: string; }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    showAgreeDraw: false,
    showLeaveDialog: false,
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
    // 2048 终局标记：服务端 gameover 会把房间拨回 waiting，靠它区分"结束"和"等待开局"
    soloOver: false,
    // 本局已结束（组队模式认输/自我淘汰后）：退出沉浸对局，回到房间界面
    endedMatch: false,
    // 单机游戏分数快照（从 gameManager.game.logic 读，随 tick 刷新到右侧面板）
    soloStats: { score: 0, best: 0, lines: 0, level: 0 },
    setV(key: 'showAgreeDraw' | 'showLeaveDialog' | 'showPanel' | 'match_id' | 'loading' | 'tcEnabled' | 'tcStepSec' | 'tcTotalMin' | 'tcSaving' | 'tick' | 'soloOver' | 'endedMatch' | 'soloStats', v: any) {
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
    if (data.field === 'score' && Number(data.value) > 0) store.audio.play('collect');
  }
  const onPlayerAction = (data?: any) => {
    // 实时游戏（贪吃蛇）用同一个事件广播 20Hz 的局面快照，不是"落子"。
    // 之前这里每 90ms 播一次 move 音效 → 每秒十几次媒体元素创建/播放，
    // 在手机上是很实在的开销（同时也是一片噪声）。回合制游戏才播落子音。
    if (data?.snake) return;
    const now = performance.now();
    if (now - lastMoveSfxAt < 90) return;
    lastMoveSfxAt = now;
    store.audio.play('move');
  }
  const onGameStart = (data: { room_id: string, match_id: string, timestamp: number }) => {
    store.audio.play('click');
    store.audio.startBgm();
    store.room.setRoomStatus('playing')
    local.setV('soloOver', false)
    local.setV('match_id', data.match_id)
    loadState({ match_id: data.match_id, game_slug: slug });
  }
  const onGameOver = (data: { _id: string, nickname: string, reason?: string, draw?: boolean, solo?: boolean, score?: number }) => {
    // 单人只看得分，双人按是否本人获胜区分胜负音
    const mine = data?.nickname && (
      data.nickname === store.auth.user?.name || data.nickname === (store.game.player as any)?.nickname
    );
    store.audio.play(data?.solo ? 'collect' : data?.draw ? 'click' : mine ? 'win' : 'lose');
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
    // 进入对局页加载语音包配置并切到该游戏的专属音效，再起 BGM（自动播放被拦时等首次手势恢复）
    if (slug) store.audio.setGame(slug);
    if (!store.audio.packs.length) void store.audio.load();
    store.audio.startBgm();
    // 直接刷新进房间时 store 里可能没有游戏列表，补拉一次：
    // 否则拿不到 variants/mode，单人对局会被当成房间对战（按钮显示"认输"、变体判断也错）
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    // 每秒驱动倒计时重渲染 + 单机分数快照刷新
    const ticker = setInterval(() => {
      local.setV('tick', Date.now());
      const logic: any = (gameManager.game as any)?.logic;
      if (logic && typeof logic.score === 'number') {
        local.setV('soloStats', {
          score: logic.score || 0,
          best: logic.best || 0,
          lines: logic.lines || 0,
          level: logic.level || 0,
        });
      }
    }, 1000);
    if (!socket) {
      console.log('此时没有 socket')
      return () => clearInterval(ticker);
    }
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange);
    socket.on(ReceiveEvent.PlayerAction, onPlayerAction);
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
      store.audio.stopBgm();
      gameManager.unload();
      store.room.clearClock();
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange);
      socket.off(ReceiveEvent.PlayerAction, onPlayerAction);
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
      // 提示语按场景给：单机游戏说"已退出游戏"，不要拿服务端的"房间已解散"吓用户
      notificationManager.show(resolveLeaveToast(exitIntent, message), 'success');
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
  /**
   * 结束本局（对局进行中时关闭按钮的语义）：
   * - 回合制（棋类）：认输 → 服务端结算 → 房间回到等待态，玩家留在房间界面
   * - 贪吃蛇组队：自我淘汰 → 对局继续，本局对玩家结束 → 退出沉浸视图回到房间
   */
  const handleEndGame = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.PlayerSurrender, {
      room_id: room_id,
      match_id: local.match_id,
      player_id: store.game.player_id,
    }, (success: boolean, message?: string) => {
      if (!success) {
        notificationManager.show(message || '结束本局失败', 'warning');
        return;
      }
      // 结束本局后退出沉浸对局，回到房间界面（组队对局仍在继续，可观战）
      local.setV('endedMatch', true);
      notificationManager.show('本局已结束，已回到房间', 'success');
      init(room_id);
    });
  };
  /** 关闭按钮的统一入口：按场景决定是"结束本局"还是"退出房间" */
  const handleExit = () => {
    if (exitIntent.endsMatch) {
      handleEndGame();
      return;
    }
    handleLeaveRoom();
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
    local.setV('soloOver', false)
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
  // 实时对局（团队模式贪吃蛇）：没有求和机制，认输 = 自我淘汰
  const isRealtimeGame = slug === 'snake' && roomVariant === 'team';
  // 无尽挑战竞技房：进房自动开局，死了自动重生，随时可以退出（不算逃跑）
  const isEndlessArena = slug === 'snake' && roomVariant === 'endless';
  // 官方无尽桌没有"开始游戏"：进房即开局
  const autoStarted = isEndlessArena && !!store.room.roomInfo?.official;
  const clock = store.room.clock;
  // 关闭按钮的语义按场景分化：单机=退出游戏 / 官方房=退出房间 / 组队对局中=结束游戏回房间
  const exitIntent = resolveExitIntent({
    isSoloGame,
    roomStatus: store.room.status || '',
    isEndlessArena,
    endedMatch: local.endedMatch,
  });
  // 解散按钮仅自建非官方房的房主显示；官方房/他人房间/临时房只能"退出"
  const isOwner = store.room.roomInfo?.owner_id === store.game.player_id;
  const canDisband = isOwner && !store.room.roomInfo?.official && !store.room.roomInfo?.transient;
  // 添加人机：仅多人对战、等待态、房主可见
  const canAddRobot = !isSoloGame && !isEndlessArena && store.room.status === RoomStatus.waiting && isOwner;
  // 设置弹框的房间配置：观战（等待态房主）+ 计时（象棋等待态）
  const settingsRoom = {
    room_id: room_id!,
    isOwner,
    official: !!store.room.roomInfo?.official,
    waiting: store.room.status === RoomStatus.waiting,
    allowSpectate: store.room.roomInfo?.allowSpectate !== false,
    isXiangqi,
    timeControl: { enabled: local.tcEnabled, stepLimitSec: local.tcStepSec, totalBudgetMin: local.tcTotalMin },
    onToggleSpectate: handleToggleSpectate,
    onSaveTimeControl: (tc: { enabled: boolean, stepLimitSec: number, totalBudgetMin: number }) => {
      local.setV('tcEnabled', tc.enabled);
      local.setV('tcStepSec', tc.stepLimitSec);
      local.setV('tcTotalMin', tc.totalBudgetMin);
      handleSaveTimeControl();
    },
  };
  // 贪吃蛇对局中切全屏沉浸：棋盘铺满视口，房间操作收进右上角悬浮按钮
  // 组队模式认输后（endedMatch）：退出沉浸，回到房间面板（对局继续，可观战）
  const immersive = slug === 'snake' && store.room.status === RoomStatus.playing && !local.endedMatch;

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
    <div className={`room-page${immersive ? ' immersive' : ''}${slug === '2048' ? ' game-2048' : ''}`}>
      {/* 非沉浸对局：与游戏主页同一套顶栏，返回回该游戏主页 */}
      {!immersive && (
        <GameHeader
          title={gameInfo?.title || slug || '对局'}
          subtitle={store.room.roomInfo?.name || variantInfo?.label || ''}
          mode="room"
          settingsRoom={settingsRoom}
          closeLabel={exitIntent.title}
          onBack={() => local.setV('showLeaveDialog', true)}
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
                  // 2048：本地 gameover 时立即切到「重新开始 / 退出游戏」，不等服务端把房间拨回 waiting
                  if (slug === '2048') {
                    logic?.on?.('gameover', () => local.setV('soloOver', true))
                    logic?.on?.('reset', () => local.setV('soloOver', false))
                  }
                  loadState({ game_slug: slug, match_id: local.match_id, })
                });
              }
            }}
          />
          {/* 棋盘中央的动作：2048 终局给「重新开始 / 退出游戏」，其余游戏仍是开始/重开 */}
          {!immersive && (
            <div className="board-center-actions">
              {slug === '2048' ? (
                local.soloOver && (
                  <div className="board-center-buttons">
                    <button className="board-center-btn" onClick={handleRestart}>↻ 重新开始</button>
                    <button className="board-center-btn secondary" onClick={handleLeaveRoom}>退出游戏</button>
                  </div>
                )
              ) : (
                <>
                  {store.room.status === RoomStatus.waiting && !autoStarted && isOwner
                    && store.room.players.length >= (isSoloGame ? 1 : 2) && (
                    <button className="board-center-btn" onClick={handleStartGame}>▶ 开始游戏</button>
                  )}
                  {store.room.status === RoomStatus.finished && (
                    <button className="board-center-btn" onClick={handleRestart}>↻ 重新开始</button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {immersive ? (
          /* 全屏对局：左上关闭、右上设置，顶部中间不放游戏名，也不占棋盘空间 */
          <div className="immersion-hud">
            <div className="hud-corner hud-top-left">
              <button
                className="hud-btn hud-close"
                title="关闭 / 退出"
                aria-label="关闭"
                onClick={() => local.setV('showLeaveDialog', true)}
              >×</button>
              <button
                className="hud-btn hud-panel-toggle"
                title="玩家与聊天"
                aria-label="玩家与聊天"
                onClick={() => local.setV('showPanel', !local.showPanel)}
              >☰</button>
            </div>
            <div className="hud-corner hud-bottom-right">
              {/* 设置放在加速按钮正上方：右上角整块让给排行榜，小地图挪到左上关闭键下方 */}
              <GameSettings className="hud-btn" room={settingsRoom} />
            </div>
            {local.showPanel && (
              <div className="hud-drawer">
                <PlayerList room_id={room_id!} showAddRobot={canAddRobot} onAddRobot={handleAddRobot} />
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

          {/* 观战/计时配置已收进右上角设置弹框（GameSettings） */}

          <div className="room-actions">
            {/* 添加人机已移到玩家列表标题右侧 */}
            {/*
              所有玩家（不含观战）进房即自动 prepared，无需手动准备/取消按钮。
              开局完全由房主点"开始游戏"控制（服务端已移除"全员准备自动开局"）。
              单人游戏一人即可开局，多人对战至少 2 人。
            */}
            {/* 开始游戏 / 重新开始已移到棋盘中央覆盖层 */}
            {/*
              等待/结束态：自建非官方房的房主显示"解散房间"，其余（官方房/他人房间/临时房）显示"退出"。
              对局进行中不允许离开（只能认输/求和），单人游戏除外——离开即销毁临时房。
            */}
            {/* 退出/解散统一由左上角返回按钮的确认弹框处理，不再单独放按钮 */}
            {store.room.status === RoomStatus.playing && !isEndlessArena && store.game.player?.member_type === 'player' && !isSoloGame && <Fragment>
              {!isRealtimeGame && <button onClick={handleRequestDraw}>求和</button>}
              <button onClick={requestSurrender} className="danger">认输</button>
            </Fragment>}
          </div>
          {isSoloGame ? (
            /* 2048 的分数与最高分已在 Canvas 顶部显示，页面不再重复放「本局数据」面板；俄罗斯方块仍保留 */
            slug === '2048' ? null : (
              <div className="solo-stats-panel">
                <div className="tc-title">📊 本局数据</div>
                <div className="solo-stat"><span>分数</span><strong>{local.soloStats.score}</strong></div>
                <div className="solo-stat"><span>最高</span><strong>{local.soloStats.best}</strong></div>
                {slug === 'tetris' && (
                  <>
                    <div className="solo-stat"><span>消行</span><strong>{local.soloStats.lines}</strong></div>
                    <div className="solo-stat"><span>等级</span><strong>{local.soloStats.level}</strong></div>
                  </>
                )}
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: '0.5rem' }}>
              <PlayerList room_id={room_id!} showAddRobot={canAddRobot} onAddRobot={handleAddRobot} />
              <Chat room_id={room_id!} />
            </div>
          )}
        </div>
        )}
      </div>
      </div>

      {/* 左上角关闭按钮的确认弹框。
          语义按场景分化（见 core/exitIntent.ts）：
          - 单人游戏 → "退出游戏"（临时房销毁，不弹"房间已解散"）
          - 官方房间 → "退出房间"（官方桌永不销毁）
          - 组队/对局中 → "结束游戏"，结束后回到房间界面 */}
      {local.showLeaveDialog && (
        <div className="leave-overlay" onMouseDown={() => local.setV('showLeaveDialog', false)}>
          <div className="leave-dialog" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={exitIntent.title}>
            <h3>{exitIntent.title}</h3>
            <p className="leave-hint">{exitIntent.hint}</p>
            <div className="leave-actions">
              <button onClick={() => local.setV('showLeaveDialog', false)}>取消</button>
              {canDisband && [RoomStatus.waiting, RoomStatus.finished].includes(store.room.status) && (
                <button className="danger" onClick={() => { local.setV('showLeaveDialog', false); handleDisband(); }}>解散房间</button>
              )}
              <button
                className={canDisband ? '' : 'danger'}
                onClick={() => { local.setV('showLeaveDialog', false); handleExit(); }}
              >{exitIntent.confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});