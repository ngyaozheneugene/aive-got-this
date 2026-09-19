// Desk chrome tokens. Plain inline styles; the desk has no CSS framework and
// the browser must never compute anything the read models already carry.
import type { CSSProperties } from 'react';

export const ink = '#161410';
export const paper = '#f4f1ea';
export const line = '#d8d2c4';
export const navy = '#16325c';
export const good = '#1f6b3b';
export const warn = '#8a5a00';
export const bad = '#8c2f21';

export const card: CSSProperties = {
  border: `1px solid ${line}`,
  borderRadius: 8,
  background: '#fffdf8',
  padding: 16,
};

export const label: CSSProperties = {
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontSize: 11,
  color: '#6b6455',
};

export const primaryBtn: CSSProperties = {
  border: `1px solid ${navy}`,
  background: navy,
  color: '#fff',
  borderRadius: 6,
};

export const ghostBtn: CSSProperties = {
  border: `1px solid ${line}`,
  background: '#fffdf8',
  color: ink,
  borderRadius: 6,
};

export function badge(kind: 'good' | 'warn' | 'bad' | 'muted'): CSSProperties {
  const map = {
    good: { bg: '#e4f0e8', fg: good },
    warn: { bg: '#f5ecd6', fg: warn },
    bad: { bg: '#f3e0dc', fg: bad },
    muted: { bg: '#ece8dd', fg: '#6b6455' },
  }[kind];
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: map.bg,
    color: map.fg,
  };
}
