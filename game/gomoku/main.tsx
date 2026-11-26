import React from 'react';
import { mountEntry } from '../../src/bootstrap/entry';
import { gameManager } from '../../src/core/GameManager';
import { gameUrl } from '../../src/navigation';
import GameApp from './App';

const slug = 'gomoku';

gameManager.registerLoader('gomoku', () => import('../../src/games/gomoku'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
