import React, { useEffect, useMemo, useState } from 'react';
import { getReplay, type ReplayData } from '../services/api';
import { flattenBoard } from '../core/replay';
import '../styles/replay.css';

/**
 * 对局回放（UI-047）：棋类游戏的对局记录可以逐帧回看。
 *
 * 帧数据来自服务端 `movements[].board`（每次落子后的棋盘快照），
 * 所以前端只负责把棋盘画出来，不需要重放各游戏的规则。
 * 老对局没有快照时退化成只显示终局棋盘。
 */

export function ReplayBoard({ slug, board }: { slug: string; board: any }) {
  const { cols, cells } = useMemo(() => flattenBoard(slug, board), [slug, board]);
  return (
    <div
      className={`replay-board replay-${slug}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {cells.map((cell, i) => (
        <div className="replay-cell" key={i}>
          {cell.dot
            ? <span className="replay-disc" style={{ background: cell.color }} />
            : cell.label
              ? <span className="replay-piece" style={{ color: cell.color }}>{cell.label}</span>
              : null}
        </div>
      ))}
    </div>
  );
}

export default function ReplayModal({ match_id, onClose }: { match_id: string, onClose: () => void }) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    getReplay(match_id).then(res => {
      if (!alive) return;
      if (res.data.code === 0) {
        setData(res.data.data);
        // 从第一帧开始（有回放就播过程，没有就直接显示终局）
        setStep(0);
      } else {
        setError(res.data.message || '回放加载失败');
      }
    }).catch(() => alive && setError('回放加载失败'));
    return () => { alive = false; };
  }, [match_id]);

  // frames 为空（老对局没存快照）时只有一帧：终局棋盘
  const frames = useMemo(() => {
    if (!data) return [];
    return data.frames.length ? data.frames : [{ index: 0, board: data.final_board, at: 0 }];
  }, [data]);
  const last = Math.max(0, frames.length - 1);

  useEffect(() => {
    if (!playing) return;
    if (step >= last) { setPlaying(false); return; }
    const timer = setTimeout(() => setStep(s => Math.min(last, s + 1)), 900);
    return () => clearTimeout(timer);
  }, [playing, step, last]);

  const current = frames[Math.min(step, last)];

  return (
    <div className="replay-overlay" onMouseDown={onClose}>
      <div className="replay-panel" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="对局回放">
        <div className="replay-head">
          <h3>🎬 对局回放</h3>
          <button className="replay-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {error && <p className="replay-error">{error}</p>}
        {!error && !data && <p className="replay-loading">加载中…</p>}

        {data && (
          <>
            <div className="replay-players">
              {data.players.map(p => (
                <span key={p._id} className={p.is_winner ? 'winner' : ''}>
                  {p.nickname || '玩家'}{p.is_winner ? ' 🏆' : ''}
                </span>
              ))}
            </div>

            <ReplayBoard slug={data.game_id} board={current?.board} />

            <div className="replay-controls">
              <button onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0}>⏮</button>
              <button onClick={() => { setPlaying(false); setStep(s => Math.max(0, s - 1)); }} disabled={step === 0}>◀</button>
              <button
                className="replay-play"
                onClick={() => setPlaying(p => !p)}
                disabled={last === 0}
              >{playing ? '⏸ 暂停' : '▶ 播放'}</button>
              <button onClick={() => { setPlaying(false); setStep(s => Math.min(last, s + 1)); }} disabled={step >= last}>▶</button>
              <button onClick={() => { setPlaying(false); setStep(last); }} disabled={step >= last}>⏭</button>
            </div>
            <p className="replay-progress">
              第 {Math.min(step, last) + 1} / {frames.length} 步
              {!data.frames.length && '（该对局未保存逐手快照，仅显示终局）'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
