import React, { useEffect, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx'
import store from '../stores'
import { ReceiveEvent, SendoutEvent, getSocket, socketEvents } from '../services/socket';
import { PlayerList } from '../components/PlayerList';
import { Chat } from '../components/Chat';
import '../styles/index.css';
import '../styles/room.css';
import BabylonCanvas from "../core/BabylonCanvas";
import { gameManager } from "../core/GameManager";
import { runInAction } from 'mobx';
import { notificationManager } from '../components/Notifications'
import constant, { PlayerState, RoomStatus } from '../constant'

export const RoomPage = observer(() => {
  const { slug, room_id } = useParams<{ slug: string, room_id: string; }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    showAgreeDraw: false,
    loading: false,
    match_id: '',
    setV(key: 'showAgreeDraw' | 'match_id' | 'loading', v: any) {
      if (key === 'showAgreeDraw') {
        local.showAgreeDraw = v;
      } else if (key === 'match_id') {
        local.match_id = v;
      } else if (key === 'loading') {
        local.loading = v;
      }
    }
  }));
  const init = (room_id?: string) => {
    if (!room_id || local.loading) {
      return;
    }
    local.setV('loading', true)
    if (!store.game.player) {
      socketEvents.getGamePlayer(slug!, (player) => {
        store.game.setPlayer(player);
      })
    }
    socketEvents.getRoomDetail(room_id, (data) => {
      const { room } = data;
      store.room.setCurrentRoom(room)
      local.setV('match_id', data.match_id)
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
  const onGameOver = (data: { _id: string, nickname: string }) => {
    notificationManager.show(`玩家 ${data.nickname} 胜利`)
    store.room.setRoomStatus('waiting')
    loadState({ game_slug: slug, match_id: '', })
  }
  const onRoomReady = () => {
    store.room.setRoomStatus('ready');
  }
  const onRoomMessage = (message: any) => {
    store.room.addMessage(message);
  }
  const onReceiveDraw = (data: any) => {
    if (data.user_id !== store.auth.user?._id) {
      runInAction(() => {
        local.showAgreeDraw = true;
      })
    }
  }
  useEffect(() => {
    if (!room_id) {
      navigate('/lobby');
      return;
    }
    init(room_id)
    if (!socket) {
      console.log('此时没有 socket')
      return;
    }
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange);
    socket.on(ReceiveEvent.PlayerJoined, onPlayerJoined);
    socket.on(ReceiveEvent.PlayerLeaved, onPlayerLeaved);
    socket.on(ReceiveEvent.PlayerReJoin, onPlayerReJoin);

    socket.on(ReceiveEvent.GameStart, onGameStart);
    socket.on(ReceiveEvent.GameOver, onGameOver);
    socket.on(ReceiveEvent.RoomMessage, onRoomMessage);
    socket.on(ReceiveEvent.RoomReady, onRoomReady);
    socket.on(ReceiveEvent.OfferDraw, onReceiveDraw);
    return () => {
      gameManager.unload();
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange);
      socket.off(ReceiveEvent.PlayerJoined, onPlayerJoined);
      socket.off(ReceiveEvent.PlayerLeaved, onPlayerLeaved);
      socket.off(ReceiveEvent.PlayerReJoin, onPlayerReJoin);
      socket.off(ReceiveEvent.GameStart, onGameStart);
      socket.off(ReceiveEvent.GameOver, onGameOver);
      socket.off(ReceiveEvent.RoomMessage, onRoomMessage);
      socket.off(ReceiveEvent.RoomReady, onRoomReady);
      socket.off(ReceiveEvent.OfferDraw, onReceiveDraw);
    };
  }, [room_id, navigate]);

  const loadState = (data: { match_id: string, game_slug?: string }) => {
    console.log(data, '加载对局数据')
    socketEvents.excute(SendoutEvent.GetMatchState, data, (state: any) => {
      gameManager.game?.logic.setState(state)
    });
  }
  const handleAddRobot = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.AddRobot, { room_id }, (success: boolean) => {
      if (success) {
        notificationManager.show('添加机器人成功', 'success')
      } else {
        notificationManager.show('添加机器人失败', 'warning')
      }
    });
  }

  const handleLeaveRoom = () => {
    if (!room_id) return;
    socketEvents.excute(SendoutEvent.LeaveRoom, { room_id, player_id: store.game.player_id }, (success: boolean) => {
      console.log('离开房间', success)
      store.room.clear();
      store.game.setPlayer({ ...store.game.player, room_id: '' })
      navigate(-1);
    });
  };

  const handlePlayerReady = (ready: boolean) => {
    socketEvents.playerReadyChange({ room_id: room_id as string, player_id: store.game.player_id, ready }, (success) => {
      if (success) {
        store.game.setPlayer({ ...store.game.player, state: ready ? 'ready' : 'waiting' })
      }
    })
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

  return (
    <div className="room-page">
      <div className='room-container'>
        <div className='game-main'>
          <BabylonCanvas
            ready={store.game.player && store.room.roomInfo ? true : false}
            onReady={(canvas: HTMLCanvasElement) => {
              const socket = getSocket()
              if (socket) {
                gameManager.load(slug!, canvas, socket, toJS(store.game.player)).then(() => {
                  console.log('game loaded')
                  loadState({ game_slug: slug, match_id: local.match_id, })
                });
              }
            }}
          />
        </div>
        <div className='game-info'>
          <div className="room-actions">
            {store.room.roomInfo?.status === RoomStatus.waiting && <button onClick={handleAddRobot}>添加机器人</button>}
            {store.room.roomInfo?.status === RoomStatus.waiting && store.game.player?.member_type === 'player' && store.game.player?.state === PlayerState.inroom && <button onClick={() => handlePlayerReady(true)}>准备</button>}
            {store.room.roomInfo?.status === RoomStatus.waiting && store.game.player?.member_type === 'player' && store.game.player?.state === PlayerState.prepared && <button onClick={() => handlePlayerReady(false)}>取消</button>}
            {store.room.roomInfo?.status === RoomStatus.waiting && <button onClick={handleLeaveRoom} className="danger">离开</button>}
            {store.room.roomInfo?.status === RoomStatus.playing && store.game.player?.member_type === 'player' && <Fragment>
              <button onClick={handleRequestDraw}>求和</button>
              <button onClick={requestSurrender} className="danger">认输</button>
            </Fragment>}
          </div>
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: '0.5rem' }}>
            <PlayerList room_id={room_id!} />
            <Chat room_id={room_id!} />
          </div>
        </div>
      </div>
    </div>
  );
});