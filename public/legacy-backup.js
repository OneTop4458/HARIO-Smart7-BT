import { unzipSync } from './vendor/fflate.js';
import { validateRecipe } from './recipes.js';
import { loadRecipePhoto } from './recipe-photo.js';

const maxBytes = 64 * 1024 * 1024;
const packageName = 'com.hario.smart7.myapplication';
const decoder = new TextDecoder();
const databaseName = /^CoreDataModel(?:\.(?:db|sqlite3?))?$/i;
const photoName = /\.(?:png|jpe?g|webp)$/i;
let sqlPromise;

function filename(path) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const app = parts.indexOf('apps');
  if (parts.includes('..') || (app >= 0 && parts[app + 1] !== packageName)) return '';
  return parts.at(-1) ?? '';
}

function relevant(path) {
  const name = filename(path);
  return databaseName.test(name.replace(/-wal$/i, '')) || photoName.test(name);
}

function tarEntries(bytes) {
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => decoder.decode(header.subarray(start, end)).split('\0', 1)[0].trim();
    const sizeField = field(124, 136);
    if (!/^[0-7]+$/.test(sizeField)) throw new Error('TAR 백업 헤더를 읽을 수 없습니다.');
    const size = Number.parseInt(sizeField, 8);
    const start = offset + 512;
    if (start + size > bytes.length) throw new Error('TAR 백업 파일이 잘렸습니다.');
    const prefix = field(257, 263).startsWith('ustar') ? field(345, 500) : '';
    const name = [prefix, field(0, 100)].filter(Boolean).join('/');
    if ((header[156] === 0 || header[156] === 48) && relevant(name)) entries.push([name, bytes.subarray(start, start + size)]);
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function decompress(bytes, format) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('백업은 압축 해제 후 64MB 이하여야 합니다.');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function unpackLegacyArchive(bytes) {
  if (decoder.decode(bytes.subarray(0, 15)) === 'ANDROID BACKUP\n') {
    let offset = 15;
    const line = () => {
      const end = bytes.indexOf(10, offset);
      if (end < offset || end - offset > 64) throw new Error('Android 백업 헤더를 읽을 수 없습니다.');
      const value = decoder.decode(bytes.subarray(offset, end)).trim();
      offset = end + 1;
      return value;
    };
    const version = line();
    const compression = line();
    if (line() !== 'none') throw new Error('암호화된 Android 백업은 가져올 수 없습니다.');
    if (!/^[1-5]$/.test(version) || !/^[01]$/.test(compression)) throw new Error('지원하지 않는 Android 백업 형식입니다.');
    const payload = bytes.subarray(offset);
    return tarEntries(compression === '1' ? await decompress(payload, 'deflate') : payload);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let extracted = 0;
    const records = unzipSync(bytes, { filter: entry => {
      if (!relevant(entry.name)) return false;
      extracted += entry.originalSize;
      if (extracted > maxBytes) throw new Error('백업은 압축 해제 후 64MB 이하여야 합니다.');
      return true;
    } });
    return Object.entries(records);
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return tarEntries(await decompress(bytes, 'gzip'));
  return tarEntries(bytes);
}

function sqliteFile(bytes) {
  return bytes.length >= 100 && decoder.decode(bytes.subarray(0, 16)) === 'SQLite format 3\0';
}

// Apply valid committed WAL frames in memory before opening a checkpointed copy with sql.js.
export function checkpointLegacyDatabase(base, wal) {
  if (!sqliteFile(base)) throw new Error('SQLite CoreDataModel 파일을 선택하세요.');
  if (!wal?.length && base[18] !== 2 && base[19] !== 2) return base;
  let merged = new Uint8Array(base);
  if (wal?.length) {
    if (wal.length < 32) throw new Error('CoreDataModel WAL 파일이 잘렸습니다.');
    const view = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
    const magic = view.getUint32(0);
    const pageSize = view.getUint32(8);
    const basePageSize = new DataView(base.buffer, base.byteOffset, base.byteLength).getUint16(16);
    if ((magic !== 0x377f0682 && magic !== 0x377f0683) || view.getUint32(4) !== 3007000
      || pageSize !== (basePageSize === 1 ? 65536 : basePageSize) || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) {
      throw new Error('CoreDataModel과 WAL 파일 형식이 일치하지 않습니다.');
    }
    let first = 0;
    let second = 0;
    const checksum = (start, end) => {
      const littleEndian = magic === 0x377f0682;
      for (let offset = start; offset < end; offset += 8) {
        first = (first + view.getUint32(offset, littleEndian) + second) >>> 0;
        second = (second + view.getUint32(offset + 4, littleEndian) + first) >>> 0;
      }
    };
    checksum(0, 24);
    if (first !== view.getUint32(24) || second !== view.getUint32(28)) throw new Error('CoreDataModel WAL 검증에 실패했습니다.');
    let commitEnd = 32;
    let pages = 0;
    for (let offset = 32; offset + 24 + pageSize <= wal.length; offset += 24 + pageSize) {
      if (view.getUint32(offset + 8) !== view.getUint32(16) || view.getUint32(offset + 12) !== view.getUint32(20)) break;
      if (!view.getUint32(offset)) break;
      checksum(offset, offset + 8);
      checksum(offset + 24, offset + 24 + pageSize);
      if (first !== view.getUint32(offset + 16) || second !== view.getUint32(offset + 20)) break;
      const commit = view.getUint32(offset + 4);
      if (commit) { pages = commit; commitEnd = offset + 24 + pageSize; }
    }
    if (pages) {
      if (pages * pageSize > maxBytes) throw new Error('백업은 압축 해제 후 64MB 이하여야 합니다.');
      merged = new Uint8Array(pages * pageSize);
      merged.set(base.subarray(0, merged.length));
      for (let offset = 32; offset < commitEnd; offset += 24 + pageSize) {
        const page = view.getUint32(offset);
        if (page <= pages) merged.set(wal.subarray(offset + 24, offset + 24 + pageSize), (page - 1) * pageSize);
      }
    }
  }
  merged[18] = merged[19] = 1;
  return merged;
}

function loadSql() {
  if (!sqlPromise) {
    sqlPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./vendor/sql-wasm-browser.js', import.meta.url).href;
      script.onload = () => {
        if (typeof globalThis.initSqlJs !== 'function') reject(new Error('오프라인 SQLite 모듈을 열 수 없습니다.'));
        else globalThis.initSqlJs({ locateFile: file => new URL(`./vendor/${file}`, import.meta.url).href }).then(resolve, reject);
      };
      script.onerror = () => reject(new Error('오프라인 SQLite 모듈을 열 수 없습니다.'));
      document.head.append(script);
    }).catch(error => { sqlPromise = null; throw error; });
  }
  return sqlPromise;
}

