export const HELPER_URL = "http://127.0.0.1:3185";

export async function refreshCloudUsage({fetchFn=fetch,minimumGeneratedAt=null,onProgress=()=>{},syncMac=false}={}) {
  let syncedGeneration = null;
  if (syncMac) {
    onProgress('Collecting and syncing this Mac...');
    let response;
    try { response = await fetchFn(`${HELPER_URL}/sync-cloud`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(300000)}); }
    catch { throw new Error('This Mac’s collector is unavailable. Open the dashboard on your configured Mac to sync new activity. Cloud history is unchanged.'); }
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(result.detail || result.error || 'Sync did not finish. Cloud history was kept.');
    if (!Number.isFinite(Date.parse(result.generated_at))) throw new Error('Sync did not confirm a collection date.');
    syncedGeneration = result.generated_at;
  }
  onProgress('Refreshing cloud history...');
  const snapshot = await loadPublishedSnapshot({fetchFn});
  if (syncedGeneration && Date.parse(snapshot.generated_at) < Date.parse(syncedGeneration)) throw new Error('The cloud has not returned the newly synced collection. Refresh again; your previous view was kept.');
  if (minimumGeneratedAt && Date.parse(snapshot.generated_at) < Date.parse(minimumGeneratedAt)) throw new Error('The cloud returned older data. Your newer view has been kept.');
  return {snapshot,source:'cloud',rebuilt:syncMac,message:syncMac ? 'New activity synced to the cloud. Ready to present.' : 'Latest saved history loaded. Sync this Mac to add new local activity.'};
}

async function jsonRequest(url, { fetchFn, timeout = 12000, method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchFn(url, { method, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function validateSnapshot(snapshot) {
  if (snapshot?.counting_version !== 3 || !Array.isArray(snapshot.sessions) ||
      !Number.isFinite(new Date(snapshot.generated_at).getTime())) {
    throw new Error("This snapshot needs the corrected counting update. The last good view has been kept.");
  }
  return snapshot;
}

export async function loadPublishedSnapshot({ fetchFn = fetch, snapshotUrl = "./data/usage-snapshot.json", now = Date.now } = {}) {
  const separator = snapshotUrl.includes("?") ? "&" : "?";
  return validateSnapshot(await jsonRequest(`${snapshotUrl}${separator}t=${now()}`, { fetchFn, timeout: 30000 }));
}

export async function refreshUsage({ fetchFn = fetch, snapshotUrl = "./data/usage-snapshot.json",
  helperUrl = HELPER_URL, publish = false, onProgress = () => {}, now = Date.now,
  minimumGeneratedAt = null, minimumCollectionRevision = 0 } = {}) {
  let reachable = false;
  let collectorVersion = null;
  let collectionRevision = 0;
  try {
    const status = await jsonRequest(`${helperUrl}/status?t=${now()}`, { fetchFn, timeout: 2500 });
    reachable = status.ok === true;
    collectorVersion = status.counting_version;
    collectionRevision = status.collection_revision || 0;
  } catch { /* Hosted viewers may not have the local collector. Never imply their logs were read. */ }
  if (!reachable) {
    onProgress("Checking published data...");
    const snapshot = await loadPublishedSnapshot({ fetchFn, snapshotUrl, now });
    if (minimumGeneratedAt && new Date(snapshot.generated_at) < new Date(minimumGeneratedAt)) {
      throw new Error("The shared snapshot is older than the data on screen. Keeping your newer count.");
    }
    return { snapshot, source: "published", rebuilt: false, published: false,
      message: "Latest published data loaded. The local collector is unavailable, so no new logs were collected." };
  }
  if (collectorVersion !== 3) throw new Error("The local collector needs the counting update. It has not been used to overwrite your data.");
  if (collectionRevision < minimumCollectionRevision) throw new Error("Restart the local collector to enable GPT-6 pricing and preserved history. Your current data has been kept.");
  onProgress(publish ? "Recounting and publishing..." : "Recounting usage...");
  const result = await jsonRequest(`${helperUrl}/refresh?publish=${publish ? 1 : 0}`, { fetchFn, method: "POST", timeout: 300000 });
  if (result.ok !== true) throw new Error(result.detail || "The refresh did not finish. The last good view has been kept.");
  onProgress("Loading the new count...");
  const snapshot = validateSnapshot(await jsonRequest(`${helperUrl}/snapshot?t=${now()}`, { fetchFn, timeout: 30000 }));
  if (new Date(snapshot.generated_at) < new Date(result.generated_at)) throw new Error("The collector returned an older snapshot. The last good view has been kept.");
  if (minimumGeneratedAt && new Date(snapshot.generated_at) < new Date(minimumGeneratedAt)) throw new Error("The refreshed snapshot is older than the data already on screen.");
  return { snapshot, source: "collector", rebuilt: true, published: result.published === true,
    message: result.published ? "Fresh usage loaded. The shared site will receive it when publishing completes."
      : "Fresh usage loaded from this Mac. This is a local refresh, not a new shared-site snapshot." };
}
