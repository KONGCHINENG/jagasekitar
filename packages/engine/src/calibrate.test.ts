import { describe, expect, it } from 'vitest';
import {
  districtDays,
  eventsFromFlags,
  gridSearch,
  ruleFires,
  scoreRule,
  type DistrictDay,
} from './calibrate';

const day = (
  date: string,
  rainPrev3d: number,
  rainNext1d: number,
  district = 'Kerian',
): DistrictDay => ({
  district,
  date,
  rainPrev3d,
  rainNext1d,
});

describe('ruleFires', () => {
  it('needs both the forecast and the 3-day total above their thresholds', () => {
    const p = { highForecast24hMm: 50, highCumulative3dMm: 100 };
    expect(ruleFires(day('2024-10-12', 120, 60), p)).toBe(true);
    expect(ruleFires(day('2024-10-12', 80, 60), p)).toBe(false);
    expect(ruleFires(day('2024-10-12', 120, 40), p)).toBe(false);
  });
});

describe('scoreRule', () => {
  const p = { highForecast24hMm: 50, highCumulative3dMm: 100 };
  const event = { district: 'Kerian', start: '2024-10-13', end: '2024-10-16' };

  it('counts a hit with lead time when the alert comes before the event', () => {
    const days = [day('2024-10-10', 10, 5), day('2024-10-11', 120, 60), day('2024-10-12', 150, 70)];
    expect(scoreRule(days, [event], p)).toMatchObject({
      hits: 1,
      misses: 0,
      falseAlarms: 0,
      csi: 1,
      meanLeadDays: 2,
      alertDays: 2,
    });
  });

  it('counts a miss when nothing fires, and a false alarm for an unmatched episode', () => {
    const days = [day('2024-10-12', 10, 5), day('2024-08-01', 200, 90), day('2024-08-02', 200, 90)];
    const s = scoreRule(days, [event], p);
    // Two consecutive alert days in August are one false-alarm episode.
    expect(s).toMatchObject({ hits: 0, misses: 1, falseAlarms: 1, csi: 0, far: 1 });
  });

  it('keeps districts apart', () => {
    const days = [day('2024-10-12', 150, 70, 'Kinta')];
    expect(scoreRule(days, [event], p)).toMatchObject({ hits: 0, misses: 1, falseAlarms: 1 });
  });

  it('does not count an alert more than leadDays before the event', () => {
    const days = [day('2024-10-09', 150, 70)];
    expect(scoreRule(days, [event], p, 2)).toMatchObject({ hits: 0, misses: 1, falseAlarms: 1 });
    expect(scoreRule(days, [event], p, 4)).toMatchObject({ hits: 1, falseAlarms: 0 });
  });
});

describe('gridSearch', () => {
  it('prefers the thresholds that catch the event without false alarms', () => {
    const days = [
      day('2024-10-12', 150, 70), // before the real event
      day('2024-06-01', 60, 40), // ordinary wet day
    ];
    const events = [{ district: 'Kerian', start: '2024-10-13', end: '2024-10-14' }];
    const best = gridSearch(days, events, {
      highForecast24hMm: [30, 60, 80],
      highCumulative3dMm: [50, 100],
    })[0]!;
    expect(best.skill).toMatchObject({ hits: 1, falseAlarms: 0, csi: 1 });
    expect(best.params.highForecast24hMm).toBeLessThan(70);
  });
});

describe('districtDays and eventsFromFlags', () => {
  it('builds 3-day windows and next-day rain', () => {
    const series = ['01', '02', '03', '04', '05', '06'].map((d, i) => ({
      date: `2024-10-${d}`,
      rain: i * 10,
    }));
    const days = districtDays('Kerian', series);
    expect(days.map((d) => d.date)).toEqual(['2024-10-04', '2024-10-05']);
    expect(days[0]).toMatchObject({ rainPrev3d: 0 + 10 + 20, rainNext1d: 40 });
  });

  it('merges consecutive flagged days into events', () => {
    expect(
      eventsFromFlags([
        { district: 'Kerian', date: '2024-10-13' },
        { district: 'Kerian', date: '2024-10-14' },
        { district: 'Kerian', date: '2024-11-02' },
        { district: 'Kinta', date: '2024-10-14' },
      ]),
    ).toEqual([
      { district: 'Kerian', start: '2024-10-13', end: '2024-10-14' },
      { district: 'Kerian', start: '2024-11-02', end: '2024-11-02' },
      { district: 'Kinta', start: '2024-10-14', end: '2024-10-14' },
    ]);
  });
});
