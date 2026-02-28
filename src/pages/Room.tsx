import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { socketEvents, socketListeners } from '../services/socket';
import { PlayerList } from '../components/PlayerList';
import { Chat } from '../components/Chat';
import '../styles/index.css';
import '../styles/room.css';

export const RoomPage = observer(() => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!store.auth.user_id || !roomId) {
      navigate('/lobby');
      return;
    }
    if (!store.room.currentRoomId) {
      socketEvents.joinRoom(roomId, '', (success, error) => {
        if (success) {
          socketEvents.getRoomInfo(roomId, (data) => {
            store.room.setCurrentRoom(roomId, data)
          });
        }
      })
    }
    // 监听玩家加入
    socketListeners.onPlayerJoined((data) => {
      store.room.addPlayer(data);
    });

    // 监听玩家离开
    socketListeners.onPlayerLeaved((data) => {
      store.room.removePlayer(data.player_id);
    });

    // 监听网络状态
    socketListeners.onPlayerNetwork((data: { player_id: string, online: boolean }) => {
      store.room.setPlayerNetwork(data.player_id, data.online)
    })

    // 监听消息
    socketListeners.onMessage((message) => {
      store.room.addMessage(message);
    });

    // 监听游戏开始
    socketListeners.onGameStarted(() => {
      navigate(`/game/${store.room.roomInfo?.gameId}`);
    });
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
    socketEvents.startGame(roomId);
  };

  return (
    <div className="room-page">
      <div className="room-header">
        <h2>{store.room.roomInfo?.name}</h2>
        <div className="room-actions">
          {store.room.roomInfo?.owner_id === store.auth.user_id && (
            <button onClick={handleStartGame}>开始游戏</button>
          )}
          <button onClick={handleLeaveRoom} className="danger">离开房间</button>
        </div>
      </div>

      <div className="room-body">
        <PlayerList />
        <Chat roomId={roomId!} />
      </div>
    </div>
  );
});