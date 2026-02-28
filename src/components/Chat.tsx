import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import store from '../stores'
import { socketEvents } from '../services/socket';

export const Chat = observer(({ roomId }: { roomId: string }) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (!message.trim()) return;

    socketEvents.sendMessage(roomId, message, (success) => {
      if (success) {
        setMessage('');
      }
    });
  };

  return (
    <div className="chat">
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