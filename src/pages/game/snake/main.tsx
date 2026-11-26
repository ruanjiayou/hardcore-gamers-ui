import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = 'snake';

gameManager.registerLoader('snake', () => import('../../../games/snake'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
