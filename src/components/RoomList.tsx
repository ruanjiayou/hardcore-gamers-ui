import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { authStore } from '../stores/auth';
import { gameStore } from '../stores/game';
import { socketEvents } from '../services/socket';
import { roomStore } from '../stores/room';
import '../styles/components.css';

interface CreateRoomData {
  name: string;
  isPrivate: boolean;
  password: string;
}

export const RoomList = observer(({ gameId }: { gameId: string }) => {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createData, setCreateData] = useState<CreateRoomData>({
    name: '',
    isPrivate: false,
    password: ''
  });
  const [passwordModal, setPasswordModal] = useState<{ show: boolean; roomId: string }>({
    show: false,
    roomId: ''
  });
  const [passwordInput, setPasswordInput] = useState('');

  const handleCreateRoom = () => {
    if (!authStore.isLoggedIn) {
      alert('请先登陆');
      return;
    }

    socketEvents.createRoom(
      {
        gameId,
        name: createData.name,
        isPrivate: createData.isPrivate,
        password: createData.isPrivate ? createData.password : undefined
      },
      (success, roomId, error) => {
        if (success && roomId) {
          roomStore.setCurrentRoom(roomId, { gameId });
          navigate(`/room/${roomId}`);
          setShowCreateModal(false);
        } else {
          alert(error || '创建房间失败');
        }
      }
    );
  };

  const handleJoinRoom = (room: any) => {
    if (!authStore.isLoggedIn) {
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
    socketEvents.joinRoom(roomId, password, (success, error) => {
      if (success) {
        roomStore.setCurrentRoom(roomId, gameStore.rooms.find(r => r._id === roomId));
        navigate(`/room/${roomId}`);
      } else {
        alert(error || '加入房间失败');
      }
    });
  };

  return (
    <div className="room-list">
      <div className="room-list-header">
        <h3>房间列表</h3>
        {authStore.isLoggedIn && (
          <button onClick={() => setShowCreateModal(true)}>+ 创建房间</button>
        )}
      </div>

      <div className="room-cards">
        {gameStore.rooms.map(room => (
          <div key={room._id} className={`room-card ${room.status}`}>
            <h4>{room.name}</h4>
            <p>玩家: {room.players.length}/{room.numbers.max}</p>
            {room.isPrivate && <span className="lock">🔒</span>}
            <div className='two-column'>
              <button
                onClick={() => handleJoinRoom(room)}
                disabled={room.players.length >= room.numbers.max || room.status === 'playing'}
              >
                {room.players.length >= room.numbers.max ? '房满' : '加入'}
              </button>
              <button onClick={() => handleJoinRoom(room)}>观看</button>
            </div>
          </div>
        ))}
      </div>

      {/* 创建房间模态框 */}
      {showCreateModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>创建房间</h3>
            <input
              type="text"
              placeholder="房间名称"
              value={createData.name}
              onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
            />
            <label>
              <input
                type="checkbox"
                checked={createData.isPrivate}
                onChange={(e) => setCreateData({ ...createData, isPrivate: e.target.checked })}
              />
              私密房间
            </label>
            {createData.isPrivate && (
              <input
                type="password"
                placeholder="房间密码"
                value={createData.password}
                onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
              />
            )}
            <div className="modal-actions">
              <button onClick={() => setShowCreateModal(false)}>取消</button>
              <button onClick={handleCreateRoom}>创建</button>
            </div>
          </div>
        </div>
      )}

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