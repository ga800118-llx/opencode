export const MODEL_LIST_EAGER_LIMIT = 200

export function modelGroupExpanded(input: {
  resultCount: number
  searching: boolean
  collapsed?: boolean
}) {
  const bounded = input.resultCount <= MODEL_LIST_EAGER_LIMIT
  if (input.searching && bounded) return true
  if (input.collapsed !== undefined) return !input.collapsed
  return bounded
}
