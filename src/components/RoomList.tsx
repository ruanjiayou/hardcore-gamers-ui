import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { SendoutEvent, socketEvents } from '../services/socket';
import '../styles/components.css';
import { notificationManager } from './Notifications';

export const RoomList = observer(({ game_id, slug }: { game_id: string, slug: string }) => {
  const navigate = useNavigate();

  const [passwordModal, setPasswordModal] = useState<{ show: boolean; room_id: string }>({
    show: false,
    room_id: ''
  });
  const [passwordInput, setPasswordInput] = useState('');

  const getRooms = (game_id: string) => {
    // 加载房间列表
    socketEvents.getRooms(game_id, (rooms) => {
      store.game.setRooms(rooms);
    });
  }

  const handleJoinRoom = (room: any, type: string) => {
    if (!store.auth.isLoggedIn) {
      alert('请先登陆');
      return;
    }

    if (room.isPrivate) {
      setPasswordModal({ show: true, room_id: room._id });
    } else {
      gotoRoom(room._id, type);
    }
  };

  const gotoRoom = (room_id: string, type: string, password?: string) => {
    socketEvents.excute(SendoutEvent.JoinRoom, { room_id, type, password }, (success: boolean, player: any) => {
      if (success) {
        if (player) {
          store.game.setPlayer(player)
        }
        navigate(`/game/${slug}/room/${room_id}`);
      } else {
        notificationManager.show('加入失败', 'warning');
      }
    });
  };

  useEffect(() => {
    getRooms(game_id)
  }, [])

  return (
    <div className="room-list">
      <div className="room-list-header">
        <h3>房间列表  <span onClick={() => { getRooms(game_id); }}>↻</span></h3>
      </div>

      <div className="room-cells">
        {store.game.rooms.length === 0 && <span>暂无房间</span>}
        {store.game.rooms.map(room => (
          <div key={room._id} className={`room-cell ${room.status}`} style={{ display: 'flex', flexDirection: 'column' }}>
            <h4>{room.name}</h4>
            <p>玩家: {room.members.length}/{room.numbers.max}</p>
            {room.isPrivate && <span className="lock">🔒</span>}
            <div className='two-column'>
              <button
                onClick={() => {
                  if (room.isPrivate) {
                    setPasswordModal({ show: true, room_id: room._id });
                  } else {
                    handleJoinRoom(room, 'player')
                  }
                }}
                disabled={room.members.length >= room.numbers.max || room.status === 'playing'}
              >
                {room.members.length >= room.numbers.max ? '房满' : '加入'}
              </button>
              <button onClick={() => handleJoinRoom(room, 'viewer')}>观看</button>
            </div>
          </div>
        ))}
      </div>

      {/* 输入密码模态框 */}
      {passwordModal.show && (
        <div className="modal">
          <div className="modal-content">
            <h3>房间需要密码</h3>
            <input
              type="password"
              placeholder="输入密码"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            <div className="modal-actions">
              <button onClick={() => setPasswordModal({ show: false, room_id: '' })}>取消</button>
              <button onClick={() => gotoRoom(passwordModal.room_id, passwordInput)}>加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});