// ============================================================
// Bnerd: who may show wacrm in a frame.
//
// These headers live in the middleware rather than next.config because
// `headers()` there is fixed at build time, while FRAME_ANCESTORS is a
// runtime setting. Unset, wacrm keeps upstream's refusal to be framed.
// ============================================================

/** The valid `https://host[:port]` origins in a comma-separated list. */
export function parseFrameAncestors(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => {
      try {
        const url = new URL(entry);
        return /^https?:$/.test(url.protocol) && url.origin === entry && !entry.includes('*');
      } catch {
        return false;
      }
    });
}

export function frameHeaders(origins: string[]): Record<string, string> {
  if (origins.length === 0) return { 'X-Frame-Options': 'DENY' };

  const quoted = origins.map((origin) => `"${origin}"`).join(' ');
  return {
    'Content-Security-Policy': `frame-ancestors 'self' ${origins.join(' ')}`,
    // Voice notes need the microphone inside the frame too.
    'Permissions-Policy': `camera=(), microphone=(self ${quoted}), geolocation=(), payment=(), usb=()`,
  };
}
