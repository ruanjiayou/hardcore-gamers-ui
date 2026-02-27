import React, { useEffect } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import { roomStore } from '../stores/room';
import { socketEvents } from '../services/socket';

export const PlayerList = observer(() => {
  const reload = () => {
    const roomId = roomStore.currentRoomId as string
    socketEvents.getRoomInfo(roomId, (data) => {
      roomStore.setCurrentRoom(roomId, data)
    });
  }
  useEffect(() => {
    reload()
  }, [])
  return (
    <Observer>{() => (
      <div className="player-list">
        <h3>👥 玩家列表 <span onClick={() => { reload(); }}>↻</span></h3>
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
    )}
    </Observer>
  );
});