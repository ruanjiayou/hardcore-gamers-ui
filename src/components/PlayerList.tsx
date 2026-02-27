import React from 'react';
import { observer } from 'mobx-react-lite';
import { roomStore } from '../stores/room';

export const PlayerList = observer(() => {
  return (
    <div className="player-list">
      <h3>👥 玩家列表</h3>
      {roomStore.players.map(player => (
        <div key={player.user_id} className="player-item">
          <span className="avatar">👤</span>
          <span className="name">{player.user_name}</span>
          {roomStore.roomInfo?.owner_id === player.user_id && (
            <span className="badge">房主</span>
          )}
        </div>
      ))}
    </div>
  );
});