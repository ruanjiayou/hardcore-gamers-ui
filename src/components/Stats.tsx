import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { gameStore } from '../stores/game';
import '../styles/components.css';
import { socketEvents } from '../services/socket';

export const Stats = observer(() => {
  useEffect(() => {
    if (!gameStore.stats) {
      socketEvents.getStats(stats => {
        gameStore.setStats(stats);
      })
    }
  }, []);

  if (!gameStore.stats) {
    return (
      <div className="panel stats-panel">
        <h2>📊 服务统计</h2>
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-panel">
      <h2>📊 服务统计</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">总游戏数</div>
          <div className="stat-value">{gameStore.stats.games.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">在线用户</div>
          <div className="stat-value">{gameStore.stats.users.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">游戏人数</div>
          <div className="stat-value">{gameStore.stats.players.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">活跃房间</div>
          <div className="stat-value">{gameStore.stats.rooms.active}</div>
        </div>
      </div>
    </div>
  );
});