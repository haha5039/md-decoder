const DB_NAME = 'MDDecoderDB';
const DB_VERSION = 1;
const STORE_NAME = 'cards_store';
const KEY_NAME = 'cards_data';

export function getCachedCards() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getReq = store.get(KEY_NAME);
      
      getReq.onsuccess = () => {
        resolve(getReq.result || null);
      };
      getReq.onerror = () => {
        reject(getReq.error);
      };
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

export function saveCachedCards(cards) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const putReq = store.put(cards, KEY_NAME);
      
      putReq.onsuccess = () => {
        resolve();
      };
      putReq.onerror = () => {
        reject(putReq.error);
      };
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}
