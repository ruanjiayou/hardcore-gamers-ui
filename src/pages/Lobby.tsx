import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { socketEvents } from '../services/socket';
import { GameList } from '../components/GameList';
import { Leaderboard } from '../components/Leaderboard';
import { Stats } from '../components/Stats';
import '../styles/lobby.css';

export const LobbyPage = observer(() => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!store.auth.user_id) {
      navigate('/login');
      return;
    }
    // 加载游戏列表
    socketEvents.getGames((games) => {
      store.game.setGames(games);
    });
  }, [navigate]);

  return (
    <div className="lobby">
      <div className="lobby-content">
        <div className='two-column'>
          <GameList />
          <Leaderboard />
        </div>
        <Stats />
      </div>
    </div>
  );
});