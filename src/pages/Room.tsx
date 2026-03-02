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

export const RoomPage = observer(() => {
  const { roomId, gameId } = useParams<{ roomId: string, gameId: string; }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    showAgreeDraw: false,
    loading: false,
  }));
  useEffect(() => {
    if (!store.auth.user_id || !roomId) {
      navigate('/lobby');
      return;
    }
    if (!store.room.currentRoomId) {

      socketEvents.getRoomInfo(roomId, (data) => {
        store.room.setCurrentRoom(roomId, data)
        socketEvents.getGamePlayer(gameId as string, store.auth.user_id as string, (gamePlayer) => {
          console.log(gamePlayer, 'game player?')
          store.game.setGamePlayer(gamePlayer);
          if (!gamePlayer.room_id) {
            socketEvents.joinRoom(roomId, '', (success, error) => {
              console.log('join-room', success)
            })
          }
        })

      });
    }
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
      store.room.addMessage({ player_id: data.player_id, player_name: data.player_name, message: `玩家 ${data.player_name} 加入房间` })
    });

    // 监听网络状态
    socketListeners.onPlayerNetwork((data: { player_id: string, online: boolean }) => {
      store.room.setPlayerNetwork(data.player_id, data.online)
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
    socketListeners.onGameStarted(() => {
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
  }, [roomId, navigate]);

  const handleLeaveRoom = () => {
    if (!roomId) return;
    socketEvents.leaveRoom(roomId, (success) => {
      console.log('离开房间', success)
      store.room.clear();
      navigate(-1);
    });
  };

  const handleStartGame = () => {
    if (!roomId) return;
    socketEvents.startGame({ roomId, player_id: store.game.gamePlayer._id }, (success) => {
      console.log(success, 'start game')
    });
  };

  const handlePlayerRead = (ready: boolean) => {
    socketEvents.playerReadyChange({ roomId: roomId as string, player_id: store.game.gamePlayer._id, ready }, (success) => {
      if (success) {
        store.game.setGamePlayer({ ...store.game.gamePlayer, state: 'ready' })
      }
    })
  }
  const handleSurrender = () => {
    if (!roomId) return;
    socketEvents.surrender({ roomId, player_id: store.game.gamePlayer._id }, (success) => {
      console.log(success, 'start game')
    });
  }
  const handleSeekDraw = () => {
    if (!roomId) return;
    socketEvents.seekdraw(roomId);
  }
  const handleAgreeDraw = (agress: boolean) => {
    if (!roomId) return;
    socketEvents.agreeDraw(roomId, agress);

  }
  return (
    <div className="room-page">
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%', gap: 15 }}>
        <div style={{ flex: 1 }}>
          <BabylonCanvas
            onReady={(canvas: HTMLCanvasElement) => {
              if (gameId) {
                // gameManager.load('ChinaChess', canvas, store.room.roomInfo?.state);
              }
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
            <Chat roomId={roomId!} />
          </div>
        </div>
      </div>
    </div>
  );
});