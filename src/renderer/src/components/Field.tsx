/**
 * A labelled form row.
 *
 * Shared between settings and the project dialog so the two do not drift into
 * looking like different applications.
 */
export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1.5 font-medium">{label}</p>
      {children}
      {hint !== undefined && (
        <p className="text-ink-faint mt-1.5 max-w-lg leading-relaxed">{hint}</p>
      )}
    </div>
  )
}
