import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { gameStore } from '../stores/game';
import '../styles/components.css';
import { socketEvents } from '../services/socket';

export const Leaderboard = observer(() => {
  useEffect(() => {
    if (gameStore.leaderboard.length === 0) {
      socketEvents.getLeaderboard(ranks => {
        gameStore.setLeaderboard(ranks)
      })
    }
  }, []);

  const getRankMedal = (rank: number) => {
    switch (rank) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return rank;
    }
  };

  return (
    <div className="panel leaderboard-panel">
      <h2>🏆 排行榜 Top 10</h2>
      <div className="leaderboard">
        {gameStore.leaderboard.length === 0 ? (
          <div className="loading">
            <div className="spinner"></div>
          </div>
        ) : (
          gameStore.leaderboard.map(player => (
            <div key={player.rank} className="leaderboard-item">
              <div className={`rank rank-${player.rank}`}>
                {getRankMedal(player.rank)}
              </div>
              <div className="player-info">
                <span className="player-avatar">{player.avatar}</span>
                <span className="player-name">{player.name}</span>
              </div>
              <div className="player-rating">{player.rating}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});