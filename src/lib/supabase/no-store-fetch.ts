export const noStoreFetch: typeof fetch = (input, init) => {
  return fetch(input, { ...init, cache: 'no-store' })
}
