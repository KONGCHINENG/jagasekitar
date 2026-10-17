// Plain-language, bilingual advice per hazard level and per disease.
// Wording follows general public-health guidance; it is not medical advice.
import type { Advice, RiskLevel } from '@jagasekitar/shared';
import { atLeast } from '@jagasekitar/shared';

const HAZE: [RiskLevel, Advice][] = [
  [
    'low',
    {
      en: 'Sensitive groups (children, elderly, asthma) should limit long outdoor activity.',
      ms: 'Golongan sensitif (kanak-kanak, warga emas, asma) perlu mengehadkan aktiviti luar yang lama.',
    },
  ],
  [
    'moderate',
    { en: 'Wear an N95 mask outdoors.', ms: 'Pakai pelitup N95 apabila berada di luar.' },
  ],
  [
    'moderate',
    {
      en: 'Keep windows closed; use an air purifier if you have one.',
      ms: 'Tutup tingkap; gunakan penapis udara jika ada.',
    },
  ],
  [
    'high',
    {
      en: 'Avoid outdoor exercise and keep children indoors.',
      ms: 'Elakkan senaman di luar dan biarkan kanak-kanak di dalam rumah.',
    },
  ],
  [
    'severe',
    {
      en: 'Stay indoors. Seek medical help if you have difficulty breathing.',
      ms: 'Kekal di dalam rumah. Dapatkan rawatan jika sukar bernafas.',
    },
  ],
];

const FLOOD: [RiskLevel, Advice][] = [
  [
    'low',
    {
      en: 'Watch rainfall and JPS Public Infobanjir updates.',
      ms: 'Pantau hujan dan kemas kini Public Infobanjir JPS.',
    },
  ],
  [
    'moderate',
    {
      en: 'Avoid low-lying roads, riverbanks and drains.',
      ms: 'Elakkan jalan rendah, tebing sungai dan longkang.',
    },
  ],
  [
    'high',
    {
      en: 'Prepare an emergency bag; move vehicles and valuables to higher ground.',
      ms: 'Sediakan beg kecemasan; alihkan kenderaan dan barang berharga ke tempat tinggi.',
    },
  ],
  [
    'high',
    {
      en: 'Never drive or walk through floodwater.',
      ms: 'Jangan memandu atau berjalan meredah air banjir.',
    },
  ],
  [
    'severe',
    {
      en: 'Follow evacuation orders from the authorities. Emergency: call 999.',
      ms: 'Patuhi arahan pemindahan pihak berkuasa. Kecemasan: hubungi 999.',
    },
  ],
];

const DISEASE: Record<string, Advice> = {
  DENGUE: {
    en: 'Use mosquito repellent and remove stagnant water around your home.',
    ms: 'Gunakan penghalau nyamuk dan buang air bertakung di sekitar rumah.',
  },
  LEPTO: {
    en: 'Avoid wading in floodwater; wear boots and cover cuts.',
    ms: 'Elakkan meredah air banjir; pakai but dan tutup luka.',
  },
  CHOLERA: {
    en: 'Drink boiled or bottled water and wash hands with soap.',
    ms: 'Minum air masak atau air botol dan basuh tangan dengan sabun.',
  },
  TYPHOID: {
    en: 'Drink boiled or bottled water and wash hands with soap.',
    ms: 'Minum air masak atau air botol dan basuh tangan dengan sabun.',
  },
  DIARR: {
    en: 'Drink boiled or bottled water and wash hands with soap.',
    ms: 'Minum air masak atau air botol dan basuh tangan dengan sabun.',
  },
  HFMD: {
    en: "Wash children's hands often and keep sick children at home.",
    ms: 'Kerap basuh tangan kanak-kanak dan biarkan kanak-kanak yang sakit di rumah.',
  },
  ILI: {
    en: 'Wear a mask in crowded places; see a doctor if symptoms persist.',
    ms: 'Pakai pelitup di tempat sesak; jumpa doktor jika gejala berterusan.',
  },
  ARI: {
    en: 'Wear a mask in crowded places; see a doctor if symptoms persist.',
    ms: 'Pakai pelitup di tempat sesak; jumpa doktor jika gejala berterusan.',
  },
  COVID19: {
    en: 'Wear a mask in crowded places; see a doctor if symptoms persist.',
    ms: 'Pakai pelitup di tempat sesak; jumpa doktor jika gejala berterusan.',
  },
  CONJ: {
    en: "Don't rub your eyes and avoid sharing towels.",
    ms: 'Jangan gosok mata dan elakkan berkongsi tuala.',
  },
};

const GENERIC_DISEASE: Advice = {
  en: 'Practise good hygiene and see a doctor if you feel unwell.',
  ms: 'Amalkan kebersihan dan jumpa doktor jika tidak sihat.',
};

export function hazeAdvice(level: RiskLevel): Advice[] {
  return level === 'none' ? [] : HAZE.filter(([min]) => atLeast(level, min)).map(([, a]) => a);
}

export function floodAdvice(level: RiskLevel): Advice[] {
  return level === 'none' ? [] : FLOOD.filter(([min]) => atLeast(level, min)).map(([, a]) => a);
}

export function diseaseAdvice(codes: string[]): Advice[] {
  return codes.length ? codes.map((c) => DISEASE[c] ?? GENERIC_DISEASE) : [];
}

/** Remove duplicates (several diseases share the same advice). */
export function uniqueAdvice(list: Advice[]): Advice[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.en) ? false : (seen.add(a.en), true)));
}
