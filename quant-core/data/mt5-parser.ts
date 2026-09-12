import { Candle } from './contracts.js';

function normalizeHeader(value: string): string {
  return value.replace(/[<>]/g, '').trim().toUpperCase();
}

function requireColumn(headers: readonly string[], name: string): number {
  const index = headers.indexOf(name);
  if (index < 0) throw new Error(`MISSING_COLUMN_${name}`);
  return index;
}

function optionalColumn(headers: readonly string[], name: string): number | null {
  const index = headers.indexOf(name);
  return index < 0 ? null : index;
}

function parseNumber(value: string, field: string, row: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`INVALID_${field}_ROW_${row}`);
  return parsed;
}

export function parseMt5TabCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error('EMPTY_MT5_CSV');

  const headers = lines[0]!.split('\t').map(normalizeHeader);
  const dateIdx = requireColumn(headers, 'DATE');
  const timeIdx = requireColumn(headers, 'TIME');
  const openIdx = requireColumn(headers, 'OPEN');
  const highIdx = requireColumn(headers, 'HIGH');
  const lowIdx = requireColumn(headers, 'LOW');
  const closeIdx = requireColumn(headers, 'CLOSE');
  const tickVolIdx = optionalColumn(headers, 'TICKVOL');
  const volIdx = optionalColumn(headers, 'VOL');
  const spreadIdx = optionalColumn(headers, 'SPREAD');

  const candles: Candle[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const rowNumber = lineIndex + 1;
    const parts = lines[lineIndex]!.split('\t');
    const date = parts[dateIdx]?.trim().replace(/\./g, '-');
    const time = parts[timeIdx]?.trim();
    if (!date || !time) throw new Error(`INVALID_TIMESTAMP_ROW_${rowNumber}`);
    const timestamp = Date.parse(`${date}T${time}Z`);
    if (!Number.isFinite(timestamp)) throw new Error(`INVALID_TIMESTAMP_ROW_${rowNumber}`);

    const base = {
      time: timestamp,
      open: parseNumber(parts[openIdx] ?? '', 'OPEN', rowNumber),
      high: parseNumber(parts[highIdx] ?? '', 'HIGH', rowNumber),
      low: parseNumber(parts[lowIdx] ?? '', 'LOW', rowNumber),
      close: parseNumber(parts[closeIdx] ?? '', 'CLOSE', rowNumber),
    };

    const candle: Candle = {
      ...base,
      ...(tickVolIdx === null ? {} : { tickVolume: parseNumber(parts[tickVolIdx] ?? '', 'TICKVOL', rowNumber) }),
      ...(volIdx === null ? {} : { volume: parseNumber(parts[volIdx] ?? '', 'VOL', rowNumber) }),
      ...(spreadIdx === null ? {} : { spread: parseNumber(parts[spreadIdx] ?? '', 'SPREAD', rowNumber) }),
    };
    candles.push(candle);
  }
  return candles;
}
