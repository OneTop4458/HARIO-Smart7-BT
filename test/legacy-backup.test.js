import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { checkpointLegacyDatabase, unpackLegacyArchive } from '../public/legacy-backup.js';
import { zipSync } from '../public/vendor/fflate.js';

const databasePath = 'apps/com.hario.smart7.myapplication/db/CoreDataModel';

test('zip and Android backups select Smart7 recipe files', async () => {
  const contents = Uint8Array.of(1, 2, 3);
  const archive = zipSync({ [databasePath]: contents, 'apps/other.app/db/CoreDataModel': contents });
  assert.deepEqual(await unpackLegacyArchive(archive), [[databasePath, contents]]);
  const tar = Buffer.alloc(1536);
  tar.write(databasePath);
  tar.write('00000000003\0', 124);
  tar[156] = 48;
  tar.write('ustar', 257);
  tar.set(contents, 512);
  const backup = Buffer.concat([Buffer.from('ANDROID BACKUP\n5\n1\nnone\n'), deflateSync(tar)]);
  const entries = await unpackLegacyArchive(backup);
  assert.equal(entries[0][0], databasePath);
  assert.deepEqual([...entries[0][1]], [...contents]);
  await assert.rejects(unpackLegacyArchive(Buffer.from('ANDROID BACKUP\n5\n1\nAES-256\n')), /암호화/);
});

test('only committed pages are replayed from a valid SQLite WAL', () => {
  const pageSize = 512;
  const base = Buffer.alloc(pageSize * 2);
  base.write('SQLite format 3\0');
  base.writeUInt16BE(pageSize, 16);
  base[18] = base[19] = 2;
  const frameSize = 24 + pageSize;
  const wal = Buffer.alloc(32 + frameSize * 2);
  wal.writeUInt32BE(0x377f0682, 0);
  wal.writeUInt32BE(3007000, 4);
  wal.writeUInt32BE(pageSize, 8);
  wal.writeUInt32BE(123, 16);
  wal.writeUInt32BE(456, 20);
  let first = 0;
  let second = 0;
  function checksum(start, end) {
    for (let offset = start; offset < end; offset += 8) {
      first = (first + wal.readUInt32LE(offset) + second) >>> 0;
      second = (second + wal.readUInt32LE(offset + 4) + first) >>> 0;
    }
  }
  checksum(0, 24);
  wal.writeUInt32BE(first, 24);
  wal.writeUInt32BE(second, 28);
  for (let index = 0; index < 2; index++) {
    const offset = 32 + index * frameSize;
    wal.writeUInt32BE(2, offset);
    wal.writeUInt32BE(index === 0 ? 2 : 0, offset + 4);
    wal.writeUInt32BE(123, offset + 8);
    wal.writeUInt32BE(456, offset + 12);
    wal[offset + 24] = index === 0 ? 37 : 91;
    checksum(offset, offset + 8);
    checksum(offset + 24, offset + frameSize);
    wal.writeUInt32BE(first, offset + 16);
    wal.writeUInt32BE(second, offset + 20);
  }
  const merged = checkpointLegacyDatabase(base, wal);
  assert.equal(base[18], 2);
  assert.equal(base[pageSize], 0);
  assert.equal(merged[18], 1);
  assert.equal(merged[pageSize], 37);
});
