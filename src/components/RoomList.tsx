import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { socketEvents } from '../services/socket';
import '../styles/components.css';

export const RoomList = observer(({ gameId }: { gameId: string }) => {
  const navigate = useNavigate();

  const [passwordModal, setPasswordModal] = useState<{ show: boolean; roomId: string }>({
    show: false,
    roomId: ''
  });
  const [passwordInput, setPasswordInput] = useState('');

  const getRooms = (id: string) => {
    // 加载房间列表
    socketEvents.getRooms(id, (rooms) => {
      store.game.setRooms(rooms);
    });
  }

  const handleJoinRoom = (room: any) => {
    if (!store.auth.isLoggedIn) {
      alert('请先登陆');
      return;
    }

    if (room.isPrivate) {
      setPasswordModal({ show: true, roomId: room._id });
    } else {
      joinRoom(room._id);
    }
  };

  const joinRoom = (roomId: string, password?: string) => {
    // TODO: api请求后进入
    navigate(`/room/${roomId}`);
  };

  useEffect(() => {
    getRooms(gameId)
  }, [])

  return (
    <div className="room-list">
      <div className="room-list-header">
        <h3>房间列表  <span onClick={() => { getRooms(gameId); }}>↻</span></h3>
      </div>

      <div className="room-cards">
        {store.game.rooms.length === 0 && <span>暂无房间</span>}
        {store.game.rooms.map(room => (
          <div key={room._id} className={`room-card ${room.status}`}>
            <h4>{room.name}</h4>
            <p>玩家: {room.players.length}/{room.numbers.max}</p>
            {room.isPrivate && <span className="lock">🔒</span>}
            <div className='two-column'>
              <button
                onClick={() => {
                  if (room.isPrivate) {
                    setPasswordModal({ show: true, roomId: room._id });
                  } else {
                    handleJoinRoom(room)
                  }
                }}
                disabled={room.players.length >= room.numbers.max || room.status === 'playing'}
              >
                {room.players.length >= room.numbers.max ? '房满' : '加入'}
              </button>
              <button onClick={() => handleJoinRoom(room)}>观看</button>
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
              <button onClick={() => setPasswordModal({ show: false, roomId: '' })}>取消</button>
              <button onClick={() => joinRoom(passwordModal.roomId, passwordInput)}>加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});