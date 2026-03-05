import React, { useEffect, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable, useObserver } from 'mobx-react-lite';
import { toJS } from 'mobx'
import store from '../stores'
import { getSocket, socketEvents, socketListeners } from '../services/socket';
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
    game_inited: false,
    showAgreeDraw: false,
    match_id: '',
    setV(key: 'match_id' | 'game_inited', v: any) {
      if (key === 'match_id') {
        local.match_id = v;
      }
      if (key === 'game_inited') {
        local.game_inited = v;
      }
    }
  }));
  const init = (room_id: string) => {
    socketEvents.getRoomDetail(room_id, (data) => {
      const { room, match_id } = data;
      store.room.setCurrentRoom(room)
      if (!store.game.gamePlayer) {
        socketEvents.getGamePlayer(room.gameId, store.auth.user?._id as string, (player) => {
          store.game.setGamePlayer(player);
          if (match_id) {
            local.setV('match_id', match_id)
          }
        })
      } else if (match_id) {
        local.setV('match_id', match_id)
      }
    });
  }
  useEffect(() => {
    if (!room_id) {
      navigate('/lobby');
      return;
    }
    init(room_id)
    // 监听玩家加入
    socketListeners.onPlayerJoined((data) => {
      store.room.addPlayer(data);
      store.room.addMessage({ player_id: data._id, player_name: data.user_name, message: `玩家 ${data.user_name} 加入房间` })
    });

    // 监听玩家离开
    socketListeners.onPlayerLeaved((data) => {
      store.room.removePlayer(data._id);
      store.room.addMessage({ player_id: data._id, player_name: data.user_name, message: `玩家 ${data.user_name} 离开房间` })
    });

    // 监听网络状态
    socketListeners.onPlayerNetwork((data: { player_id: string, online: boolean }) => {
      store.room.setPlayerNetwork(data.player_id, data.online)
    })

    // socketListeners.onPlayerActioin((data: any) => {
    //   console.log(data, '他人回合')
    // })

    socketListeners.onGameOver((data: { _id: string, user_name: string }) => {
      notificationManager.show(`玩家 ${data.user_name} 胜利`)
      store.game.setGamePlayer(null)
      gameManager.unload()
      local.setV('game_inited', false)
      local.setV('match_id', '')
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
      store.room.setRoomStatus('playing')
      local.setV('match_id', data.match_id)
    });

    socketListeners.onSeekDraw((data: any) => {
      if (data.user_id !== store.auth.user?._id) {
        runInAction(() => {
          local.showAgreeDraw = true;
        })
      }
    })
    return () => {
      gameManager.unload();
    };
  }, [room_id, navigate]);

  useEffect(() => {
    if (local.match_id && local.game_inited && gameManager.game) {
      socketEvents.getMatchState({ room_id: store.room.currentRoomId, match_id: local.match_id }, (state) => {
        gameManager.game?.logic.setState(state)
      })
    }
  }, [local.match_id, local.game_inited])
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
    socketEvents.startGame({ room_id, player_id: store.game.gamePlayer._id }, (success) => {
      if (!success) {
        notificationManager.show('启动失败', 'error')
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
    socketEvents.surrender({ room_id: store.room.currentRoomId, player_id: store.game.gamePlayer._id }, (success) => {
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
      <div className='room-container'>
        <div className='game-main'>
          {local.match_id && <BabylonCanvas
            onReady={(canvas: HTMLCanvasElement) => {
              const socket = getSocket()
              if (gameId && socket) {
                gameManager.load('ChinaChess', canvas, socket, toJS(store.game.gamePlayer)).then((game) => {
                  local.setV('game_inited', true)
                });
              }
            }}
          />}
        </div>
        <div className='game-info'>
          <div className="room-actions">
            {(store.room.roomInfo?.owner_id === store.auth.user?._id)
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