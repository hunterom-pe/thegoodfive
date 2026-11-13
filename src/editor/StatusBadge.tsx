import type { EditionStatus } from '../lib/types'

const STYLE: Record<EditionStatus, { label: string; box: string; dot: string }> = {
  draft: { label: 'Draft', box: 'border-earth/60 text-earth', dot: 'border border-earth' },
  review: { label: 'In review', box: 'border-sage bg-mist text-forest', dot: 'bg-sage' },
  published: { label: 'Published', box: 'border-forest bg-forest text-chalk', dot: 'bg-blush' },
}

export function StatusBadge({ status }: { status: EditionStatus }) {
  const s = STYLE[status]
  return (
    <span className={`label inline-flex items-center gap-2 border px-2 py-1.5 ${s.box}`}>
      <span className={`size-1.5 ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  )
}

const STEPS: EditionStatus[] = ['draft', 'review', 'published']

/** Draft → Review → Published, as three squares. */
export function StatusSteps({ status }: { status: EditionStatus }) {
  const at = STEPS.indexOf(status)
  return (
    <ol className="flex items-center gap-2" aria-label={`Status: ${STYLE[status].label}`}>
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          {i > 0 && <span className={`h-px w-4 sm:w-8 ${i <= at ? 'bg-forest' : 'bg-line'}`} aria-hidden="true" />}
          <span className={`size-2.5 border border-forest ${i <= at ? 'bg-forest' : ''}`} aria-hidden="true" />
          <span className={`label ${i === at ? 'text-forest' : 'text-ink/45'}`}>{STYLE[step].label}</span>
        </li>
      ))}
    </ol>
  )
}
