import React, { useEffect } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import { socketEvents } from '../services/socket';
import store from '../stores'

export const PlayerList = observer(() => {
  const reload = () => {
    const room_id = store.room.currentRoomId as string
    if (room_id) {
      socketEvents.getRoomDetail(room_id, (data) => {
        store.room.setCurrentRoom(data.room)
      });
    }
  }
  useEffect(() => {
    reload()
  }, [])
  return (
    <Observer>{() => (
      <div className="player-list" style={{ flex: '1 0 30%' }}>
        <h3>👥 玩家列表 <span onClick={() => { reload(); }}>↻</span></h3>
        {store.room.members.map(player => (
          <div key={player.user_id} className="player-item">
            <span className="avatar">👤</span>
            <span className="name">{player.nick_name}</span>
            {(store.auth.user?._id === player.user_id) ? (
              <span className="badge">你</span>
            ) : (player.type === 'viewer') ? '旁观' : ''}
          </div>
        ))}
      </div>
    )}
    </Observer>
  );
});