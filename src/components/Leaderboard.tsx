import React, { useEffect, useState } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import store from '../stores';
import '../styles/components.css';
import { SendoutEvent, socketEvents } from '../services/socket';

interface Props {
  slug: string;
  limit: number;
  /** 分榜（贪吃蛇：无尽榜 / 多人榜）；缺省只有一张总榜 */
  boards?: { key: string; label: string }[];
}

export const Leaderboard = observer(({ slug, limit, boards }: Props) => {
  const [board, setBoard] = useState<string | undefined>(boards?.[0]?.key);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 切换游戏 / games 加载完成后，确保选中的分榜属于当前游戏
    setBoard(prev => (prev && boards?.some(b => b.key === prev) ? prev : boards?.[0]?.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, boards?.length]);

  useEffect(() => {
    setLoading(true);
    socketEvents.excute(SendoutEvent.GameRanks, { slug, limit, board }, (ranks: any) => {
      store.game.setLeaderboard(Array.isArray(ranks) ? ranks : []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, board, limit]);

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
    <div className="leaderboard-panel">
      <h2>🏆 排行榜Top</h2>
      {boards && boards.length > 1 && (
        <div className="board-tabs">
          {boards.map(b => (
            <button
              key={b.key}
              className={`board-tab ${board === b.key ? 'active' : ''}`}
              onClick={() => setBoard(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <div className="leaderboard">
        <div className='leaderboard-item'>
          <div className='rank'>排名</div>
          <div className='player-info'>
            <span className='player-avatar'></span>
            <span className='player-name'>昵称</span>
          </div>
          <div className='player-rating'>分数</div>
        </div>
        {loading ? (
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
                  {/* 排行榜统一展示：去掉机器人昵称前缀与类型标记，人机与玩家外观一致 */}
                  <span className="player-avatar">{player.type === 'robot' ? '👤' : (player.avatar || '👤')}</span>
                  <span className="player-name">{player.nickname || '玩家'}</span>
                </div>
                <div className="player-rating">{player.score}</div>
              </div>
            ))
        )}
      </div>
    </div>
  )}</Observer>;
});
