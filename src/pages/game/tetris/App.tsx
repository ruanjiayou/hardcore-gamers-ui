import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './index';
import Play from './Play';
import Player from './Player';
import Me from './Me';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:room_id" element={<Play />} />
      <Route path="/me" element={<Me />} />
      <Route path="/player/:player_id" element={<Player />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
