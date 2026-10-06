// Armazenamento do SITE (navegador). O Helper nunca grava nada; tudo que precisa
// persistir (presets, cache de offsets) fica aqui, no IndexedDB do próprio site.
//
// Banco "gerenciador" (mesmo nome do site antigo, para manter os presets):
//   v1 (site antigo): dumpMeta, dumpFlags, presets, history, cache
//   v2 (este site):   presets, datasets
// A v2 apaga os stores de dumps importados/histórico — eram da seleção manual de
// versão, que não existe mais.

const DB_NAME = 'gerenciador';
const DB_VERSION = 2;
const LEGACY_DBS = ['fflag-manager'];
export type StoreName = 'presets' | 'datasets';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('Falha no IndexedDB'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transação abortada'));
    tx.onerror = () => reject(tx.error ?? new Error('Erro na transação'));
  });
}

export interface KV {
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put<T>(store: StoreName, value: T): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** false = sem IndexedDB: os dados duram só enquanto a aba estiver aberta. */
  readonly persistent: boolean;
}

class IdbKV implements KV {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}
  getAll<T>(store: StoreName) {
    return req(this.db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
  }
  get<T>(store: StoreName, key: string) {
    return req(this.db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
  }
  async put<T>(store: StoreName, value: T) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await done(tx);
  }
  async delete(store: StoreName, key: string) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
  }
}

/** Sem IndexedDB (aba anônima restrita etc.): funciona, mas só nesta sessão. */
export class MemoryKV implements KV {
  readonly persistent = false;
  private stores: Record<StoreName, Map<string, unknown>> = { presets: new Map(), datasets: new Map() };
  private keyOf(store: StoreName, v: unknown) {
    const o = v as { id?: string; version?: string };
    return String(store === 'datasets' ? o.version : o.id);
  }
  async getAll<T>(store: StoreName) { return [...this.stores[store].values()].map((v) => structuredClone(v)) as T[]; }
  async get<T>(store: StoreName, key: string) { const v = this.stores[store].get(key); return v === undefined ? undefined : (structuredClone(v) as T); }
  async put<T>(store: StoreName, value: T) { this.stores[store].set(this.keyOf(store, value), structuredClone(value)); }
  async delete(store: StoreName, key: string) { this.stores[store].delete(key); }
}

export async function openStorage(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<KV> {
  if (!idb) return new MemoryKV();
  try {
    const open = idb.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const old of ['dumpMeta', 'dumpFlags', 'history', 'cache']) {
        if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
      }
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'version' });
    };
    const db = await req(open);
    for (const name of LEGACY_DBS) {
      try { idb.deleteDatabase(name); } catch { /* sem efeito colateral relevante */ }
    }
    return new IdbKV(db);
  } catch {
    return new MemoryKV();
  }
}

export async function deleteAllSiteData(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  try { localStorage.clear(); } catch { /* bloqueado pelo navegador */ }
  if (!idb) return;
  for (const name of [DB_NAME, ...LEGACY_DBS]) {
    await new Promise<void>((resolve) => {
      try {
        const r = idb.deleteDatabase(name);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
