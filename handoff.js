// Pasa fotos del Visor SD a EXIF Frame. Son páginas distintas, así que los
// archivos viajan por IndexedDB (el navegador guarda una copia temporal).

const HANDOFF_DB = 'exif-frame-handoff';
const HANDOFF_STORE = 'handoff';
const HANDOFF_KEY = 'files';

function withHandoffStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(HANDOFF_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(HANDOFF_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(HANDOFF_STORE, mode);
      const request = fn(tx.objectStore(HANDOFF_STORE));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('No hay espacio para pasar las fotos'));
      };
    };
  });
}

/** Guarda los archivos para que EXIF Frame los abra al cargar. */
function putHandoff(files) {
  return withHandoffStore('readwrite', (store) => store.put(files, HANDOFF_KEY));
}

/** Devuelve (y borra) los archivos enviados desde el visor. */
async function takeHandoff() {
  const files = await withHandoffStore('readwrite', (store) => {
    const get = store.get(HANDOFF_KEY);
    store.delete(HANDOFF_KEY);
    return get;
  });
  return files || [];
}
