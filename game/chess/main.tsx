import React from 'react';
import { mountEntry } from '../../src/bootstrap/entry';
import { gameManager } from '../../src/core/GameManager';
import { gameUrl } from '../../src/navigation';
import GameApp from './App';

const slug = 'chess';

gameManager.registerLoader('chess', () => import('../../src/games/chess'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
