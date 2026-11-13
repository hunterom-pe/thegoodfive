import type { Category } from './types'

export const CATEGORIES: Record<Category, { label: string; short: string }> = {
  humanity: { label: 'People & Humanity', short: 'Humanity' },
  health: { label: 'Health & Medicine', short: 'Health' },
  science: { label: 'Science & Discovery', short: 'Science' },
  nature: { label: 'Nature & Wildlife', short: 'Nature' },
  progress: { label: 'Global Progress', short: 'Progress' },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]
