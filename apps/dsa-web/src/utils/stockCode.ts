/**
 * Normalize stock code by stripping exchange prefixes/suffixes.
 *
 * Mirrors the behavior of data_provider.base.normalize_stock_code in the backend.
 *
 *   600519      → 600519     SH600519    → 600519
 *   600519.SH   → 600519     SH.600519   → 600519
 *   SS600519    → 600519     SS.600519   → 600519
 *   SZ000001    → 000001     000001.SZ   → 000001
 *   BJ920748    → 920748     920748.BJ   → 920748
 *   HK00700     → HK00700    00700       → HK00700
 *   00700.HK    → HK00700    HK.00700    → HK00700
 *   hk1810      → HK01810    1810.HK     → HK01810
 *   7203.T      → 7203.T     005930.KS   → 005930.KS
 *   AAPL        → AAPL       TSLA        → TSLA
 */
export function normalizeStockCode(stockCode: string): string {
  const code = stockCode.trim().normalize('NFKC');
  const upper = code.toUpperCase();

  // Futu provider prefix form (e.g. HK.00700 → HK00700).
  const dottedHkCandidate = upper.match(/^HK\.(\d{1,5})$/)?.[1];
  if (dottedHkCandidate) {
    return `HK${dottedHkCandidate.padStart(5, '0')}`;
  }

  // Normalize HK prefix to a canonical 5-digit form (e.g. hk1810 → HK01810)
  if (upper.startsWith('HK') && !upper.startsWith('HK.')) {
    const candidate = upper.slice(2);
    if (/^\d{1,5}$/.test(candidate) && candidate.length >= 1 && candidate.length <= 5) {
      return `HK${candidate.padStart(5, '0')}`;
    }
  }

  // Pure 5-digit codes are HK stocks by validateStockCode() contract.
  if (/^\d{5}$/.test(upper)) {
    return `HK${upper}`;
  }

  // Strip SH/SS/SZ prefix (e.g. SH600519 or legacy SS600519 → 600519)
  if (
    (upper.startsWith('SH') || upper.startsWith('SS') || upper.startsWith('SZ'))
    && !upper.startsWith('SH.')
    && !upper.startsWith('SS.')
    && !upper.startsWith('SZ.')
  ) {
    const candidate = code.slice(2);
    const prefix = upper.slice(0, 2) === 'SS' ? 'SH' : upper.slice(0, 2);
    if (/^\d{6}$/.test(candidate) && inferCnExchange(candidate) === prefix) {
      return candidate;
    }
  }

  // Strip dotted SH/SS/SZ prefix (e.g. SH.600519 or legacy SS.600519 → 600519)
  if (upper.startsWith('SH.') || upper.startsWith('SS.') || upper.startsWith('SZ.')) {
    const candidate = code.slice(3);
    const rawPrefix = upper.slice(0, 2);
    const prefix = rawPrefix === 'SS' ? 'SH' : rawPrefix;
    if (/^\d{6}$/.test(candidate) && inferCnExchange(candidate) === prefix) {
      return candidate;
    }
  }

  // Strip BJ prefix (e.g. BJ920748 → 920748)
  if (upper.startsWith('BJ') && !upper.startsWith('BJ.')) {
    const candidate = code.slice(2);
    if (/^\d{6}$/.test(candidate) && inferCnExchange(candidate) === 'BJ') {
      return candidate;
    }
  }

  // Strip dotted BJ prefix (e.g. BJ.920748 → 920748)
  if (upper.startsWith('BJ.')) {
    const candidate = code.slice(3);
    if (/^\d{6}$/.test(candidate) && inferCnExchange(candidate) === 'BJ') {
      return candidate;
    }
  }

  // Strip .SH/.SZ/.BJ suffix and .HK suffix with HK-prefix canonicalization
  if (code.includes('.')) {
    const dotIndex = code.lastIndexOf('.');
    const base = code.slice(0, dotIndex);
    const suffix = code.slice(dotIndex + 1).toUpperCase();

    // JP/KR Yahoo suffix-only codes are canonical as uppercase suffix forms.
    if (suffix === 'T' && /^\d{4,5}$/.test(base)) {
      return `${base}.${suffix}`;
    }
    if ((suffix === 'KS' || suffix === 'KQ') && /^\d{6}$/.test(base)) {
      return `${base}.${suffix}`;
    }
    // TW Yahoo suffix-only codes (TWSE `.TW` / TPEx `.TWO`), base 4-6 digits.
    if ((suffix === 'TW' || suffix === 'TWO') && /^\d{4,6}$/.test(base)) {
      return `${base}.${suffix}`;
    }

    // 00700.HK → HK00700
    if (suffix === 'HK' && /^\d{1,5}$/.test(base)) {
      return `HK${base.padStart(5, '0')}`;
    }

    // 600519.SH → 600519
    const exchange = suffix === 'SS' ? 'SH' : suffix;
    if (
      (exchange === 'SH' || exchange === 'SZ' || exchange === 'BJ')
      && /^\d{6}$/.test(base)
      && inferCnExchange(base) === exchange
    ) {
      return base;
    }
  }

  return code;
}

export function inferCnExchange(code: string): 'SH' | 'SZ' | 'BJ' | '' {
  if (!/^\d{6}$/.test(code)) return '';
  if (!code.startsWith('900') && /^(?:92|43|81|82|83|87|88)/.test(code)) return 'BJ';
  return /^[569]/.test(code) ? 'SH' : 'SZ';
}

function stockCodeMatchKey(stockCode: string): string {
  return normalizeStockCode(stockCode).toUpperCase();
}

export function areStockCodesEquivalent(left: string, right: string): boolean {
  if (!left.trim() || !right.trim()) return false;
  return stockCodeMatchKey(left) === stockCodeMatchKey(right);
}

export function findMatchingStockCode(codes: string[], stockCode: string): string | undefined {
  if (!stockCode.trim()) return undefined;
  const targetKey = stockCodeMatchKey(stockCode);
  return codes.find((code) => code.trim() && stockCodeMatchKey(code) === targetKey);
}

export function includesStockCode(codes: string[], stockCode: string): boolean {
  return findMatchingStockCode(codes, stockCode) !== undefined;
}
