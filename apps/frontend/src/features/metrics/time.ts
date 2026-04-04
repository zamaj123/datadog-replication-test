export function getDefaultEnd() {
  return new Date().toISOString();
}

export function getDefaultStart() {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}
