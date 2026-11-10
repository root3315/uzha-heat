import { describe, expect, it } from 'vitest';
import type { CityDetail, EnergyMethod, Fluxes } from '../data/contract';
import {
  cellFluxes,
  cityEnergy,
  cityEnergyLine,
  dominantSurface,
  energyCaveat,
  energyView,
  evaporativeFraction,
  fluxVerdict,
  greenComparison,
  greenestTenth,
  meanFluxes,
  sinkShares,
  storageLine,
} from './energy';

const SURFACES = [
  { key: 'asphalt', label: 'Асфальт', heatCapacity: 1.94, conductivity: 0.75, admittance: 1205 },
  { key: 'concrete', label: 'Бетон', heatCapacity: 2.11, conductivity: 1.51, admittance: 1785 },
  { key: 'dry_soil', label: 'Сухой грунт', heatCapacity: 1.28, conductivity: 0.3, admittance: 620 },
  { key: 'wet_soil', label: 'Влажная почва', heatCapacity: 2.96, conductivity: 2.2, admittance: 2550 },
];

const METHOD: EnergyMethod = {
  localHour: 11,
  solarWm2: 799,
  airC: 32,
  humidityPct: 31,
  longwaveDownWm2: 395,
  hotAnchorC: 52.5,
  coldAnchorC: 32.4,
  mean: { sAbs: 627, rn: 455, g: 103, h: 189, le: 163 },
  surfaces: SURFACES,
};

/** Ten cells from hot and bare to cool and green; the hottest tenth starts at 54°, the greenest at NDVI 0.7. */
function city(withEnergy = true): CityDetail {
  const lst = [55, 50, 48, 46, 44, 42, 40, 38, 36, 34];
  const ndvi = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7];
  const rn = [380, 400, 420, 440, 450, 460, 480, 500, 510, 520];
  const g = [110, 108, 106, 104, 100, 95, 90, 80, 70, 60];
  const le = [0, 20, 50, 80, 120, 160, 220, 280, 340, 380];
  return {
    stats: { lstMean: 43.3, lstMin: 34, lstMax: 55, lstP10: 35.8, lstP90: 54 },
    cells: {
      lst,
      values: { ndvi, built: [90, 80, 70, 60, 50, 40, 30, 20, 10, 0], bare: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      shap: {},
      energy: withEnergy
        ? { sAbs: rn.map((v) => v + 200), rn, g, le, h: rn.map((v, i) => v - (g[i] ?? 0) - (le[i] ?? 0)) }
        : undefined,
    },
    energy: withEnergy ? METHOD : null,
  } as unknown as CityDetail;
}

/** Russian formatting puts no-break spaces in numbers and before units; tests read plain spaces. */
const plain = (text: string | null | undefined): string => (text ?? '').replace(/ /g, ' ');

const balance = (rn: number, g: number, le: number): Fluxes => ({ sAbs: rn + 200, rn, g, h: rn - g - le, le });

describe('per-cell and mean fluxes', () => {
  it('reads one cell and averages several, whole W/m²', () => {
    expect(cellFluxes(city(), 0)).toEqual({ sAbs: 580, rn: 380, g: 110, h: 270, le: 0 });
    expect(meanFluxes(city(), [0, 1])).toEqual({ sAbs: 590, rn: 390, g: 109, h: 271, le: 10 });
  });

  it('is null without the energy step or without cells', () => {
    expect(cellFluxes(city(false), 0)).toBeNull();
    expect(meanFluxes(city(), [])).toBeNull();
  });

  it('takes the greenest tenth by NDVI', () => {
    expect(greenestTenth(city())).toEqual([9]);
  });
});

describe('where the sunlight goes', () => {
  it('splits net radiation into shares that add up to one', () => {
    const shares = sinkShares(balance(500, 100, 300));
    expect(shares.le + shares.h + shares.g).toBeCloseTo(1);
    expect(shares.le).toBeCloseTo(0.6);
  });

  it('says it plainly, by the evaporative fraction', () => {
    expect(evaporativeFraction(balance(400, 100, 30))).toBeCloseTo(0.1);
    expect(fluxVerdict(balance(400, 100, 0))).toContain('испаряться нечему');
    expect(fluxVerdict(balance(400, 100, 90))).toContain('Испаряется мало');
    expect(fluxVerdict(balance(400, 100, 150))).toContain('поровну');
    expect(fluxVerdict(balance(500, 60, 380))).toContain('на испарение');
  });

  it('compares the air heating with the greenest cells', () => {
    expect(plain(greenComparison(balance(400, 100, 0), balance(500, 60, 380)))).toBe(
      'Воздух здесь греется в 5,0 раза сильнее, чем на самых зелёных участках города: 300 Вт/м² против 60 Вт/м².',
    );
    expect(greenComparison(balance(500, 60, 370), balance(500, 60, 380))).toContain('Почти как на самых зелёных');
  });
});

describe('heat storage', () => {
  it('finds what covers most of the cell', () => {
    expect(dominantSurface({ built: 60, bare: 10 })).toBe('built');
    expect(dominantSurface({ built: 10, bare: 70 })).toBe('bare');
    expect(dominantSurface({ built: 10, bare: 5 })).toBe('green');
    expect(dominantSurface({ ndvi: 0.3 })).toBeNull();
  });

  it('explains the evening with numbers from the reference table', () => {
    expect(plain(storageLine('built', SURFACES))).toContain('1 205 и 1 785 против 620');
    expect(storageLine('bare', SURFACES)).toContain('остывает быстрее');
    expect(plain(storageLine('green', SURFACES))).toContain('2 550');
    expect(storageLine('built', [])).toBeNull();
  });
});

describe('the block and the city summary', () => {
  it('puts the verdict, the comparison, the storage line and the caveat together', () => {
    const detail = city();
    const view = energyView(detail, cellFluxes(detail, 0), { built: 90, bare: 10 });
    expect(view?.verdict).toContain('испаряться нечему');
    expect(view?.comparison).toContain('сильнее');
    expect(view?.storage).toContain('Асфальт и бетон');
    expect(view?.caveat).toBe(energyCaveat(METHOD));
    expect(view?.caveat).toContain('около 11:00');
    expect(view?.caveat).not.toMatch(/[—–]/);
    expect(energyView(city(false), null, {})).toBeNull();
  });

  it('sets the hottest tenth, the city and the greenest tenth side by side', () => {
    const summary = cityEnergy(city());
    expect(summary?.hot.le).toBe(0);
    expect(summary?.mean).toEqual(METHOD.mean);
    expect(summary?.green.le).toBe(380);
    expect(cityEnergy(city(false))).toBeNull();
  });

  it('says the city summary in one sentence', () => {
    const summary = cityEnergy(city());
    expect(summary && plain(cityEnergyLine('Ташкент', summary))).toBe(
      'Самые горячие участки Ташкента отдают воздуху 270 Вт/м², самые зелёные 80 Вт/м²: на испарение у первых уходит 0 % энергии, у вторых 73 %.',
    );
  });
});
