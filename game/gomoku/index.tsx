import React, { useEffect, useState } from 'react';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx';
import store from '../../src/stores';
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents, syncRoomScore } from '../../src/services/socket';
import { loadGameAssets } from '../../src/services/assets';
import { Leaderboard } from '../../src/components/Leaderboard';
import { LoginRequiredPanel } from '../../src/components/LoginRequired';
import { GameHeader } from '../../src/components/GameHeader';
import { GameSettings } from '../../src/components/GameSettings';
import { gameUrl, go, lobbyUrl } from '../../src/navigation';
import '../../src/styles/index.css';
import '../../src/styles/game.css';

const slug = 'gomoku' as const;

/** 房间制游戏主页：匹配 / 建房 / 官方房列表 / 变体选择。 */
export const GamePage = observer(() => {
  const local = useLocalObservable(() => ({
    type: 'create',
    name: '',
    show: false,
    allowSpectate: true,
    starting: false,
    matching: false,
    showBoard: false,
    rooms: [] as any[],
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
  const isSolo = variantInfo
    ? variantInfo.mode === 'solo'
    : (game?.mode ?? ((game?.numbers?.max ?? 2) <= 1 ? 'solo' : 'room')) === 'solo';

  /** 单人玩法：一键开一局 */
  const handleQuickStart = () => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能开始游戏');
      return;
    }
    if (local.starting) return;
    local.setV({ starting: true });
    socketEvents.quickStart(slug, variantInfo?.key, (success, data, message) => {
      local.setV({ starting: false });
      if (success && data?.room_id) {
        go(gameUrl(slug, '/room/' + data.room_id));
      } else {
        alert(message || '开始游戏失败');
      }
    });
  };

  /** 匹配：在官方桌里找空位，找到就直接进房 */
  const handleMatch = (variantKey?: string) => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能匹配');
      return;
    }
    if (local.matching) return;
    local.setV({ matching: true });
    socketEvents.match(slug, variantKey ?? variantInfo?.key, (success, player, message) => {
      local.setV({ matching: false });
      const roomId = player?.room_id;
      if (success && roomId) {
        go(gameUrl(slug, '/room/' + roomId));
      } else {
        alert(message || '匹配失败，请重试');
      }
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

  const handleVariant = (v: any) => {
    setActiveVariant(v.key);
  };

  const onPlayerChange = (data: { player_id: string, field: string, value: any }) => {
    store.game.changePlayer(data);
    store.room.changePlayer(data);
  };
  const onRoomCreated = () => {};
  const socket = getSocket();

  /** 只展示官方桌，私有房/临时房不对外显示 */
  const loadOfficialRooms = () => {
    if (!game?._id || !socket) return;
    socketEvents.getRooms(game._id, rooms => {
      local.setV({ rooms: (rooms || []).filter(r => r.official === true) });
    });
  };

  useEffect(() => {
    if (!socket) return;
    store.audio.setGame(slug);
    loadGameAssets(slug);
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    const skipResume = sessionStorage.getItem('lobby:skipRoomResume') === '1';
    if (skipResume) sessionStorage.removeItem('lobby:skipRoomResume');
    if (store.auth.isLoggedIn) {
      socketEvents.getGamePlayer(slug, player => {
        if (!player) return;
        store.game.setPlayer(player);
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
    if (!isSolo) loadOfficialRooms();
    socket.on(ReceiveEvent.RoomCreated, onRoomCreated);
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange);
    socket.on(ReceiveEvent.PlayerJoined, loadOfficialRooms);
    socket.on(ReceiveEvent.PlayerLeaved, loadOfficialRooms);
    return () => {
      socket.off(ReceiveEvent.RoomCreated, onRoomCreated);
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange);
      socket.off(ReceiveEvent.PlayerJoined, loadOfficialRooms);
      socket.off(ReceiveEvent.PlayerLeaved, loadOfficialRooms);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入游戏、创建房间或上榜" />;
  }

  return (
    <div className="game-page">
      <GameHeader
        title={game?.title || slug}
        subtitle={isSolo ? '单人挑战' : (variantInfo?.label || '房间对战')}
        mode="game"
        profileGame={slug}
        center={
          <button className="game-header-center-btn" onClick={() => local.setV({ showBoard: true })}>
            <span className="game-header-center-icon" aria-hidden>🏆</span><span>排行榜</span>
          </button>
        }
        extra={
          <>
            {!isSolo && (
              <button
                className="game-header-icon-btn"
                title="好友"
                aria-label="好友"
                onClick={() => go(gameUrl(slug, '/friends'))}
              >
                <span aria-hidden="true">👥</span>
              </button>
            )}
            <GameSettings game={slug} />
          </>
        }
        onBack={() => {
          syncRoomScore();
          go(lobbyUrl());
        }}
      />
      <div className="game-body">
        <div className="game-container">
          {variants.length > 0 && (
            <div className="mode-buttons">
              {variants.map(v => (
                <button
                  key={v.key}
                  className={`mode-btn${(activeVariant || variants[0]?.key) === v.key ? ' active' : ''}`}
                  onClick={() => handleVariant(v)}
                >
                  <span className="mode-label">{v.label}</span>
                </button>
              ))}
            </div>
          )}

          {!isSolo && (
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

          {!isSolo && local.rooms.length > 0 && (
            <div className="room-list">
              <div className="room-list-header">
                <h3>🏛️ 官方房间</h3>
              </div>
              <div className="room-cells">
                {local.rooms.map((room: any) => {
                  const playing = room.status === 'playing';
                  const full = (room.members?.length || 0) >= (room.numbers?.max || 2);
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
                            go(gameUrl(slug, '/room/' + room._id));
                            return;
                          }
                          if (!store.auth.isLoggedIn) {
                            store.ui.openLoginPrompt('登录后才能加入房间');
                            return;
                          }
                          socketEvents.joinRoom({ room_id: room._id }, success => {
                            if (success) go(gameUrl(slug, '/room/' + room._id));
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

          {isSolo && (
            <div className="solo-start">
              <button className="solo-start-btn" disabled={local.starting} onClick={handleQuickStart}>
                {local.starting ? '正在开局…' : `▶ 开始${variantInfo?.label || '游戏'}`}
              </button>
              <p className="solo-hint">单人模式，无需房间，成绩实时计入排行榜</p>
            </div>
          )}

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
