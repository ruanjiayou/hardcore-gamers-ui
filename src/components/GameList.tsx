import React from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { gameUrl, go } from '../navigation';
import '../styles/components.css';

export const GameList = observer(() => {
  const handleGameClick = (slug: string) => {
    // 游客可以逛大厅，但进游戏要登录（弹提示而不是直接跳登录页）
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能进入游戏');
      return;
    }
    go(gameUrl(slug));
  };

  // 只有"正在请求"才显示 spinner；请求完成但为空应显示空状态，而非无限转圈
  if (store.game.gamesLoading) {
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

  if (store.game.games.length === 0) {
    return (
      <div className="panel game-list-panel">
        <h2>🎯 游戏列表</h2>
        <div className="empty-state">
          <p>暂无游戏，请联系管理员添加</p>
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
            onClick={() => handleGameClick(game.slug)}
          >
            <div className="game-icon">{game.icon}</div>
            <div className="game-content">
              <h3 className="game-name">{game.title}</h3>
              <p className="game-desc">{game.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});