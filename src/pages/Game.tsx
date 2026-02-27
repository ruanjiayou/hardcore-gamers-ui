import React, { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { authStore } from '../stores/auth';
import { gameStore } from '../stores/game';
import { roomStore } from '../stores/room';
import { socketEvents, socketListeners } from '../services/socket';
import { RoomList } from '../components/RoomList';
import '../styles/index.css';
import '../styles/game.css';
import '../styles/room.css';

export const GamePage = observer(() => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const local = useLocalObservable(() => ({
    type: '', // create/invite
    name: '',
    show: false,
    isPrivate: false,
    password: '',
    setV(o: object) {
      for (let k in o) {
        // @ts-ignore
        local[k] = o[k];
      }
    },
  }))
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
        name: local.name,
        isPrivate: local.isPrivate,
        password: local.isPrivate ? local.password : undefined
      },
      (success, roomId, error) => {
        if (success && roomId) {
          roomStore.setCurrentRoom(roomId, { gameId });
          navigate(`/room/${roomId}`);
          local.setV({ show: false });
        } else {
          alert(error || '创建房间失败');
        }
      }
    );
  };

  const handleJoinInviteRoom = () => {
    if (!authStore.isLoggedIn) {
      alert('请先登陆');
      return;
    }

    socketEvents.joinInviteRoom(
      {
        gameId,
        name: local.name,
        isPrivate: local.isPrivate,
        password: local.isPrivate ? local.password : undefined
      },
      (success, roomId, error) => {
        if (success && roomId) {
          roomStore.setCurrentRoom(roomId, { gameId });
          navigate(`/room/${roomId}`);
          local.setV({ show: false });
        } else {
          alert(error || '加入房间失败');
        }
      }
    );
  };

  useEffect(() => {
    if (!authStore.user_id) {
      navigate('/login');
      return;
    }

    if (!gameId) return;

    gameStore.selectGame(gameId);

    // 监听房间创建
    socketListeners.onRoomCreated((room) => {
      if (room.gameId === gameId) {
        gameStore.addRoom(room);
      }
    });

    // 监听房间销毁
    socketListeners.onRoomDestroyed((data) => {
      gameStore.removeRoom(data.roomId);
    });
  }, [gameId, navigate]);

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
    <div className="game-page">
      <div className="game-container">
        <h2>
          <div className='back-arrow-circle' onClick={() => {
            navigate(-1);
          }}><div className="back-arrow"></div></div>
          🎮 {gameStore.selectedGame?.name}
          <div className='room-card'>
            {authStore.isLoggedIn && (
              <Fragment>
                <button onClick={() => { }}>快速匹配</button>
                <button onClick={() => local.setV({ type: 'invite', show: true, isPrivate: false, password: '' })}>加入房间</button>
                <button onClick={() => local.setV({ type: 'create', show: true, isPrivate: false, password: '' })}>创建房间</button>
              </Fragment>
            )}
          </div>

          {/* 加入房间模态框 */}
          {local.show && (
            <div className="modal">
              <div className="modal-content">
                <h3>{local.type === 'create' ? '创建' : '加入'}房间</h3>
                <input
                  type="text"
                  placeholder="房间名称"
                  value={local.name}
                  onChange={(e) => local.setV({ name: e.target.value })}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={local.isPrivate}
                    onChange={(e) => local.setV({ isPrivate: e.target.checked })}
                  />
                  私密房间
                </label>
                {local.isPrivate && (
                  <input
                    type="password"
                    placeholder="房间密码"
                    value={local.password}
                    onChange={(e) => local.setV({ password: e.target.value })}
                  />
                )}
                <div className="modal-actions">
                  <button onClick={() => local.setV({ show: false })}>取消</button>
                  <button onClick={() => local.type === 'create' ? handleCreateRoom() : handleJoinInviteRoom()}>{local.type === 'create' ? '创建' : '加入'}</button>
                </div>
              </div>
            </div>
          )}

          {/* 加入公共房间 输入密码模态框 */}
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
        </h2>
        <RoomList gameId={gameId!} />
      </div>
    </div>
  );
});