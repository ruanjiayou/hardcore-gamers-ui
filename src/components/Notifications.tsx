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