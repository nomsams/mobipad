let dbPromise;
function database() {
  if(dbPromise)return dbPromise;
  const opening = new Promise((resolve, reject) => {
    const r = indexedDB.open("mobipad", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("projects");
      r.result.createObjectStore("samples", { keyPath: "id" });
    };
    r.onsuccess = () => {
      const db=r.result;
      db.onversionchange=()=>{db.close();if(dbPromise===opening)dbPromise=null;};
      db.onclose=()=>{if(dbPromise===opening)dbPromise=null;};
      resolve(db);
    };
    r.onerror = () => reject(r.error);
  });
  dbPromise=opening;
  opening.catch(()=>{if(dbPromise===opening)dbPromise=null;});
  return opening;
}
async function dbAction(store, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), r = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
  });
}
const saveSession = (s) => dbAction("projects", "readwrite", (o) => o.put(s, "current"));
const loadSession = () => dbAction("projects", "readonly", (o) => o.get("current"));
const saveSample = (s) => dbAction("samples", "readwrite", (o) => o.put(s));
const getSamples = () => dbAction("samples", "readonly", (o) => o.getAll());
const deleteSample = (id) => dbAction("samples", "readwrite", (o) => o.delete(id));
async function saveProject(session,samples){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['projects','samples'],'readwrite');
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Project import was not saved.'));
    try{for(const sample of samples)tx.objectStore('samples').put(sample);tx.objectStore('projects').put(session,'current');}
    catch(error){tx.abort();reject(error);}
  });
}
function download(data, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3e3);
}
async function exportProject(session, samples) {
  const audio = [];
  for (const s of samples) {
    const bytes = new Uint8Array(await s.blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    audio.push({ id: s.id, name: s.name, duration: s.duration, analysis: s.analysis, type: s.blob.type, data: btoa(binary) });
  }
  download(JSON.stringify({ session, audio }), (session.name || "Mobipad") + ".mobipad.json");
}
export {
  database,
  dbAction,
  deleteSample,
  download,
  exportProject,
  getSamples,
  loadSession,
  saveSample,
  saveProject,
  saveSession
};
