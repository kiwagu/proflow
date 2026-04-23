/** Flatten Fetch headers for Standard Webhooks `verify`. */
export function headerRecord(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
