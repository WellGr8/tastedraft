/** Browser origins allowed to call the API. Comma-separated. No wildcard. */
export function corsAllowlist(env: Record<string, string | undefined>): string[] {
  const raw = env.CORS_ORIGINS?.trim();
  const source = raw && raw.length
    ? raw
    : 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787,http://127.0.0.1:8787';
  return [...new Set(source.split(',').map((item) => item.trim()).filter(Boolean))];
}
