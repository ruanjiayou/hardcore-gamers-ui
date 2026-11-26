import React from 'react';
import { useParams } from 'react-router-dom';
import PlayerProfile from '../../src/components/PlayerProfile';

export default function Player() {
  const { player_id } = useParams<{ player_id: string }>();
  return <PlayerProfile slug="gomoku" playerId={player_id!} />;
}
