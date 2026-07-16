'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animates a numeric value from its previous displayed value (0 on first
 * mount) up to `value` using requestAnimationFrame with an ease-out cubic
 * curve. Respects prefers-reduced-motion (renders the final value with no
 * animation). Guards against NaN/undefined by rendering an em dash.
 */
export function CountUp({
  value,
  format,
  duration = 900,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const isValid = typeof value === 'number' && !Number.isNaN(value);
  const [display, setDisplay] = useState<number>(0);
  const displayRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!isValid) return;

    const from = mountedRef.current ? displayRef.current : 0;
    mountedRef.current = true;

    const commit = (n: number) => {
      displayRef.current = n;
      setDisplay(n);
    };

    if (prefersReducedMotion()) {
      commit(value);
      return;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const start = performance.now();
    const delta = value - from;

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, duration <= 0 ? 1 : elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      commit(from + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration, isValid]);

  const combinedClassName = `count-tabular${className ? ` ${className}` : ''}`;

  if (!isValid) {
    return <span className={combinedClassName}>{'—'}</span>;
  }

  const rounded = Math.round(display);
  const text = format ? format(rounded) : rounded.toLocaleString();

  return <span className={combinedClassName}>{text}</span>;
}

/**
 * One-shot mount entrance wrapper. Applies the `.reveal` utility class
 * (see app/globals.css) with an optional stagger delay.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const combinedClassName = `reveal${className ? ` ${className}` : ''}`;
  return (
    <div className={combinedClassName} style={{ animationDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}

/**
 * Shimmering placeholder block. Pass `circle` for avatar-shaped placeholders.
 */
export function Skeleton({
  width,
  height = 14,
  radius,
  circle,
  style,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  circle?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const combinedClassName = `skeleton${circle ? ' skeleton-circle' : ''}${className ? ` ${className}` : ''}`;
  return (
    <div
      className={combinedClassName}
      style={{
        width,
        height,
        ...(radius !== undefined ? { borderRadius: radius } : {}),
        ...style,
      }}
    />
  );
}

const DEFAULT_SKELETON_TEXT_WIDTHS: (number | string)[] = ['100%', '92%', '74%'];

/**
 * Stack of shimmering text-line placeholders. Widths cycle through
 * `widths` (default ['100%','92%','74%']) if there are more lines than
 * widths provided.
 */
export function SkeletonText({
  lines = 3,
  widths,
  gap = 10,
}: {
  lines?: number;
  widths?: (number | string)[];
  gap?: number;
}) {
  const widthList = widths && widths.length > 0 ? widths : DEFAULT_SKELETON_TEXT_WIDTHS;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => {
        const w = widthList[i % widthList.length];
        return <div key={i} className="skeleton skeleton-text" style={{ width: w }} />;
      })}
    </div>
  );
}

/**
 * Card-shaped skeleton placeholder (matches `.card` sizing tokens) with a
 * 3-line SkeletonText body.
 */
export function SkeletonCard({
  height = 120,
  style,
}: {
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        background: 'var(--white)',
        padding: 16,
        minHeight: height,
        ...style,
      }}
    >
      <SkeletonText lines={3} />
    </div>
  );
}
