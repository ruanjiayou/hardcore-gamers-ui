import React from 'react';
import { mountEntry } from '../../src/bootstrap/entry';
import { gameManager } from '../../src/core/GameManager';
import { gameUrl } from '../../src/navigation';
import GameApp from './App';

const slug = 'snake';

gameManager.registerLoader('snake', () => import('../../src/games/snake'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
