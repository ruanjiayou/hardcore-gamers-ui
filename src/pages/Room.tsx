import React, { useEffect, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable, useObserver } from 'mobx-react-lite';
import store from '../stores'
import { socketEvents, socketListeners } from '../services/socket';
import { PlayerList } from '../components/PlayerList';
import { Chat } from '../components/Chat';
import '../styles/index.css';
import '../styles/room.css';
import BabylonCanvas from "../core/BabylonCanvas";
import { gameManager } from "../core/GameManager";
import { runInAction } from 'mobx';
import { notificationManager } from '../components/Notifications'

export const RoomPage = observer(() => {
  const { room_id, gameId } = useParams<{ room_id: string, gameId: string; }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    inited: false,
    showAgreeDraw: false,
    loading: false,
    setInit() {
      local.inited = true
    }
  }));
  const init = (room_id: string) => {
    socketEvents.getRoomInfo(room_id, (data) => {
      store.room.setCurrentRoom(room_id, data)
      socketEvents.getGamePlayer(gameId as string, store.auth.user_id as string, (gamePlayer) => {
        store.game.setGamePlayer(gamePlayer);
        if (room_id !== gamePlayer.room_id) {
          socketEvents.joinRoom({ room_id, type: '', password: '' }, (success, error) => {
            console.log('join-room', success)
          })
        }
      })

    });
  }
  useEffect(() => {
    if (!store.auth.user_id || !room_id) {
      navigate('/lobby');
      return;
    }
    init(room_id)
    // 监听玩家加入
    socketListeners.onPlayerJoined((data) => {
      store.room.addPlayer(data);
      store.room.addMessage({ player_id: data._id, player_name: data.user_name, message: `玩家 ${data.user_name} 加入房间` })
      if (data.user_id === store.auth.user_id) {
        store.game.setGamePlayer(data)
      }
    });

    // 监听玩家离开
    socketListeners.onPlayerLeaved((data) => {
      store.room.removePlayer(data.player_id);
      store.game.setGamePlayer({ ...store.game.gamePlayer, room_id: '' })
      store.room.addMessage({ player_id: data.player_id, player_name: data.player_name, message: `玩家 ${data.player_name} 加入房间` })
    });

    // 监听网络状态
    socketListeners.onPlayerNetwork((data: { player_id: string, online: boolean }) => {
      store.room.setPlayerNetwork(data.player_id, data.online)
    })

    socketListeners.onPlayerActioin((data: any) => {
      console.log(data, '他人回合')
    })

    socketListeners.onPlayerSurrender((data: { player_id: string, player_name: string }) => {
      notificationManager.show(`玩家 ${data.player_name} 认输`)
      init(room_id);
    })

    socketListeners.onRoomReady((data: any) => {
      console.log(data, 'ready')
      store.room.setRoomStatus('ready');
    })

    // 监听消息
    socketListeners.onMessage((message) => {
      store.room.addMessage(message);
    });

    // 监听游戏开始
    socketListeners.onGameStarted((data) => {
      console.log('started', data)
      store.room.setRoomStatus('playing')
    });

    socketListeners.onSeekDraw((data: any) => {
      if (data.user_id !== store.auth.user_id) {
        runInAction(() => {
          local.showAgreeDraw = true;
        })
      }
    })
    return () => {
      gameManager.unload();
    };
  }, [room_id, navigate]);

  const handleLeaveRoom = () => {
    if (!room_id) return;
    socketEvents.leaveRoom({ room_id, player_id: store.game.gamePlayer._id }, (success) => {
      console.log('离开房间', success)
      store.room.clear();
      store.game.setGamePlayer({ ...store.game.gamePlayer, room_id: '' })
      navigate(-1);
    });
  };

  const handleStartGame = () => {
    if (!room_id) return;
    socketEvents.startGame({ room_id, player_id: store.game.gamePlayer._id }, (match_id, error?: string) => {
      if (match_id) {
        store.room.setCurrentMatchId(match_id);
        socketEvents.getMatchState({ room_id, player_id: store.game.gamePlayer._id, match_id: '' }, state => {
          gameManager.setState(state);
        })
      }
      if (error) {
        notificationManager.show(error, 'error');
      }
    });
  };

  const handlePlayerRead = (ready: boolean) => {
    socketEvents.playerReadyChange({ room_id: room_id as string, player_id: store.game.gamePlayer._id, ready }, (success) => {
      if (success) {
        store.game.setGamePlayer({ ...store.game.gamePlayer, state: 'ready' })
      }
    })
  }
  const handleSurrender = () => {
    if (!room_id) return;
    socketEvents.surrender({ room_id, match_id: store.room.currentMatchId, player_id: store.game.gamePlayer._id }, (success) => {
      console.log(success, '认输')
    });
  }
  const handleSeekDraw = () => {
    if (!room_id) return;
    socketEvents.seekdraw(room_id);
  }
  const handleAgreeDraw = (agress: boolean) => {
    if (!room_id) return;
    socketEvents.agreeDraw(room_id, agress);

  }
  const handlePlayerAction = (data: any) => {
    socketEvents.recordAction(room_id as string, data, success => {
      console.log('己方回合', success)
    })
  }
  return (
    <div className="room-page">
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%', gap: 15 }}>
        <div style={{ flex: 1 }}>
          <BabylonCanvas
            onReady={(canvas: HTMLCanvasElement) => {
              if (gameId && store.auth.user_id && !local.inited) {
                gameManager.load('ChinaChess', canvas);
              }
              local.inited = true
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 15 }}>
          <div className="room-actions">
            {(store.room.roomInfo?.owner_id === store.auth.user_id)
              ? (
                <Fragment>
                  {store.room.roomInfo?.status === 'waiting' && <button >等待</button>}
                  {store.room.roomInfo?.status === 'ready' && <button onClick={handleStartGame}>开始游戏</button>}
                </Fragment>
              ) : (
                <Fragment>
                  {store.room.roomInfo?.status !== 'playing' && store.game.gamePlayer?.state === 'idle' && <button onClick={() => handlePlayerRead(true)}>准备</button>}
                  {store.room.roomInfo?.status !== 'playing' && store.game.gamePlayer?.state === 'ready' && <button onClick={() => handlePlayerRead(false)}>取消</button>}
                </Fragment>
              )}
            {store.room.roomInfo?.status === 'waiting' && <button onClick={handleLeaveRoom} className="danger">离开房间</button>}
            {store.room.roomInfo?.status === 'playing' && <Fragment>
              <button onClick={handleSeekDraw}>求和</button>
              <button onClick={handleSurrender} className="danger">认输</button>
            </Fragment>}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 15 }}>
            <PlayerList />
            <Chat room_id={room_id!} />
          </div>
        </div>
      </div>
    </div>
  );
});