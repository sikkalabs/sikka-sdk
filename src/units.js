export const CHILLAR_PER_SIKKA = 1_000_000n;
export const SIKKA_DECIMALS = 6;

export function sikkaToChillar(sikka) {
  if (typeof sikka === 'bigint') {
    return sikka * CHILLAR_PER_SIKKA;
  }

  const str = String(sikka).trim();
  if (!str || isNaN(Number(str))) {
    throw new Error(`Invalid Sikka amount: ${sikka}`);
  }

  if (Number(str) < 0) {
    throw new Error(`Sikka amount cannot be negative: ${str}`);
  }

  const parts = str.split('.');
  if (parts.length > 2) {
    throw new Error(`Invalid Sikka number format: ${str}`);
  }

  let wholeStr = parts[0] || '0';
  let fracStr = parts[1] || '';

  if (fracStr.length > SIKKA_DECIMALS) {
    throw new Error(`Sikka amount exceeds maximum precision of ${SIKKA_DECIMALS} decimal places: ${str}`);
  }

  fracStr = fracStr.padEnd(SIKKA_DECIMALS, '0');
  const totalStr = wholeStr + fracStr;
  return BigInt(totalStr);
}

export function chillarToSikka(chillar, format = 'string') {
  const chillarBig = BigInt(chillar);
  const isNegative = chillarBig < 0n;
  const absVal = isNegative ? -chillarBig : chillarBig;

  const whole = absVal / CHILLAR_PER_SIKKA;
  const frac = absVal % CHILLAR_PER_SIKKA;

  let fracStr = frac.toString().padStart(SIKKA_DECIMALS, '0');
  fracStr = fracStr.replace(/0+$/, '');

  let resStr = whole.toString();
  if (fracStr.length > 0) {
    resStr += '.' + fracStr;
  }
  if (isNegative && resStr !== '0') {
    resStr = '-' + resStr;
  }

  if (format === 'number') {
    return Number(resStr);
  }

  return resStr;
}

export const toChillar = sikkaToChillar;
export const toSikka = chillarToSikka;
export const fromChillar = chillarToSikka;
export const fromSikka = sikkaToChillar;
