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
    type: 'create',
    name: '',
    show: false,
    isPrivate: false,
    password: '',
    allowSpectate: true,
    starting: false,
    setV(o: object) {
      for (let k in o) {
        // @ts-ignore
        local[k] = o[k];
      }
    },
  }))

  // 游戏主页形态：solo=单人直接开局；room=房间制（棋类/组队）。
  // games 列表未加载时回退按 slug 判断（2048 为单人）。
  const game = store.game.games.find(g => g.slug === slug);
  const isSolo = (game?.mode ?? (slug === '2048' ? 'solo' : 'room')) === 'solo';

  /** 单人游戏：一键开一局（服务端建临时房并立即开局，无需房间） */
  const handleQuickStart = () => {
    if (!store.auth.isLoggedIn) {
      alert('请先登陆');
      return;
    }
    if (local.starting) return;
    local.setV({ starting: true });
    socketEvents.quickStart(slug!, (success, data, message) => {
      local.setV({ starting: false });
      if (success && data?.room_id) {
        navigate(`/game/${slug}/room/${data.room_id}`);
      } else {
        alert(message || '开始游戏失败');
      }
    });
  };

  const handleCreateRoom = () => {
    if (!store.auth.isLoggedIn) {
      alert('请先登陆');
      return;
    }
    socketEvents.excute(SendoutEvent.CreateRoom, {
      slug,
      name: local.name,
      isPrivate: local.isPrivate,
      password: local.isPrivate ? local.password : undefined,
      allowSpectate: local.allowSpectate,
    }, (success: boolean, room_id: string, error?: string) => {
      if (success && room_id) {
        navigate(`/game/${slug}/room/${room_id}`);
        local.setV({ show: false });
      } else {
        alert(error || '创建房间失败');
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
        // 已在游戏中（如单人快开的临时房未退出）→ 回到对局
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

  return (
    <div className="game-page">
      <div className="game-container">
        <h2>
          <div className='back-arrow-circle' onClick={() => {
            navigate(-1);
          }}><div className="back-arrow"></div></div>
          🎮 {game?.title || slug}
          {/* 房间制游戏：匹配 / 创建（加入走房间列表） */}
          {!isSolo && (
            <div className='room-card'>
              {store.auth.isLoggedIn && (
                <Fragment>
                  <button onClick={() => alert('匹配功能开发中，可先加入官方房间对战')}>匹配</button>
                  <button onClick={() => local.setV({ type: 'create', show: true, isPrivate: false, password: '', allowSpectate: true })}>创建</button>
                </Fragment>
              )}
            </div>
          )}
        </h2>

        {/* 单人游戏：一键开一局，不走房间 */}
        {isSolo && (
          <div className="solo-start">
            <button className="solo-start-btn" disabled={local.starting} onClick={handleQuickStart}>
              {local.starting ? '正在开局…' : '▶ 开始游戏'}
            </button>
            <p className="solo-hint">单人模式，无需房间，成绩实时计入排行榜</p>
          </div>
        )}

        {/* 创建房间模态框（仅房间制） */}
        {local.show && (
          <div className="modal">
            <div className="modal-content">
              <h3>创建房间</h3>
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
              <label>
                <input
                  type="checkbox"
                  checked={local.allowSpectate}
                  onChange={(e) => local.setV({ allowSpectate: e.target.checked })}
                />
                允许观战
              </label>
              <div className="modal-actions">
                <button onClick={() => local.setV({ show: false })}>取消</button>
                <button onClick={handleCreateRoom}>创建</button>
              </div>
            </div>
          </div>
        )}
        <Leaderboard slug={slug as string} limit={5} />
        {/* 房间制才展示房间列表；单人游戏没有房间概念 */}
        {!isSolo && store.game.player && <RoomList slug={slug!} game_id={store.game.player.game_id!} />}
      </div>
    </div>
  );
});
