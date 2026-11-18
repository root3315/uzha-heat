/** Russian grammar the Russian texts need; English sentences never call these. */

/** Genitive of a city name, for "в черте Ташкента". Covers the usual endings. */
export function genitive(name: string): string {
  const last = name.slice(-1);
  const stem = name.slice(0, -1);
  if (last === 'а') return /[гкхжшщч]$/.test(stem) ? `${stem}и` : `${stem}ы`;
  if (last === 'я') return `${stem}и`;
  if (/[бвгджзклмнпрстфхцчшщ]/.test(last)) return `${name}а`;
  return name;
}

/** Prepositional of a city name, for "в Бухаре", "в Ташкенте". Covers the usual endings. */
export function locative(name: string): string {
  if (/[ая]$/.test(name)) return `${name.slice(0, -1)}е`;
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return `${name}е`;
  return name;
}
