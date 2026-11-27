import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { SendoutEvent, socketEvents } from '../services/socket';

export const Chat = observer(({ room_id }: { room_id: string }) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (!message.trim()) return;
    socketEvents.excute(SendoutEvent.SendMessage, { room_id, message }, (success: boolean) => {
      if (success) {
        setMessage('');
      }
    });
  };

  // UI-103：高度交给 CSS 的 .chat / .chat-panel，消息区自己滚，输入框固定底部
  return (
    <div className="chat chat-panel">
      <h3>💬 聊天</h3>
      <div className="messages">
        {store.room.messages.map((msg, idx) => (
          <div key={idx} className="message">
            <strong data-player-id={msg.player_id}>{msg.player_name}:</strong> {msg.message}
          </div>
        ))}
      </div>
      <div className="input-group">
        <input
          type="text"
          placeholder="输入消息..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        />
        <button onClick={handleSend}>发送</button>
      </div>
    </div>
  );
});