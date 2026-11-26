import React, { useEffect, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx'
import store from '../../src/stores'
import { ReceiveEvent, SendoutEvent, getSocket, socketEvents, syncRoomScore } from '../../src/services/socket';
import { loadGameAssets } from '../../src/services/assets';
import '../../src/styles/index.css';
import '../../src/styles/room.css';
import './styles/play.css';
import GameCanvas from "../../src/core/GameCanvas";
import { gameManager } from "../../src/core/GameManager";
import { resolveExitIntent, resolveLeaveToast } from '../../src/core/exitIntent';
import { notificationManager } from '../../src/components/Notifications'
import { GameHeader } from '../../src/components/GameHeader';
import { LoginRequiredPanel } from '../../src/components/LoginRequired'
import { RoomStatus } from '../../src/constant'
import { gameUrl, go, lobbyUrl } from '../../src/navigation';

const slug = '2048' as const;

// 落子音节流：同一帧多个动作只播一次，避免批量快照把音效叠成噪音
let lastMoveSfxAt = 0;

const RoomPage = observer(() => {
  const { room_id } = useParams<{ room_id: string; }>();
  const local = useLocalObservable(() => ({
    showLeaveDialog: false,
    loading: false,
    match_id: '',
    tick: 0, // 每秒自增，驱动倒计时重渲染
    // 终局标记：服务端 gameover 会把房间拨回 waiting，靠它区分"结束"和"等待开局"
    soloOver: false,
    // 本局已结束：退出对局视图
    endedMatch: false,
    setV(key: 'showLeaveDialog' | 'match_id' | 'loading' | 'tick' | 'soloOver' | 'endedMatch', v: any) {
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
    socketEvents.getGamePlayer(slug, (player) => {
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
        go(gameUrl(slug));
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
      // 单人游戏：展示本局得分，而非胜负
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
  const onRoomDisband = () => {
    notificationManager.show('房间已解散', 'warning');
    store.room.clear();
    store.game.setPlayer({ ...store.game.player, room_id: '' });
    // 固定回游戏主页：用 history 回退可能回到已解散的房间地址
    go(gameUrl(slug));
  }
  useEffect(() => {
    if (!room_id) {
      go(lobbyUrl());
      return;
    }
    // 未登录：不订阅房间事件，只渲染登录提示
    if (!store.auth.isLoggedIn) {
      return;
    }
    init(room_id)
    // 进入对局页加载语音包配置并切到该游戏的专属音效，再起 BGM（自动播放被拦时等首次手势恢复）
    store.audio.setGame(slug);
    // 直接刷新进房间时也要预加载皮肤图（正常路径是在游戏主页加载过，这里幂等）
    loadGameAssets(slug);
    if (!store.audio.packs.length) void store.audio.load();
    store.audio.startBgm();
    // 直接刷新进房间时 store 里可能没有游戏列表，补拉一次：
    // 否则拿不到 variants/mode，单人对局会被当成房间对战（按钮显示"认输"、变体判断也错）
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    // 每秒驱动倒计时重渲染
    const ticker = setInterval(() => {
      local.setV('tick', Date.now());
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
    socket.on(ReceiveEvent.RoomMessage, onRoomMessage);
    socket.on(ReceiveEvent.RoomReady, onRoomReady);
    socket.on(ReceiveEvent.SettingsUpdated, onSettingsUpdated);
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
      socket.off(ReceiveEvent.RoomMessage, onRoomMessage);
      socket.off(ReceiveEvent.RoomReady, onRoomReady);
      socket.off(ReceiveEvent.SettingsUpdated, onSettingsUpdated);
      socket.off(ReceiveEvent.RoomDisband, onRoomDisband);
    };
  }, [room_id]);
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
    go(gameUrl(slug));
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
    go(gameUrl(slug));
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
      socketEvents.quickStart(slug, roomVariant, (success, data: any, message?: string) => {
        if (success && data?.room_id) {
          go(gameUrl(slug, `/room/${data.room_id}`));
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
  const gameInfo = store.game.games.find(g => g.slug === slug);
  // 玩法变体：贪吃蛇同一 slug 下有无尽/多人两种房间，房间设置里记录 variant。
  // 旧房间/异常数据没有 variant 时兜底：混合玩法游戏的非临时房一律按房间变体处理。
  const roomVariant = (store.room.roomInfo?.settings?.variant as string | undefined)
    || (gameInfo?.variants?.length
      ? (store.room.roomInfo?.transient
        ? gameInfo.variants.find(v => v.mode === 'solo')?.key
        : gameInfo.variants.find(v => v.mode === 'room')?.key)
      : undefined);
  // 单人玩法（无对手）：一人即可开局，不提供机器人/认输。
  // 优先看房间 variant（混合玩法游戏），否则按游戏 mode / 人数兜底。
  const variantInfo = gameInfo?.variants?.find(v => v.key === roomVariant);
  const isSoloGame = true;
  // 常驻竞技场（贪吃蛇无尽）：进房自动开局，死了自动重生，随时可以退出（不算逃跑）。
  // 判定看房间自己的 settings.arena 标记（建桌时按玩法属性写入），不写死玩法名。
  const isEndlessArena = store.room.roomInfo?.settings?.arena === true;
  // 官方无尽桌没有"开始游戏"：进房即开局
  const autoStarted = isEndlessArena && !!store.room.roomInfo?.official;
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
  // 邀请好友：只在**房间**（等待/未开局）能邀请，对弈中不能再拉人（UI-055）
  const canInvite = !isSoloGame && !store.room.roomInfo?.transient && !!room_id
    && !!store.room.roomInfo?._id
    && store.room.status !== RoomStatus.playing;
  // 设置弹框的房间配置：观战（等待态房主）+ 计时（象棋等待态）
  // 未登录：直接打开房间地址也只显示登录提示
  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入房间对局" />;
  }
  return (
    <div className="room-page game-2048">
      <GameHeader
        title={gameInfo?.title || slug}
        subtitle={store.room.roomInfo?.name || variantInfo?.label || ''}
        mode="room"
        closeLabel={exitIntent.title}
        onBack={() => local.setV('showLeaveDialog', true)}
      />

      <div className='room-stage'>
        <div className='room-container'>
          <div className='game-main'>
          <>
              <GameCanvas
                // 必须等到「本房间」详情回来再加载游戏：roomInfo 初始是空壳，
                // 提前加载会拿不到 settings.variant（会先按多人初始化再切换）
                ready={!!(store.game.player && store.room.roomInfo?._id === room_id)}
                onReady={(canvas: HTMLCanvasElement) => {
                  const socket = getSocket()
                  if (socket) {
                    gameManager.load(slug, canvas, socket, toJS(store.game.player), {
                      variant: roomVariant,
                      room: toJS(store.room.roomInfo),
                    }).then(() => {
                      console.log('game loaded')
                      // 死亡弹框的「退出」：交给房间页走正常离房流程
                      const logic: any = gameManager.game?.logic
                      logic?.on?.('exit', () => handleLeaveRoom())
                      // 本地 gameover 时立即切到「重新开始 / 退出游戏」，不等服务端把房间拨回 waiting
                      logic?.on?.('gameover', () => local.setV('soloOver', true))
                      logic?.on?.('reset', () => local.setV('soloOver', false))
                      loadState({ game_slug: slug, match_id: local.match_id, })
                    });
                  }
                }}
              />
              <div className="board-center-actions">
                {local.soloOver && (
                  <div className="board-center-buttons">
                    <button className="board-center-btn" onClick={handleRestart}>↻ 重新开始</button>
                    <button className="board-center-btn secondary" onClick={handleLeaveRoom}>退出游戏</button>
                  </div>
                )}
              </div>
          </>
          </div>
        <div className='game-info'>
          <div className="room-actions">
            {/* 添加人机已移到玩家列表标题右侧 */}
            {/*
              所有玩家（不含观战）进房即自动 prepared，无需手动准备/取消按钮。
              开局完全由房主点"开始游戏"控制（服务端已移除"全员准备自动开局"）。
              单人游戏一人即可开局，多人对战至少 2 人。
            */}
            {/* 邀请好友已移到顶栏右上角下拉（UI-072）；开始游戏在等待区/棋盘中央 */}
            {/* 开始游戏 / 重新开始已移到棋盘中央覆盖层 */}
            {/*
              等待/结束态：自建非官方房的房主显示"解散房间"，其余（官方房/他人房间/临时房）显示"退出"。
              对局进行中不允许离开（只能认输），单人游戏除外——离开即销毁临时房。
            */}
            {/* 退出/解散统一由左上角返回按钮的确认弹框处理，不再单独放按钮 */}
            {store.room.status === RoomStatus.playing && !isEndlessArena && store.game.player?.member_type === 'player' && !isSoloGame && <Fragment>
              <button onClick={requestSurrender} className="danger">认输</button>
            </Fragment>}
          </div>
        </div>
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

export default RoomPage;
