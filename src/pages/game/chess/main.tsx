import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = 'chess';

gameManager.registerLoader('chess', () => import('../../../games/chess'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
