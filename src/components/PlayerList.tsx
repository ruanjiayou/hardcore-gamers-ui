import React, { useEffect } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import { socketEvents } from '../services/socket';
import store from '../stores'

export const PlayerList = observer(() => {
  const reload = () => {
    const roomId = store.room.currentRoomId as string
    socketEvents.getRoomInfo(roomId, (data) => {
      store.room.setCurrentRoom(roomId, data)
    });
  }
  useEffect(() => {
    reload()
  }, [])
  return (
    <Observer>{() => (
      <div className="player-list" style={{ flex: 1 }}>
        <h3>👥 玩家列表 <span onClick={() => { reload(); }}>↻</span></h3>
        {store.room.players.map(player => (
          <div key={player.user_id} className="player-item">
            <span className="avatar">👤</span>
            <span className="name">{player.user_name}</span>
            {(store.room.roomInfo?.owner_id === player.user_id || store.auth.user_id === player.user_id) && (
              <span className="badge">{store.room.roomInfo?.owner_id === player.user_id ? "房主" : "你"}</span>
            )}
          </div>
        ))}
      </div>
    )}
    </Observer>
  );
});