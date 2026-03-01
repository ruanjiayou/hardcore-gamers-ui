import React, { useEffect } from 'react';
import { Observer, observer, useLocalObservable } from 'mobx-react-lite';
import store from '../stores'
import '../styles/components.css';
import { socketEvents } from '../services/socket';

export const Leaderboard = observer(() => {
  const local = useLocalObservable(() => ({
    loading: false,
    setLoading(is: boolean) {
      local.loading = is;
    }
  }))
  useEffect(() => {
    if (!local.loading) {
      socketEvents.getLeaderboard(ranks => {
        store.game.setLeaderboard(ranks)
        local.setLoading(false)
      })
    }
  }, [local.loading]);

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

  return <Observer>{() => (
    <div className="panel leaderboard-panel">
      <h2>🏆 排行榜 Top 10</h2>
      <div className="leaderboard">
        {local.loading ? (
          <div className="loading">
            <div className="spinner"></div>
          </div>
        ) : (
          store.game.leaderboard.length === 0
            ? <div>暂无数据</div>
            : store.game.leaderboard.map(player => (
              <div key={player.rank} className="leaderboard-item">
                <div className={`rank rank-${player.rank}`}>
                  {getRankMedal(player.rank)}
                </div>
                <div className="player-info">
                  <span className="player-avatar">{player.avatar}</span>
                  <span className="player-name">{player.user_name}</span>
                </div>
                <div className="player-rating">{player.score}</div>
              </div>
            ))
        )}
      </div>
    </div>
  )}</Observer>;
});