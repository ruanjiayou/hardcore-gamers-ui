import React, { Fragment, useEffect } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import { getSocket, socketEvents } from '../services/socket';
import store from '../stores'
import constant from '../constant';

export const PlayerList = observer(() => {
  const reload = () => {
    const room_id = store.room.currentRoomId as string
    if (room_id) {
      socketEvents.getRoomDetail(room_id, (data) => {
        store.room.setCurrentRoom(data.room)
      });
    }
  }
  const kickOut = (room_id: string, player_id: string) => {
    socketEvents.excute('room:kick-player', { room_id, player_id }, (success: boolean) => {
      if (success) {
        // 
      }
    })
  }
  const kicked = (data: { player_id: string }) => {
    const member = store.room.roomInfo.members.find((m: any) => m._id === data.player_id);
    if (member) {
      store.room.addMessage({ player_id: member._id, player_name: "系统", message: `玩家 ${member.nickname} 被踢出房间` })
      store.room.setCurrentRoom({ ...store.room.roomInfo, members: store.room.roomInfo.members.filter((m: any) => m._id !== data.player_id) })
    }
  }
  const transfer = (room_id: string, player_id: string) => {
    socketEvents.excute('room:transferor-owner', { room_id, player_id }, (success: boolean) => {
      if (success) {
        store.room.setCurrentRoom({ ...store.room.roomInfo, owner_id: player_id })
      }
    })
  }
  const transfered = (data: { player_id: string }) => {
    store.room.setCurrentRoom({ ...store.room.roomInfo, owner_id: data.player_id })
  }
  useEffect(() => {
    reload()
    const socket = getSocket();
    if (socket) {
      socket.on('room:player-kicked', kicked);
      socket.on('room:transferee-owner', transfered);
    }
    return () => {
      if (socket) {
        socket.off('room:player-kicked', kicked);
        socket.off('room:transferee-owner', transfered);
      }
    }
  }, [])
  return (
    <Observer>{() => (
      <div className="player-list" style={{ flex: '1 0 30%' }}>
        <h3>👥 玩家列表 <span onClick={() => { reload(); }}>↻</span></h3>
        {store.room.members.map(player => (
          <div key={player._id} className="player-item">
            <span className="avatar">👤</span>
            <span className="name">{player.nickname}</span>
            {store.game.curren_player_id === player._id
              ? <Fragment>
                <span className="badge">你</span>
              </Fragment>
              : <Fragment>
                {store.game.curren_player_id === store.room.roomInfo?.owner_id && store.room.roomInfo?.status === constant.ROOM.STATUS.waiting && <span className="info" onClick={() => transfer(store.room.currentRoomId, player._id)}>转让</span>}
                {store.game.curren_player_id === store.room.roomInfo?.owner_id && store.room.roomInfo?.status === constant.ROOM.STATUS.waiting && <span className='danger' onClick={() => kickOut(store.room.currentRoomId, player._id)}>踢出</span>}
              </Fragment>}
            {player.type === 'robot' ? <span className="badge">人机</span> : ''}
          </div>
        ))}
      </div>
    )}
    </Observer>
  );
});