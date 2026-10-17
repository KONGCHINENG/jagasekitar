'use client';
// 14-day daily bars, one series: no legend (the card title names it), hover tooltip per bar,
// 4px rounded tops on a shared baseline, 2px gaps, recessive axis, and a table for screen readers.
// Bar colours validated with the dataviz palette checker: #BE185D on light, #EC4899 on dark.
import { useState } from 'react';

export interface DayCount {
  date: string; // YYYY-MM-DD
  confirmed: number;
  suspected: number;
}

const W = 560;
const H = 160;
const PAD = { top: 12, right: 8, bottom: 24, left: 28 };

export function DailyBars({ days }: { days: DayCount[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.confirmed));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const barW = Math.max(4, slot - 2); // 2px surface gap between bars
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;
  const label = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-MY', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const h = hover != null ? days[hover] : null;

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Confirmed cases reported per day, last 14 days"
      >
        {[0, niceMax / 2, niceMax].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-neutral-200 dark:stroke-neutral-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-neutral-500 text-[10px]"
            >
              {v}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const top = y(d.confirmed);
          const height = PAD.top + plotH - top;
          const r = Math.min(4, barW / 2, height);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target taller and wider than the bar. */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              {d.confirmed > 0 && (
                <path
                  d={`M${x},${PAD.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD.top + plotH} Z`}
                  className={`fill-[#BE185D] dark:fill-[#EC4899] ${hover === i ? 'opacity-100' : hover != null ? 'opacity-50' : ''}`}
                />
              )}
              {(i === 0 || i === days.length - 1 || i % 7 === 0) && (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-neutral-500 text-[10px]"
                >
                  {label(d.date)}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="stroke-neutral-300 dark:stroke-neutral-700"
        />
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <div className="font-semibold">{label(h.date)}</div>
          <div>{h.confirmed} confirmed</div>
          <div className="text-neutral-500">{h.suspected} suspected</div>
        </div>
      )}
      <table className="sr-only">
        <caption>Cases reported per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Confirmed</th>
            <th>Suspected</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.confirmed}</td>
              <td>{d.suspected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
