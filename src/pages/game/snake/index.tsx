import React, { useEffect, useState } from 'react';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx';
import store from '../../../stores';
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents, syncRoomScore } from '../../../services/socket';
import { getManifest, subscribeAssets, loadGameAssets } from '../../../services/assets';
import { Leaderboard } from '../../../components/Leaderboard';
import { LoginRequiredPanel } from '../../../components/LoginRequired';
import { GameHeader } from '../../../components/GameHeader';
import { GameSettings } from '../../../components/GameSettings';
import { notificationManager } from '../../../components/Notifications';
import { arenaRoomUrl, gameUrl, go, lobbyUrl, markArenaEntry } from '../../../navigation';
import '../../../styles/index.css';
import '../../../styles/game.css';
import './styles/index.css';

const slug = 'snake' as const;

/** 本游戏主页：当前皮肤 + 玩法按钮 + 排队提示；不展示官方房间列表。 */
export const GamePage = observer(() => {
  const local = useLocalObservable(() => ({
    name: '',
    show: false,
    allowSpectate: true,
    starting: false,
    matching: false,
    // waiting=true 表示人已在服务端队列里
    waiting: false,
    queueSize: 0,
    showBoard: false,
    // 资源清单异步到达后触发一次重渲染，让「当前皮肤」立刻刷新
    skinTick: 0,
    setV(o: object) {
      for (const k in o) {
        // @ts-ignore
        local[k] = (o as any)[k];
      }
    },
  }));

  const game = store.game.games.find(g => g.slug === slug);
  const variants = game?.variants || [];
  const [activeVariant, setActiveVariant] = useState<string>('');
  useEffect(() => {
    setActiveVariant(prev => (prev && variants.some(v => v.key === prev) ? prev : (variants[0]?.key || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants.length]);

  const variantInfo = variants.find(v => v.key === activeVariant);
  const isBusyMode = local.matching || local.starting;
  const isEndlessVariant = (activeVariant || variants[0]?.key) === 'endless';

  /** 匹配：找到空位直接进房；全部满员则进入服务端等待队列。 */
  const handleMatch = (variantKey?: string) => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能匹配');
      return;
    }
    if (local.matching) return;
    local.setV({ matching: true });
    const key = variantKey ?? variantInfo?.key;
    const arenaMatch = (variants.find(v => v.key === key) as any)?.arena === true || key === 'endless';
    socketEvents.match(slug, key, (success, player, message) => {
      local.setV({ matching: false });
      if (success && player?.waiting) {
        local.setV({ waiting: true, queueSize: player.queue_size || 1 });
        return;
      }
      const roomId = player?.room_id;
      if (success && roomId) {
        // UI-100：竞技场匹配直达全屏 canvas，房间页首帧消费此标记跳过房间壳
        if (arenaMatch) markArenaEntry(roomId);
        // UI-112：arena=1 随 URL 保留，刷新后仍是全屏 canvas 对战页
        go(arenaMatch ? arenaRoomUrl(slug, roomId) : gameUrl(slug, '/room/' + roomId));
      } else {
        alert(message || '匹配失败，请重试');
      }
    });
  };

  /** 取消排队 */
  const handleCancelMatch = () => {
    socketEvents.cancelMatch(success => {
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
      name: local.name || `${store.auth.displayName || '玩家'} 的${variants.find(v => v.key === (variantKey ?? variantInfo?.key))?.label || '游戏'}房间`,
      allowSpectate: local.allowSpectate,
      variant: variantKey ?? variantInfo?.key,
    }, (success: boolean, room_id: string, error?: string) => {
      if (success && room_id) {
        go(gameUrl(slug, '/room/' + room_id));
        local.setV({ show: false });
      } else {
        alert(error || '创建房间失败');
      }
    });
  };

  /** 玩法按钮：竞技场玩法直接匹配，团队玩法直接建房。 */
  const handleVariant = (v: any) => {
    if (isBusyMode || local.waiting) return;
    if ((activeVariant || variants[0]?.key) !== v.key) setActiveVariant(v.key);
    if (v.arena || v.key === 'endless') handleMatch(v.key);
    else handleCreateRoom(v.key);
  };

  const onPlayerChange = (data: { player_id: string, field: string, value: any }) => {
    store.game.changePlayer(data);
    store.room.changePlayer(data);
  };
  // 本页不展示房间列表，保留订阅以维持原有的事件联动
  const onRoomEvent = () => {};
  const socket = getSocket();

  useEffect(() => {
    if (!socket) return;
    // 进入主页就切到本游戏的专属音效配置（房间页会幂等再设一次）
    store.audio.setGame(slug);
    loadGameAssets(slug).then(() => local.setV({ skinTick: local.skinTick + 1 }));
    // UI-111：设置弹框/皮肤页换装后，主页当前皮肤预览立即跟着换
    const unsubscribeSkin = subscribeAssets(slug, () => local.setV({ skinTick: local.skinTick + 1 }));
    // 直接打开/刷新主页时 store 里可能还没有游戏列表，自己拉一次
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    // 从房间主动点了返回：本次不要自动回房
    const skipResume = sessionStorage.getItem('lobby:skipRoomResume') === '1';
    if (skipResume) sessionStorage.removeItem('lobby:skipRoomResume');
    if (store.auth.isLoggedIn) {
      socketEvents.getGamePlayer(slug, player => {
        if (!player) return;
        store.game.setPlayer(player);
        // 回房前确认房间还在，避免脏指针造成来回弹窗
        const roomId = player?.room_id;
        if (roomId && !skipResume) {
          socketEvents.getRoomDetail(roomId, (detail: any) => {
            if (detail?.room) {
              go(gameUrl(slug, '/room/' + roomId));
            } else {
              store.game.setPlayer({ ...toJS(player), room_id: '', state: 'online' });
            }
          });
        }
      });
    }
    socket.on(ReceiveEvent.RoomCreated, onRoomEvent);
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange);
    socket.on(ReceiveEvent.PlayerJoined, onRoomEvent);
    socket.on(ReceiveEvent.PlayerLeaved, onRoomEvent);
    return () => {
      unsubscribeSkin();
      socket.off(ReceiveEvent.RoomCreated, onRoomEvent);
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange);
      socket.off(ReceiveEvent.PlayerJoined, onRoomEvent);
      socket.off(ReceiveEvent.PlayerLeaved, onRoomEvent);
    };
  }, [slug]);

  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入游戏、创建房间或上榜" />;
  }

  void local.skinTick; // manifest 到达后重新计算当前皮肤
  const currentSkin = (() => {
    const m = getManifest(slug);
    const id = m?.equipped || '';
    const item = m?.skins?.find(s => s.id === id);
    // 清单还没到位时不写默认外观字样——期待的是进度页加载好的当前皮肤
    return { url: item?.url || '', label: item?.label || '外观加载中…' };
  })();

  return (
    <div className="game-page">
      <GameHeader
        title={game?.title || slug}
        subtitle={variantInfo?.label || '房间对战'}
        mode="game"
        profileGame={slug}
        center={
          <>
            <button className="game-header-center-btn" onClick={() => notificationManager.show('商店即将开放', 'warning')}>
              <span className="game-header-center-icon" aria-hidden>🛒</span><span>商店</span>
            </button>
            <button className="game-header-center-btn" onClick={() => local.setV({ showBoard: true })}>
              <span className="game-header-center-icon" aria-hidden>🏆</span><span>排行榜</span>
            </button>
          </>
        }
        extra={
          <>
            <button
              className="game-header-icon-btn"
              title="好友"
              aria-label="好友"
              onClick={() => go(gameUrl(slug, '/friends'))}
            >
              <span aria-hidden="true">👥</span>
            </button>
            <GameSettings game={slug} />
          </>
        }
        onBack={() => {
          syncRoomScore();
          go(lobbyUrl());
        }}
      />
      <div className="game-body">
        <div className="game-container snake-home">
          {/* 当前皮肤：取已装备那件的图，没图回退 emoji */}
          <div className="current-skin">
            <div className="current-skin-preview">
              {currentSkin.url ? <img src={currentSkin.url} alt={currentSkin.label} /> : <span aria-hidden>🐍</span>}
              <button
                className="current-skin-refresh"
                onClick={() => go(gameUrl(slug, '/skins'))}
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

          {variants.length > 0 && (
            <div className="mode-buttons">
              {variants.map(v => (
                <button
                  key={v.key}
                  className={`mode-btn`}
                  disabled={isBusyMode}
                  onClick={() => handleVariant(v)}
                >
                  <span className="mode-label">{v.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* 排队状态与玩法提示 */}
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

          {local.show && (
            <div className="modal">
              <div className="modal-content">
                <h3>创建房间</h3>
                <input
                  type="text"
                  placeholder="房间名称"
                  value={local.name}
                  onChange={e => local.setV({ name: e.target.value })}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={local.allowSpectate}
                    onChange={e => local.setV({ allowSpectate: e.target.checked })}
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

      {local.showBoard && (
        <div className="modal" onMouseDown={() => local.setV({ showBoard: false })}>
          <div className="modal-content board-modal" onMouseDown={e => e.stopPropagation()}>
            <button className="settings-close" onClick={() => local.setV({ showBoard: false })} aria-label="关闭">×</button>
            <Leaderboard slug={slug} limit={10} boards={game?.boards} />
          </div>
        </div>
      )}
    </div>
  );
});

export default GamePage;
