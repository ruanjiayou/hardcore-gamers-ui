import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents } from '../services/socket';
import { GameList } from '../components/GameList';
import { Stats } from '../components/Stats';
import '../styles/lobby.css';

export const LobbyPage = observer(() => {
  const navigate = useNavigate();
  const onUserChange = (data: { user_id: string, field: string, value: any }) => {
    store.auth.changeUser(data)
  }
  const socket = getSocket()!;
  useEffect(() => {
    // 加载游戏列表
    socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
      store.game.setGames(games);
    });
    socket.on(ReceiveEvent.UserChange, onUserChange);
    return () => {
      socket.off(ReceiveEvent.UserChange, onUserChange);
    }
  }, [navigate]);

  return (
    <div className="lobby">
      <div className="lobby-content">
        <GameList />
        <Stats />
      </div>
    </div>
  );
});