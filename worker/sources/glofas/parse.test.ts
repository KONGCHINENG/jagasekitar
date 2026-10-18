// Parser tests against a real Open-Meteo Flood API response saved on 2026-10-18 (two points:
// near Ipoh and in Kerian), plus small crafted inputs.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exceededPeriod, median, parseReturnPeriods, parseRiverFlow, quantile } from './parse';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

const point = (q: (number | null)[], start = '2026-10-10') => ({
  latitude: 5,
  longitude: 100.5,
  daily: {
    time: q.map((_, i) =>
      new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
    ),
    river_discharge: q,
  },
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('parseRiverFlow', () => {
  it('parses the live response for two gauges', () => {
    const flows = parseRiverFlow(fixture('flood-2026-10-18.json'), ['A', 'B'], '2026-10-18');
    expect(flows.map((f) => f.stationId)).toEqual(['A', 'B']);
    for (const f of flows) {
      expect(f.baselineMedian).toBeGreaterThan(0);
      expect(f.peakDate >= '2026-10-18' && f.peakDate <= '2026-10-21').toBe(true);
      expect(f.ratio).toBeCloseTo(f.peak / f.baselineMedian, 1);
      expect(f.series.length).toBeGreaterThan(90);
    }
    // Kerian's river carries far more water than the Kinta cell near Ipoh.
    expect(flows[1]!.baselineMedian).toBeGreaterThan(flows[0]!.baselineMedian * 5);
  });

  it('takes the peak within the lookahead window only', () => {
    // Past 8 days at 10, then today 12, +1 40, +2 15, +3 11, +4 999 (outside the window).
    const json = JSON.stringify(point([10, 10, 10, 10, 10, 10, 10, 10, 12, 40, 15, 11, 999]));
    const [f] = parseRiverFlow(json, ['S'], '2026-10-18');
    expect(f).toMatchObject({ baselineMedian: 10, peak: 40, peakDate: '2026-10-19', ratio: 4 });
  });

  it('skips points with no usable baseline and keeps the station order', () => {
    const json = JSON.stringify([
      point([0, 0, 0, 0, 0, 0, 0, 0, 5]),
      point([2, 2, 2, 2, 2, 2, 2, 2, 3]),
    ]);
    expect(parseRiverFlow(json, ['dry', 'ok'], '2026-10-18').map((f) => f.stationId)).toEqual([
      'ok',
    ]);
  });

  it('fails loudly when the point count does not match', () => {
    expect(() => parseRiverFlow(JSON.stringify([point([1])]), ['a', 'b'], '2026-10-18')).toThrow();
  });
});

describe('return periods', () => {
  // 20 full years where year k (0-based) peaks at 10 + k m³/s.
  const history = () => {
    const time: string[] = [];
    const q: number[] = [];
    for (let k = 0; k < 20; k++) {
      for (let d = 0; d < 365; d++) {
        time.push(new Date(Date.UTC(2000 + k, 0, 1) + d * 86_400_000).toISOString().slice(0, 10));
        q.push(d === 200 ? 10 + k : 1);
      }
    }
    return { latitude: 5, longitude: 100.5, daily: { time, river_discharge: q } };
  };

  it('takes quantiles of the annual maxima', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const [rp] = parseReturnPeriods(JSON.stringify([history()]), 1);
    expect(rp).toEqual({ rp2: 19.5, rp5: 25.2, rp20: 28.05, years: 20 });
  });

  it('needs at least ten years of record', () => {
    const short = history();
    short.daily.time = short.daily.time.slice(0, 365 * 9);
    short.daily.river_discharge = short.daily.river_discharge.slice(0, 365 * 9);
    expect(parseReturnPeriods(JSON.stringify([short]), 1)).toEqual([null]);
  });

  it('grades the forecast peak by the highest return period it reaches', () => {
    const rp = { rp2: 20, rp5: 25, rp20: 30, years: 20 };
    expect(exceededPeriod(19, rp)).toBe(0);
    expect(exceededPeriod(20, rp)).toBe(2);
    expect(exceededPeriod(26, rp)).toBe(5);
    expect(exceededPeriod(31, rp)).toBe(20);
    expect(exceededPeriod(999, null)).toBe(0);
    const json = JSON.stringify(point([10, 10, 10, 10, 10, 10, 10, 10, 12, 26, 15, 11]));
    expect(parseRiverFlow(json, ['S'], '2026-10-18', 3, [rp])[0]).toMatchObject({
      peak: 26,
      ratio: 1.3,
      exceeded: 5,
    });
  });
});
