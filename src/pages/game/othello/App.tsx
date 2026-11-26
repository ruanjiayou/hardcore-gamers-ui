import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './index';
import Room from './Room';
import Player from './Player';
import Friends from './Friends';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:room_id" element={<Room />} />
      <Route path="/player/:player_id" element={<Player />} />
      <Route path="/friends" element={<Friends />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
