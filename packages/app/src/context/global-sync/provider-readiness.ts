export function providerQueryReady(query: { isSuccess: boolean; isFetching: boolean }) {
  return query.isSuccess && !query.isFetching
}
