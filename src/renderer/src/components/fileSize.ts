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
  const megabytes = kilobytes / 1024

  // Gigabytes too, for the memory the status bar reports: "3 172,4 MB" is a
  // number to read, "3,1 GB" one to see.
  if (kilobytes < 1024) return inUnit(kilobytes, 'kilobyte', 0)
  if (megabytes < 1024) return inUnit(megabytes, 'megabyte', 1)
  return inUnit(megabytes / 1024, 'gigabyte', 1)
}

function inUnit(value: number, unit: string, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, { style: 'unit', unit, maximumFractionDigits }).format(
    value
  )
}
