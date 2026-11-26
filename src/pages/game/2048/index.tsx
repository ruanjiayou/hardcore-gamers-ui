import React, { useEffect } from 'react';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { toJS } from 'mobx';
import store from '../../../stores';
import { getSocket, ReceiveEvent, SendoutEvent, socketEvents, syncRoomScore } from '../../../services/socket';
import { loadGameAssets } from '../../../services/assets';
import { Leaderboard } from '../../../components/Leaderboard';
import { LoginRequiredPanel } from '../../../components/LoginRequired';
import { GameHeader } from '../../../components/GameHeader';
import { GameSettings } from '../../../components/GameSettings';
import { gameUrl, go, lobbyUrl } from '../../../navigation';
import '../../../styles/index.css';
import '../../../styles/game.css';

const slug = '2048' as const;

/** 单人游戏主页：一键开局 + 排行榜 + 设置（无好友、匹配与房间列表）。 */
export const GamePage = observer(() => {
  const local = useLocalObservable(() => ({
    starting: false,
    showBoard: false,
    setV(o: object) {
      for (const k in o) {
        // @ts-ignore
        local[k] = (o as any)[k];
      }
    },
  }));

  const game = store.game.games.find(g => g.slug === slug);

  const onPlayerChange = (data: { player_id: string, field: string, value: any }) => {
    store.game.changePlayer(data);
    store.room.changePlayer(data);
  };
  // 单人主页不展示房间列表，保留订阅以维持原有的事件联动
  const onRoomEvent = () => {};
  const socket = getSocket();

  useEffect(() => {
    if (!socket) return;
    store.audio.setGame(slug);
    loadGameAssets(slug);
    if (!store.game.games.length) {
      socketEvents.excute(SendoutEvent.LobbyGames, (games: any) => {
        store.game.setGames(games);
      });
    }
    const skipResume = sessionStorage.getItem('lobby:skipRoomResume') === '1';
    if (skipResume) sessionStorage.removeItem('lobby:skipRoomResume');
    if (store.auth.isLoggedIn) {
      socketEvents.getGamePlayer(slug, player => {
        if (!player) return;
        store.game.setPlayer(player);
        // 回房前确认房间还在，避免脏指针造成来回弹窗
        const roomId = player?.room_id;
        if (roomId && !skipResume) {
          socketEvents.getRoomDetail(roomId, (detail: any) => {
            if (detail?.room) {
              go(gameUrl(slug, '/room/' + roomId));
            } else {
              store.game.setPlayer({ ...toJS(player), room_id: '', state: 'online' });
            }
          });
        }
      });
    }
    socket.on(ReceiveEvent.RoomCreated, onRoomEvent);
    socket.on(ReceiveEvent.PlayerChange, onPlayerChange);
    socket.on(ReceiveEvent.PlayerJoined, onRoomEvent);
    socket.on(ReceiveEvent.PlayerLeaved, onRoomEvent);
    return () => {
      socket.off(ReceiveEvent.RoomCreated, onRoomEvent);
      socket.off(ReceiveEvent.PlayerChange, onPlayerChange);
      socket.off(ReceiveEvent.PlayerJoined, onRoomEvent);
      socket.off(ReceiveEvent.PlayerLeaved, onRoomEvent);
    };
  }, [slug]);

  if (!store.auth.isLoggedIn) {
    return <LoginRequiredPanel title="需要登录" desc="登录后才能进入游戏或上榜" />;
  }

  /** 单人快开：服务端建临时房并立即开局 */
  const handleQuickStart = () => {
    if (!store.auth.isLoggedIn) {
      store.ui.openLoginPrompt('登录后才能开始游戏');
      return;
    }
    if (local.starting) return;
    local.setV({ starting: true });
    socketEvents.quickStart(slug, undefined, (success, data, message) => {
      local.setV({ starting: false });
      if (success && data?.room_id) {
        go(gameUrl(slug, '/room/' + data.room_id));
      } else {
        alert(message || '开始游戏失败');
      }
    });
  };

  return (
    <div className="game-page">
      <GameHeader
        title={game?.title || slug}
        subtitle="单人挑战"
        mode="game"
        profileGame={slug}
        center={
          <button className="game-header-center-btn" onClick={() => local.setV({ showBoard: true })}>
            <span className="game-header-center-icon" aria-hidden>🏆</span><span>排行榜</span>
          </button>
        }
        extra={<GameSettings game={slug} />}
        onBack={() => {
          syncRoomScore();
          go(lobbyUrl());
        }}
      />
      <div className="game-body">
        <div className="game-container">
          <div className="solo-start">
            <button className="solo-start-btn" disabled={local.starting} onClick={handleQuickStart}>
              {local.starting ? '正在开局…' : '▶ 开始游戏'}
            </button>
            <p className="solo-hint">单人模式，无需房间，成绩实时计入排行榜</p>
          </div>
        </div>
      </div>

      {local.showBoard && (
        <div className="modal" onMouseDown={() => local.setV({ showBoard: false })}>
          <div className="modal-content board-modal" onMouseDown={e => e.stopPropagation()}>
            <button className="settings-close" onClick={() => local.setV({ showBoard: false })} aria-label="关闭">×</button>
            <Leaderboard slug={slug} limit={10} boards={game?.boards} />
          </div>
        </div>
      )}
    </div>
  );
});

export default GamePage;
