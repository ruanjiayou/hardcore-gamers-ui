import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = 'gomoku';

gameManager.registerLoader('gomoku', () => import('../../../games/gomoku'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
