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
    store.game.setGamesLoading(true);
    socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
      store.game.setGames(games);
    });
    // 兜底：服务端未回调时也要结束 loading，避免永久转圈
    const timeout = window.setTimeout(() => store.game.setGamesLoading(false), 8000);
    socket?.on(ReceiveEvent.UserChange, onUserChange);
    return () => {
      window.clearTimeout(timeout);
      socket?.off(ReceiveEvent.UserChange, onUserChange);
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