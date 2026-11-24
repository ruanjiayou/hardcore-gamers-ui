import React, { useState, useEffect } from 'react';
import '../styles/notifications.css';

export interface NotificationMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

class NotificationManager {
  private listeners: Array<(notifications: NotificationMessage[]) => void> = [];
  private notifications: NotificationMessage[] = [];
  /** 同一条消息的重复出现时间戳：message+type → 上次出现时刻 */
  private lastShown = new Map<string, number>();

  subscribe(listener: (notifications: NotificationMessage[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(listener => listener([...this.notifications]));
  }

  show(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration = 3000) {
    // 同一条消息短时间内重复出现时不叠加：
    // 页面反复触发同一个提示（如"已离开房间"）时，堆一屏相同的提示既吵又挡视线。
    // 3 秒内的重复只把已有那条的过期时间往后延。
    const key = `${type}|${message}`;
    const now = Date.now();
    const last = this.lastShown.get(key) || 0;
    if (now - last < 3000) {
      const existing = this.notifications.find(n => n.message === message && n.type === type);
      if (existing) {
        existing.duration = duration;
        this.notify();
        return existing.id;
      }
    }
    this.lastShown.set(key, now);

    const id = `${Date.now()}-${Math.random()}`;
    const notification: NotificationMessage = { id, message, type, duration };

    this.notifications.push(notification);
    this.notify();

    if (duration > 0) {
      setTimeout(() => {
        this.remove(id);
      }, duration);
    }

    return id;
  }

  remove(id: string) {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.notify();
  }

  clear() {
    this.notifications = [];
    this.notify();
  }
}

export const notificationManager = new NotificationManager();

export const Notifications: React.FC = () => {
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);

  useEffect(() => {
    const unsubscribe = notificationManager.subscribe(setNotifications);
    return unsubscribe;
  }, []);

  return (
    <div className="notifications-container">
      {notifications.map(notification => (
        <div key={notification.id} className={`notification notification-${notification.type}`}>
          <div className="notification-content">
            {notification.type === 'success' && <span className="icon">✓</span>}
            {notification.type === 'error' && <span className="icon">✕</span>}
            {notification.type === 'info' && <span className="icon">ℹ</span>}
            {notification.type === 'warning' && <span className="icon">⚠</span>}
            <span className="message">{notification.message}</span>
          </div>
          <button
            className="close-btn"
            onClick={() => notificationManager.remove(notification.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};