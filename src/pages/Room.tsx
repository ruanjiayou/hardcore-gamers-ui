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
  const { slug, room_id } = useParams<{ slug: string, room_id: string; }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    showAgreeDraw: false,
    match_id: '',
    setV(key: 'showAgreeDraw' | 'match_id', v: any) {
      if (key === 'showAgreeDraw') {
        local.showAgreeDraw = v;
      } else if (key === 'match_id') {
        local.match_id = v;
      }
    }
  }));
  const init = (room_id: string) => {
    socketEvents.getRoomDetail(room_id, (data) => {
      const { room } = data;
      store.room.setCurrentRoom(room)
      local.setV('match_id', data.match_id)
      console.log('加载玩家信息后加载游戏')
      socketEvents.getGamePlayer(room.game_id, (player) => {
        if (!store.game.gamePlayer && player.room_id) {
          joinRoom(player.room_id, '')
        }
        store.game.setGamePlayer(player);
      })
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
      store.room.addMessage({ player_id: data._id, player_name: "系统", message: `玩家 ${data.nick_name} 加入房间` })
      init(room_id)
    });

    // 监听玩家离开
    socketListeners.onPlayerLeaved((data) => {
      store.room.removePlayer(data._id);
      store.room.addMessage({ player_id: data._id, player_name: '系统', message: `玩家 ${data.nick_name} 离开房间` })
      init(room_id)
    });

    // 监听网络状态
    socketListeners.onPlayerNetwork((data: { player_id: string, online: boolean }) => {
      store.room.setPlayerNetwork(data.player_id, data.online)
    })

    socketListeners.onGameOver((data: { _id: string, nick_name: string }) => {
      notificationManager.show(`玩家 ${data.nick_name} 胜利`)
      store.room.setRoomStatus('waiting')
      store.game.setGamePlayer({ ...store.game.gamePlayer, state: 'idle' })
      loadState({ game_id: store.room.roomInfo.game_id, match_id: '', })
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
      loadState({ match_id: data.match_id, game_id: store.room.roomInfo?.game_id });
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

  const joinRoom = (room_id: string, type: string, password?: string) => {
    socketEvents.joinRoom({ room_id, type, password }, (success, player) => {
      console.log('重新加入房间', success)
    });
  };
  const loadState = (data: { match_id: string, game_id: string }) => {
    console.log(data, '加载对局数据')
    socketEvents.getMatchState(data, (state) => {
      gameManager.game?.logic.setState(state)
    })
  }
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

  const handlePlayerReady = (ready: boolean) => {
    socketEvents.playerReadyChange({ room_id: room_id as string, player_id: store.game.gamePlayer._id, ready }, (success) => {
      if (success) {
        store.game.setGamePlayer({ ...store.game.gamePlayer, state: ready ? 'ready' : 'waiting' })
      }
    })
  }
  const handleSurrender = () => {
    if (!room_id) return;
    socketEvents.surrender({ room_id: store.room.currentRoomId, match_id: local.match_id, player_id: store.game.gamePlayer._id }, (success) => {
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

  return (
    <div className="room-page">
      <div className='room-container'>
        <div className='game-main'>
          <BabylonCanvas
            ready={store.game.gamePlayer && store.room.roomInfo ? true : false}
            onReady={(canvas: HTMLCanvasElement) => {
              const socket = getSocket()
              if (socket) {
                gameManager.load(slug as string, canvas, socket, toJS(store.game.gamePlayer)).then(() => {
                  console.log('game loaded')
                  loadState({ game_id: store.room.roomInfo.game_id, match_id: local.match_id, })
                });
              }
            }}
          />
        </div>
        <div className='game-info'>
          <div className="room-actions">
            {store.room.roomInfo?.status !== 'playing' && store.game.gamePlayer?.state === 'idle' && <button onClick={() => handlePlayerReady(true)}>准备</button>}
            {store.room.roomInfo?.status !== 'playing' && store.game.gamePlayer?.state === 'ready' && <button onClick={() => handlePlayerReady(false)}>取消</button>}
            {store.room.roomInfo?.status === 'waiting' && <button onClick={handleLeaveRoom} className="danger">离开房间</button>}
            {store.room.roomInfo?.status === 'playing' && <Fragment>
              <button onClick={handleSeekDraw}>求和</button>
              <button onClick={handleSurrender} className="danger">认输</button>
            </Fragment>}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <PlayerList />
            <Chat room_id={room_id!} />
          </div>
        </div>
      </div>
    </div>
  );
});