import React, { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import store from '../stores'
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents } from '../services/socket';
import { RoomList } from '../components/RoomList';
import { Leaderboard } from '../components/Leaderboard';
import '../styles/index.css';
import '../styles/game.css';
import '../styles/room.css';

export const GamePage = observer(() => {
  const { slug } = useParams<{ slug: string }>();
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
  const [passwordModal, setPasswordModal] = useState<{ show: boolean; room_id: string }>({
    show: false,
    room_id: ''
  });
  const [passwordInput, setPasswordInput] = useState('');

  const handleCreateRoom = () => {
    if (!store.auth.isLoggedIn) {
      alert('请先登陆');
      return;
    }
    socketEvents.excute(SendoutEvent.CreateRoom, {
      slug,
      name: local.name,
      isPrivate: local.isPrivate,
      password: local.isPrivate ? local.password : undefined
    }, (success: boolean, room_id: string, error?: string) => {
      if (success && room_id) {
        navigate(`/game/${slug}/room/${room_id}`);
        local.setV({ show: false });
      } else {
        alert(error || '创建房间失败');
      }
    });
  };

  const handleJoinInviteRoom = () => {
    if (!store.auth.isLoggedIn) {
      alert('请先登陆');
      return;
    }
    socketEvents.excute(SendoutEvent.JoinInviteRoom, {
      slug,
      name: local.name,
      isPrivate: local.isPrivate,
      password: local.isPrivate ? local.password : undefined
    }, (success: boolean, room_id: string, error: string) => {
      if (success && room_id) {
        navigate(`/game/${slug}/room/${room_id}`);
        local.setV({ show: false });
      } else {
        alert(error || '加入房间失败');
      }
    });
  };

  const onPlayerChange = (data: { player_id: string, field: string, value: any }) => {
    store.game.changePlayer(data);
    store.room.changePlayer(data);
  }

  const onRoomCreated = () => {

  }
  const socket = getSocket();
  useEffect(() => {
    if (!slug || !socket) return;
    if (!store.game.player) {
      socketEvents.getGamePlayer(slug, (player) => {
        store.game.setPlayer(player);
        // 已在游戏房间中
        if (player.room_id) {
          navigate(`/game/${slug}/room/${player.room_id}`);
        }
      })
    }
    socket.on(ReceiveEvent.RoomCreated, onRoomCreated)
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange)
    return () => {
      socket.off(ReceiveEvent.RoomCreated, onRoomCreated)
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange)
    }
  }, [slug, navigate]);

  const onJoinRoom = (room_id: string, type: string, password?: string) => {
    socketEvents.joinRoom({ room_id, type, password }, (success, player) => {
      if (success) {
        navigate(`/game/${slug}/room/${room_id}`);
      } else {
        alert('加入房间失败');
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
          🎮 {store.room.roomInfo?.name}
          <div className='room-card'>
            {store.auth.isLoggedIn && (
              <Fragment>
                <button onClick={() => { }}>匹配</button>
                <button onClick={() => local.setV({ type: 'invite', show: true, isPrivate: false, password: '' })}>加入</button>
                <button onClick={() => local.setV({ type: 'create', show: true, isPrivate: false, password: '' })}>创建</button>
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
                  <button onClick={() => setPasswordModal({ show: false, room_id: '' })}>取消</button>
                  <button onClick={() => onJoinRoom(passwordModal.room_id, 'player', passwordInput)}>加入</button>
                </div>
              </div>
            </div>
          )}
        </h2>
        <Leaderboard slug={slug as string} limit={5} />
        {store.game.player && <RoomList slug={slug!} game_id={store.game.player.game_id!} />}
      </div>
    </div>
  );
});