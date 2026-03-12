import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import '../styles/components.css';
import { socketEvents } from '../services/socket';

export const Stats = observer(() => {
  useEffect(() => {
    if (!store.game.stats) {
      socketEvents.getStats(stats => {
        store.game.setStats(stats);
      })
    }
  }, []);

  if (!store.game.stats) {
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
          <div className="stat-value">{store.game.stats.games.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">用户总数</div>
          <div className="stat-value">{store.game.stats.users.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">活跃房间</div>
          <div className="stat-value">{store.game.stats.rooms.active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">玩家总数数</div>
          <div className="stat-value">{store.game.stats.players.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">在线玩家</div>
          <div className="stat-value">{store.game.stats.players.atline}</div>
        </div>
      </div>
    </div>
  );
});