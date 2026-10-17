/**
 * A size somebody can judge at a glance, in the reader's own numbering.
 *
 * Two units rather than one: a folder of screenshots is megabytes and the
 * answer for three of them is not "0 MB", which reads as a bug rather than as a
 * small number. `Intl` carries the unit and the decimal separator, so neither
 * is spelled out in a translation that would then have to be kept in step.
 */
export function fileSize(bytes: number): string {
  const kilobytes = bytes / 1024

  return kilobytes < 1024
    ? new Intl.NumberFormat(undefined, {
        style: 'unit',
        unit: 'kilobyte',
        maximumFractionDigits: 0
      }).format(kilobytes)
    : new Intl.NumberFormat(undefined, {
        style: 'unit',
        unit: 'megabyte',
        maximumFractionDigits: 1
      }).format(kilobytes / 1024)
}
