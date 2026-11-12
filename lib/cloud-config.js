export function validateCloudConfiguration(config) {
  let url;
  try { url = new URL(config?.url); } catch { throw new Error('Set a valid HTTPS dashboard URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS dashboard origin without credentials, path, query, or fragment.');
  }
  if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('A sync token of at least 32 characters is required.');
  if (config.site_access_token != null && typeof config.site_access_token !== 'string') throw new Error('Invalid optional access token.');
  return {...config, url: url.origin};
}
