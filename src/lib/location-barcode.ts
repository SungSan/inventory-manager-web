const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;

const CHOSEONG_KEYS = [
  "r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g",
] as const;
const JUNGSEONG_KEYS = [
  "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l",
] as const;
const JONGSEONG_KEYS = [
  "", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g",
] as const;

const COMPATIBILITY_JAMO_KEYS: Readonly<Record<string, string>> = {
  "ㄱ": "r", "ㄲ": "R", "ㄳ": "rt", "ㄴ": "s", "ㄵ": "sw", "ㄶ": "sg", "ㄷ": "e", "ㄸ": "E",
  "ㄹ": "f", "ㄺ": "fr", "ㄻ": "fa", "ㄼ": "fq", "ㄽ": "ft", "ㄾ": "fx", "ㄿ": "fv", "ㅀ": "fg",
  "ㅁ": "a", "ㅂ": "q", "ㅃ": "Q", "ㅄ": "qt", "ㅅ": "t", "ㅆ": "T", "ㅇ": "d", "ㅈ": "w",
  "ㅉ": "W", "ㅊ": "c", "ㅋ": "z", "ㅌ": "x", "ㅍ": "v", "ㅎ": "g",
  "ㅏ": "k", "ㅐ": "o", "ㅑ": "i", "ㅒ": "O", "ㅓ": "j", "ㅔ": "p", "ㅕ": "u", "ㅖ": "P",
  "ㅗ": "h", "ㅘ": "hk", "ㅙ": "ho", "ㅚ": "hl", "ㅛ": "y", "ㅜ": "n", "ㅝ": "nj", "ㅞ": "np",
  "ㅟ": "nl", "ㅠ": "b", "ㅡ": "m", "ㅢ": "ml", "ㅣ": "l",
};

function keyForModernJamo(char: string): string | undefined {
  const code = char.codePointAt(0);
  if (code === undefined) return undefined;

  if (code >= 0x1100 && code <= 0x1112) return CHOSEONG_KEYS[code - 0x1100];
  if (code >= 0x1161 && code <= 0x1175) return JUNGSEONG_KEYS[code - 0x1161];
  if (code >= 0x11a8 && code <= 0x11c2) return JONGSEONG_KEYS[code - 0x11a7];
  return undefined;
}

export function containsHangul(value: string): boolean {
  return HANGUL_PATTERN.test(value);
}

export function convertHangulToQwerty(value: string): string {
  return Array.from(value).map((char) => {
    const compatibility = COMPATIBILITY_JAMO_KEYS[char];
    if (compatibility) return compatibility;

    const modern = keyForModernJamo(char);
    if (modern) return modern;

    const code = char.codePointAt(0);
    if (code === undefined || code < 0xac00 || code > 0xd7a3) return char;

    const syllableIndex = code - 0xac00;
    const choseongIndex = Math.floor(syllableIndex / 588);
    const jungseongIndex = Math.floor((syllableIndex % 588) / 28);
    const jongseongIndex = syllableIndex % 28;
    return `${CHOSEONG_KEYS[choseongIndex]}${JUNGSEONG_KEYS[jungseongIndex]}${JONGSEONG_KEYS[jongseongIndex]}`;
  }).join("");
}

function applySanLocationHyphens(value: string): string {
  const compact = value.replace(/-/g, "");
  const match = compact.match(/^([A-Z]\d[A-Z]?)(\d{2})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}-${match[4]}` : value;
}

export function normalizeLocationBarcodeInput(rawValue: string): string {
  const compact = rawValue.normalize("NFKC").replace(/[\s\r\n\t]+/g, "");
  const qwerty = convertHangulToQwerty(compact).toUpperCase();
  return applySanLocationHyphens(qwerty);
}

export function isValidLocationBarcodeFormat(value: string): boolean {
  return /^[A-Z]\d[A-Z]?-\d{2}-\d{2}-\d{2}$/.test(normalizeLocationBarcodeInput(value));
}
