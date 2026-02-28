import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { authStore } from '../stores/auth';
import { roomStore } from '../stores/room';
import { socketEvents, socketListeners } from '../services/socket';
import { PlayerList } from '../components/PlayerList';
import { Chat } from '../components/Chat';
import '../styles/index.css';
import '../styles/room.css';

export const RoomPage = observer(() => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authStore.user_id || !roomId) {
      navigate('/lobby');
      return;
    }
    if (!roomStore.currentRoomId) {
      socketEvents.joinRoom(roomId, '', (success, error) => {
        if (success) {
          socketEvents.getRoomInfo(roomId, (data) => {
            roomStore.setCurrentRoom(roomId, data)
          });
        }
      })
    }
    // 监听玩家加入
    socketListeners.onPlayerJoined((data) => {
      roomStore.addPlayer(data);
    });

    // 监听玩家离开
    socketListeners.onPlayerLeft((data) => {
      roomStore.removePlayer(data.user_id);
    });

    // 监听消息
    socketListeners.onMessage((message) => {
      roomStore.addMessage(message);
    });

    // 监听游戏开始
    socketListeners.onGameStarted(() => {
      navigate(`/game/${roomStore.roomInfo?.gameId}`);
    });
  }, [roomId, navigate]);

  const handleLeaveRoom = () => {
    if (!roomId) return;
    console.log('leave room?', roomId)
    socketEvents.leaveRoom(roomId, (success) => {
      console.log(success, 'leave?')
      if (success) {
        roomStore.clear();
        navigate(-1);
      }
    });
  };

  const handleStartGame = () => {
    if (!roomId) return;
    socketEvents.startGame(roomId);
  };

  return (
    <div className="room-page">
      <div className="room-header">
        <h2>{roomStore.roomInfo?.name}</h2>
        <div className="room-actions">
          {roomStore.roomInfo?.owner_id === authStore.user_id && (
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