import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { gameStore } from '../stores/game';
import '../styles/components.css';

export const Leaderboard = observer(() => {
  useEffect(() => {
    // 模拟获取排行榜数据
    const mockLeaderboard = [
      { rank: 1, avatar: '👨', name: '玩家A', rating: 1500 },
      { rank: 2, avatar: '👩', name: '玩家B', rating: 1450 },
      { rank: 3, avatar: '👦', name: '玩家C', rating: 1400 },
      { rank: 4, avatar: '👧', name: '玩家D', rating: 1350 },
      { rank: 5, avatar: '👨‍🦱', name: '玩家E', rating: 1300 },
      { rank: 6, avatar: '👩‍🦱', name: '玩家F', rating: 1250 },
      { rank: 7, avatar: '👨', name: '玩家G', rating: 1200 },
      { rank: 8, avatar: '👩', name: '玩家H', rating: 1150 },
      { rank: 9, avatar: '👦', name: '玩家I', rating: 1100 },
      { rank: 10, avatar: '👧', name: '玩家J', rating: 1050 }
    ];

    gameStore.setLeaderboard(mockLeaderboard);
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