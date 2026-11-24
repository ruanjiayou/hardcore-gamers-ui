import React, { useEffect } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import { getSocket, socketEvents } from '../services/socket';
import store from '../stores'
import constant from '../constant';

/**
 * 玩家列表：
 * - 玩家标记（你 / 机 / 观）紧跟在昵称后面，样式统一用 badge
 * - 观战者优先显示「观」，不再叠加「你」「机」
 * - 转让入口已移除：房主离开由服务端自动转让给非人机玩家
 * - showAddRobot 时标题右侧显示「添加人机」按钮（房主等待态、非单人对局）
 * - 「✉ 邀请」按钮已移除：邀请入口改到房间页操作区，且只在房间（未开局）可用（UI-055）
 */
export const PlayerList = observer(({
  room_id,
  showAddRobot = false,
  onAddRobot,
}: {
  room_id: string;
  showAddRobot?: boolean;
  onAddRobot?: () => void;
}) => {
  const reload = () => {
    socketEvents.getRoomDetail(room_id, (data) => {
      store.room.setCurrentRoom(data.room)
    });
  }
  const kickOut = (room_id: string, player_id: string) => {
    socketEvents.excute('room:kick-player', { room_id, player_id }, (success: boolean) => {
      if (success) reload();
    })
  }
  const kicked = (data: { player_id: string }) => {
    const member = store.room.roomInfo.members.find((m: any) => m._id === data.player_id);
    if (member) {
      store.room.addMessage({ player_id: member._id, player_name: "系统", message: `玩家 ${member.nickname} 被踢出房间` })
      store.room.setCurrentRoom({ ...store.room.roomInfo, members: store.room.roomInfo.members.filter((m: any) => m._id !== data.player_id) })
    }
  }
  useEffect(() => {
    reload()
    const socket = getSocket();
    if (socket) {
      socket.on('room:player-kicked', kicked);
    }
    return () => {
      if (socket) {
        socket.off('room:player-kicked', kicked);
      }
    }
  }, [])

  const ownerId = store.room.roomInfo?.owner_id;
  const isOwner = store.game.player_id === ownerId;
  const isOfficialRoom = !!store.room.roomInfo?.official;
  const canKick = isOwner && store.room.roomInfo?.status === constant.ROOM.STATUS.waiting;

  return (
    <Observer>{() => (
      <div className="player-list" style={{ flex: '1 0 30%' }}>
        <h3>
          <span>👥 玩家列表 <span onClick={() => { reload(); }}>↻</span></span>
          <span className="player-list-actions">
            {showAddRobot && (
              <button className="player-add-robot" onClick={onAddRobot} title="添加人机">＋ 人机</button>
            )}
          </span>
        </h3>
        {store.room.members.map((player: any) => {
          const isViewer = player.member_type === 'viewer';
          const isRobot = player.type === 'robot';
          const isMe = store.game.player_id === player._id;
          // 观战优先：观战者一律显示「观」，不再叠加你/机
          const tag = isViewer ? '观' : isRobot ? '机' : isMe ? '你' : '';
          // 团队模式：座位上带队伍名，展示在昵称前（红队/蓝队…）
          const team = player.team as string | undefined;
          return (
            <div key={player._id} className="player-item">
              <span className="avatar">👤</span>
              <span className="name">
                {team && <span className="badge team">{team}</span>}
                {player.nickname || '玩家'}
                {tag && <span className="badge">{tag}</span>}
                {/* 官方房只有临时房主（SB-039），标出来免得误以为能解散/踢人到底 */}
                {player._id === ownerId && (
                  <span className="badge owner">{isOfficialRoom ? '临时房主' : '房主'}</span>
                )}
              </span>
              {/* 私有房主不可被踢（要转让或解散，SB-039）；官方房只有临时房主，可以踢 */}
              {canKick && !isMe && !(player._id === ownerId && !isOfficialRoom) && (
                <span className='danger' onClick={() => kickOut(room_id, player._id)}>踢出</span>
              )}
            </div>
          );
        })}
      </div>
    )}
    </Observer>
  );
});
