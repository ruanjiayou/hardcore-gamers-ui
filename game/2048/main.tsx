import React from 'react';
import { mountEntry } from '../../src/bootstrap/entry';
import { gameManager } from '../../src/core/GameManager';
import { gameUrl } from '../../src/navigation';
import GameApp from './App';

const slug = '2048';

gameManager.registerLoader('2048', () => import('../../src/games/2048'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
