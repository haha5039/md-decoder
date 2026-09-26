import { validateCards } from './data.js';
const DB_NAME = 'MDDecoderDB';
const STORE_NAME = 'cards_store';
// Ignore old caches whose API frames were overwritten from unreliable type labels.
const KEY_NAME = 'cards_data_v2';
const LEGACY_KEY_NAME = 'cards_data';

function transaction(mode, action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; reject(new Error('카드 저장소 연결 시간이 초과되었습니다.')); }, 4000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (timedOut) { db.close(); return; }
      db.onversionchange = () => db.close();
      let tx, operation;
      try {
        tx = db.transaction(STORE_NAME, mode);
        operation = action(tx.objectStore(STORE_NAME));
      } catch (error) { db.close(); reject(error); return; }
      // Success means committed, not merely that the put request was accepted.
      tx.oncomplete = () => { db.close(); resolve(operation.result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || operation.error || new Error('카드 저장 실패')); };
    };
  });
}
export async function getCachedCards() {
  const cards = await transaction('readonly', store => store.get(KEY_NAME));
  return cards ? validateCards(cards) : null;
}
export function saveCachedCards(cards) {
  validateCards(cards);
  return transaction('readwrite', store => store.put(cards, KEY_NAME));
}
export function clearCachedCards() {
  return transaction('readwrite', store => {
    store.delete(LEGACY_KEY_NAME);
    return store.delete(KEY_NAME);
  });
}