export async function readLegacyBackup(files) {
  if (files.reduce((size, file) => size + file.size, 0) > maxBytes) throw new Error('64MB 이하 구형 앱 백업을 선택하세요.');
  const entries = [];
  for (const file of files) {
    const name = file.webkitRelativePath || file.name;
    if (!relevant(name) && !/\.(?:ab|zip|tar|tgz|gz|db|sqlite3?)$/i.test(file.name)) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.(?:ab|zip|tar|tgz|gz)$/i.test(file.name)) entries.push(...await unpackLegacyArchive(bytes));
    else entries.push([name, bytes]);
  }
  const candidates = entries.filter(([name, bytes]) => filename(name) && sqliteFile(bytes));
  const namedDatabases = candidates.filter(([name]) => databaseName.test(filename(name)));
  const databases = namedDatabases.length ? namedDatabases : candidates;
  if (databases.length !== 1) throw new Error('구형 Smart7 CoreDataModel DB 파일을 하나 선택하세요.');
  const [path, base] = databases[0];
  const wal = entries.find(([name]) => name.toLowerCase() === `${path.toLowerCase()}-wal`)?.[1];
  const photos = new Map(entries.filter(([name]) => photoName.test(filename(name))).map(([name, bytes]) => [filename(name).toLowerCase(), bytes]));
  const SQL = await loadSql();
  const database = new SQL.Database(checkpointLegacyDatabase(base, wal));
  const recipes = [];
  const skipped = [];
  let missingPhotos = 0;
  try {
    database.run('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF');
    const tables = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('MyRecipeItem','MyRecipeItemDetail')")[0]?.values;
    if (tables?.length !== 2) throw new Error('구형 Smart7 레시피 DB를 찾지 못했습니다.');
    const stepsByName = new Map();
    const rows = database.exec('SELECT name, flow, water, intervals FROM MyRecipeItemDetail ORDER BY id')[0]?.values ?? [];
    for (const [name, volume, pour, wait] of rows) {
      if (!stepsByName.has(name)) stepsByName.set(name, []);
      stepsByName.get(name).push({ volume, pour, wait });
    }
    const records = database.exec('SELECT name, tmp, bean, imgname FROM MyRecipeItem ORDER BY id')[0]?.values ?? [];
    for (const [name, temperature, grounds, image] of records) {
      try {
        const recipe = validateRecipe({ name, temperature, grounds, steps: stepsByName.get(name) });
        if (typeof image === 'string' && image && image !== 'noImage') {
          const photo = photos.get(`${image}.png`.toLowerCase()) ?? photos.get(image.toLowerCase());
          if (photo) {
            try { recipe.photo = await loadRecipePhoto(new Blob([photo])); } catch { missingPhotos++; }
          } else missingPhotos++;
        }
        recipes.push(recipe);
      } catch (error) { skipped.push({ name, message: error.message }); }
    }
  } finally { database.close(); }
  return { recipes, skipped, missingPhotos };
}
