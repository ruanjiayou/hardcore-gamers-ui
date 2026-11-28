import React, { useEffect, useRef, useState } from 'react';
import { Observer, observer } from 'mobx-react-lite';
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
  /**
   * 榜单数据放**组件自己**的 state（`GM-snake-47`）。
   * 以前写全局 `store.game.leaderboard`：同一页面/多个弹框同时存在时会互相覆盖，
   * 一个还没回来的旧请求能把刚渲染出来的榜清空 —— 表现就是「排行榜没数据」。
   */
  const [rows, setRows] = useState<any[]>([]);
  /** 请求序号：切分榜 / 换游戏后，慢回来的旧响应直接丢弃 */
  const reqRef = useRef(0);

  useEffect(() => {
    // 切换游戏 / games 加载完成后，确保选中的分榜属于当前游戏
    setBoard(prev => (prev && boards?.some(b => b.key === prev) ? prev : boards?.[0]?.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, boards?.length]);

  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true);
    // 超时兜底：服务端抛异常时 emit 的回调不会回来，不能让榜永远转圈
    const timer = setTimeout(() => {
      if (reqRef.current === id) setLoading(false);
    }, 5000);
    socketEvents.excute(SendoutEvent.GameRanks, { slug, limit, board }, (ranks: any) => {
      if (reqRef.current !== id) return; // 过期响应：已经切到别的分榜了
      clearTimeout(timer);
      setRows(Array.isArray(ranks) ? ranks : []);
      setLoading(false);
    });
    return () => clearTimeout(timer);
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
          rows.length === 0
            ? <div>暂无数据</div>
            : rows.map(player => (
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
