import React from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import '../styles/components.css';

export const GameList = observer(() => {
  const navigate = useNavigate();

  const handleGameClick = (slug: string) => {
    navigate(`/game/${slug}`);
  };

  if (store.game.games.length === 0) {
    return (
      <div className="panel game-list-panel">
        <h2>🎯 游戏列表</h2>
        <div className="loading">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel game-list-panel">
      <h2>🎯 游戏列表</h2>
      <div className="games-grid">
        {store.game.games.map(game => (
          <div
            key={game._id}
            className={`game-card`}
            onClick={() => handleGameClick(game._id)}
          >
            <div className="game-icon">{game.icon}</div>
            <div className="game-content">
              <h3 className="game-name">{game.title}</h3>
              <p className="game-desc">{game.desc}</p>
              <div className="game-stats">
                <span>🏠 {game.rooms} 房间</span>
                <span>👥 {game.players} 人</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});