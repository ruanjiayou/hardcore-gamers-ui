import React, { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer, useLocalObservable } from 'mobx-react-lite';
import store from '../stores'
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents, syncRoomScore } from '../services/socket';
import { Leaderboard } from '../components/Leaderboard';
import { LoginRequiredPanel } from '../components/LoginRequired';
import { GameHeader } from '../components/GameHeader';
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
    allowSpectate: true,
    starting: false,
    matching: false,
    setV(o: object) {
      for (let k in o) {
        // @ts-ignore
        local[k] = o[k];
      }
    },
  }))

  const game = store.game.games.find(g => g.slug === slug);
  const variants = game?.variants || [];
  // 玩法变体（贪吃蛇：无尽/多人）：默认选第一个
  const [activeVariant, setActiveVariant] = useState<string>('');
  useEffect(() => {
    setActiveVariant(prev => (prev && variants.some(v => v.key === prev) ? prev : (variants[0]?.key || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, variants.length]);

  const variantInfo = variants.find(v => v.key === activeVariant);
  // 游戏主页形态：solo=单人直接开局；room=房间制（棋类/组队）。
  // 有变体时以变体为准；否则按 mode（未加载时按人数回退：1 人即单人）。
  const isSolo = variantInfo
    ? variantInfo.mode === 'solo'
    : (game?.mode ?? ((game?.numbers?.max ?? 2) <= 1 ? 'solo' : 'room')) === 'solo';

  /** 单人玩法：一键开一局（服务端建临时房并立即开局，无需房间） */
  const handleQuickStart = () => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能开始游戏');
      return;
    }
    if (local.starting) return;
    local.setV({ starting: true });
    socketEvents.quickStart(slug!, variantInfo?.key, (success, data, message) => {
      local.setV({ starting: false });
      if (success && data?.room_id) {
        navigate(`/game/${slug}/room/${data.room_id}`);
      } else {
        alert(message || '开始游戏失败');
      }
    });
  };

  /** 匹配：服务端找一张还有空位的桌子（没有就开新桌），不再展示房间列表 */
  const handleMatch = () => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能匹配');
      return;
    }
    if (local.matching) return;
    local.setV({ matching: true });
    socketEvents.match(slug!, variantInfo?.key, (success, player, message) => {
      local.setV({ matching: false });
      const room_id = player?.room_id;
      if (success && room_id) {
        navigate(`/game/${slug}/room/${room_id}`);
      } else {
        alert(message || '匹配失败，请重试');
      }
    });
  };

  const handleCreateRoom = () => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能创建房间');
      return;
    }
    socketEvents.excute(SendoutEvent.CreateRoom, {
      slug,
      name: local.name,
      allowSpectate: local.allowSpectate,
      variant: variantInfo?.key,
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
    // 直接打开/刷新游戏主页时 store 里还没有游戏列表，需要自己拉一次，
    // 否则拿不到 mode/variants，单人会误显示成房间对战
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    // 从房间页主动点了返回：本次不要自动回房，否则返回按钮形同虚设
    const skipResume = sessionStorage.getItem('lobby:skipRoomResume') === '1';
    if (skipResume) sessionStorage.removeItem('lobby:skipRoomResume');
    if (!store.game.player && store.auth.isLoggedIn) {
      socketEvents.getGamePlayer(slug, (player) => {
        store.game.setPlayer(player);
        // 已在游戏中（如掉线/刷新回来、单人快开的临时房未退出）→ 回到对局
        if (player.room_id && !skipResume) {
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

  // 未登录：直接打开游戏地址也只显示登录提示（不渲染房间/战绩等需要身份的内容）
  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入游戏、创建房间或上榜" />;
  }

  return (
    <div className="game-page">
      {/* 游戏页自己的顶栏：大厅 logo/导航不再出现，只有返回 + 游戏名 + 用户区 */}
      <GameHeader
        title={game?.title || slug || '游戏'}
        icon={game?.icon}
        subtitle={isSolo ? '单人挑战' : (variantInfo?.label || '房间对战')}
        close
        onBack={() => {
          // 点 ✕ 回大厅时把当前分同步进排行榜（对局仍在房间里，不影响继续玩）
          syncRoomScore();
          navigate('/lobby');
        }}
      />
      <div className="game-body">
        <div className="game-container">
          {/* 房间玩法：匹配/创建收进一条工具栏，不再挤在标题行 */}
          {!isSolo && (
            <div className="game-toolbar">
              <button className="primary" disabled={local.matching} onClick={handleMatch}>
                {local.matching ? '匹配中…' : '匹配'}
              </button>
              <button
                className="ghost"
                onClick={() => local.setV({ type: 'create', show: true, allowSpectate: true })}
              >创建房间</button>
            </div>
          )}

          {/* 玩法切换（同一游戏多种玩法，如贪吃蛇的无尽/多人） */}
          {variants.length > 1 && (
            <div className="variant-tabs">
              {variants.map(v => (
                <button
                  key={v.key}
                  className={`variant-card ${activeVariant === v.key ? 'active' : ''}`}
                  onClick={() => setActiveVariant(v.key)}
                >
                  <span className="variant-label">{v.label}</span>
                  <span className="variant-desc">{v.desc || (v.mode === 'solo' ? '单人挑战' : '房间对战')}</span>
                </button>
              ))}
            </div>
          )}

          {/* 单人玩法：一键开一局，不走房间 */}
          {isSolo && (
            <div className="solo-start">
              <button className="solo-start-btn" disabled={local.starting} onClick={handleQuickStart}>
                {local.starting ? '正在开局…' : `▶ 开始${variantInfo?.label || '游戏'}`}
              </button>
              <p className="solo-hint">单人模式，无需房间，成绩实时计入{variantInfo?.board === 'endless' ? '无尽榜' : '排行榜'}</p>
            </div>
          )}

          {/* 创建房间模态框（仅房间玩法） */}
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
                {/* 房间列表已下线（改用匹配），私密房没有"被找到"的入口，这里只留公开房设置 */}
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
          <Leaderboard slug={slug as string} limit={5} boards={game?.boards} />
        </div>
      </div>
    </div>
  );
});
