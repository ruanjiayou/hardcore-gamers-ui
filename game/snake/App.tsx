import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './index';
import Room from './Room';
import Player from './Player';
import Friends from './Friends';
import Skins from './Skins';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:room_id" element={<Room />} />
      <Route path="/player/:player_id" element={<Player />} />
      <Route path="/friends" element={<Friends />} />
      <Route path="/skins" element={<Skins />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
