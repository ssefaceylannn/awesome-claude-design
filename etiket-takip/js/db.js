/*
 * IndexedDB katmanı. Tüm veriler tarayıcıda saklanır (1 yıllık veri için
 * localStorage'ın 5 MB sınırı yetmediğinden IndexedDB kullanılır).
 *
 *  orders  : { id, orderNo, store, platform, date, items[], applied[], batchId, ... }
 *  batches : { id, importedAt, files[], newCount, dupCount, ... }
 *  kv      : { key, value }  → ayarlar, kampanyalar, ürün sırası, ürün adları
 */
(function (root) {
  'use strict';
  const DB_NAME = 'etiket-takip';
  const DB_VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('orders')) {
          const os = db.createObjectStore('orders', { keyPath: 'id' });
          os.createIndex('date', 'date');
          os.createIndex('orderNo', 'orderNo');
          os.createIndex('cargoCode', 'cargoCode');
          os.createIndex('batchId', 'batchId');
        }
        if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      Promise.resolve(fn(t)).then((v) => { out = v; }, (e) => { try { t.abort(); } catch (_) {} reject(e); });
    });
  }

  const DB = {
    async get(store, key) { return tx([store], 'readonly', (t) => wrap(t.objectStore(store).get(key))); },
    async getAll(store) { return tx([store], 'readonly', (t) => wrap(t.objectStore(store).getAll())); },
    async put(store, val) { return tx([store], 'readwrite', (t) => wrap(t.objectStore(store).put(val))); },
    async putMany(store, vals) {
      return tx([store], 'readwrite', (t) => { const os = t.objectStore(store); vals.forEach((v) => os.put(v)); });
    },
    async del(store, key) { return tx([store], 'readwrite', (t) => wrap(t.objectStore(store).delete(key))); },
    async delMany(store, keys) {
      return tx([store], 'readwrite', (t) => { const os = t.objectStore(store); keys.forEach((k) => os.delete(k)); });
    },
    async clear(store) { return tx([store], 'readwrite', (t) => wrap(t.objectStore(store).clear())); },
    async byIndex(store, index, value) {
      return tx([store], 'readonly', (t) => wrap(t.objectStore(store).index(index).getAll(value)));
    },
    /** Tarih aralığındaki siparişler (YYYY-MM-DD, iki uç dahil) */
    async ordersBetween(from, to) {
      return tx(['orders'], 'readonly', (t) => wrap(t.objectStore('orders').index('date').getAll(IDBKeyRange.bound(from, to))));
    },
    /** Belirtilen tarihten eski siparişleri sil, silinen adedi döndür */
    async pruneBefore(date) {
      return tx(['orders'], 'readwrite', (t) => new Promise((res, rej) => {
        let n = 0;
        const req = t.objectStore('orders').index('date').openCursor(IDBKeyRange.upperBound(date, true));
        req.onsuccess = () => { const c = req.result; if (c) { c.delete(); n++; c.continue(); } else res(n); };
        req.onerror = () => rej(req.error);
      }));
    },
    /** Mağazadaki her kayıt için fn(kayıt) çağır (hepsini belleğe almadan) */
    async forEach(store, fn) {
      return tx([store], 'readonly', (t) => new Promise((res, rej) => {
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { fn(c.value); c.continue(); } else res(); };
        req.onerror = () => rej(req.error);
      }));
    },
    async kvGet(key, def) { const r = await DB.get('kv', key); return r ? r.value : def; },
    async kvSet(key, value) { return DB.put('kv', { key, value }); },
  };

  root.DB = DB;
})(window);
