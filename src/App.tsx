import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { LoginPage } from './pages/Login'
import { LobbyPage } from './pages/Lobby';
import { ProfilePage } from './pages/Profile';
import { UserProfilePage } from './pages/UserProfile';
import './styles/index.css';

/** 公共入口路由：只保留用户侧页面，游戏页由各游戏入口自己挂载。 */
export const App = observer(() => (
  <Routes>
    <Route path="/" element={<LobbyPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/me" element={<ProfilePage />} />
    <Route path="/user/:user_id" element={<UserProfilePage />} />
    <Route path="*" element={<Navigate to="/" />} />
  </Routes>
));

export default App;
