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
        // 失败时第二个参数是服务端原因（房间已满/禁止观战/密码错误等）
        notificationManager.show(typeof player === 'string' && player ? player : '加入失败', 'warning');
      }
    });
  };

  useEffect(() => {
    getRooms(game_id)
  }, [])

  // 官方公共房排前（腾讯棋牌式固定桌），其余按创建时间
  const rooms = [...store.game.rooms].sort((a, b) => {
    const ao = a.official ? 0 : 1;
    const bo = b.official ? 0 : 1;
    return ao - bo;
  });

  return (
    <div className="room-list">
      <div className="room-list-header">
        <h3>房间列表  <span onClick={() => { getRooms(game_id); }}>↻</span></h3>
      </div>

      <div className="room-cells">
        {rooms.length === 0 && <span>暂无房间</span>}
        {rooms.map(room => (
          <div key={room._id} className={`room-cell ${room.status}`} style={{ display: 'flex', flexDirection: 'column' }}>
            <h4>
              {room.name}
              {room.official && <span className="badge-official">官方</span>}
              {room.allowSpectate === false && <span className="badge-nospectate">禁观</span>}
            </h4>
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
                disabled={room.members.length >= room.numbers.max || room.status !== 'waiting'}
              >
                {room.status !== 'waiting' ? '游戏中' : (room.members.length >= room.numbers.max ? '房满' : '加入')}
              </button>
              {/* 关闭观战的房间隐藏"观看"入口 */}
              {room.allowSpectate !== false && (
                <button onClick={() => handleJoinRoom(room, 'viewer')}>观看</button>
              )}
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
              <button onClick={() => gotoRoom(passwordModal.room_id, 'player', passwordInput)}>加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});