import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { authStore } from '../stores/auth';
import { gameStore } from '../stores/game';
import { socketEvents, socketListeners } from '../services/socket';
import { RoomList } from '../components/RoomList';
import '../styles/game.css';

export const GamePage = observer(() => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authStore.user_id) {
      navigate('/login');
      return;
    }

    if (!gameId) return;

    gameStore.selectGame(gameId);

    // 加载房间列表
    socketEvents.getRooms(gameId, (rooms) => {
      gameStore.setRooms(rooms);
    });

    // 监听房间创建
    socketListeners.onRoomCreated((room) => {
      if (room.gameId === gameId) {
        gameStore.addRoom(room);
      }
    });

    // 监听房间销毁
    socketListeners.onRoomDestroyed((data) => {
      gameStore.removeRoom(data.roomId);
    });
  }, [gameId, navigate]);

  return (
    <div className="game-page">
      <div className="game-container">
        <h2>{gameStore.selectedGame?.name} 🎮</h2>
        <RoomList gameId={gameId!} />
      </div>
    </div>
  );
});