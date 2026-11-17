/** A band of a qualitative meter: values up to `upTo` × max read as `label`. */
export interface MeterBand {
  /** Upper bound of the band as a fraction of max (inclusive), ascending. */
  upTo: number;
  label: string;
}

export function bandOf(ratio: number, bands: readonly MeterBand[]): MeterBand | undefined {
  return bands.find((b) => ratio <= b.upTo) ?? bands[bands.length - 1];
}
