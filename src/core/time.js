// Calendar helpers. Historical dates are stored as decimal astronomical years
// (2032.5 = mid-2032, 0 = 1 BC, -8999 = 9000 BC) so ranges, errors and
// interpolation are simple arithmetic.

export const DAYS_PER_YEAR = 365.2425;
export const HOURS_PER_YEAR = DAYS_PER_YEAR * 24; // 8765.82

const MONTHS = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Absolute day numbers run continuously across years (day = floor(year * 365.2425)),
// so the time of day never jumps at New Year. Calendar months ignore leap days.
const yearStartDay = year => Math.floor(year * DAYS_PER_YEAR);

/** Builds a decimal year from a calendar date (approximate, no leap-year detail). */
export function dateToYear(year, month = 1, day = 1, hour = 0) {
  let doy = day - 1;
  for (let m = 0; m < month - 1; m++) doy += MONTH_DAYS[m];
  return (yearStartDay(year) + doy + hour / 24) / DAYS_PER_YEAR;
}

export function splitDate(decimalYear) {
  const abs = decimalYear * DAYS_PER_YEAR;
  const absDay = Math.floor(abs);
  let year = Math.floor(decimalYear);
  let doy = absDay - yearStartDay(year);
  if (doy < 0) { year -= 1; doy = absDay - yearStartDay(year); }
  doy = Math.min(doy, 364);
  let month = 0;
  while (month < 11 && doy >= MONTH_DAYS[month]) { doy -= MONTH_DAYS[month]; month++; }
  const hourFloat = (abs - absDay) * 24;
  return { year, month: month + 1, day: doy + 1, hour: Math.floor(hourFloat), minute: Math.floor((hourFloat % 1) * 60), hourFloat };
}

export function hourOfDay(decimalYear) {
  const abs = decimalYear * DAYS_PER_YEAR;
  return (abs - Math.floor(abs)) * 24;
}

/** Absolute day index, used to seed daily weather. */
export function dayIndex(decimalYear) {
  return Math.floor(decimalYear * DAYS_PER_YEAR);
}

export function formatYear(year) {
  return year <= 0 ? `Kr. e. ${1 - year}` : String(year);
}

export function formatDate(decimalYear, withTime = true) {
  const d = splitDate(decimalYear);
  const base = `${formatYear(d.year)}. ${MONTHS[d.month - 1]} ${d.day}.`;
  return withTime ? `${base} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}` : base;
}
