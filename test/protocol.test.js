import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticRecipe, summarize, validateRecipe } from '../public/recipes.js';
import { encode, parseFrames, SERVICE, Smart7 } from '../public/protocol.js';

test('native-derived BLE frames and split notifications', () => {
  assert.deepEqual([...encode(9, [], 0x31)], [0x54, 0x51, 0x65, 0xa8, 0x38, 0x31, 0x38]);
  assert.deepEqual([...encode(2, [1], 0x31)], [0x54, 0x52, 0x65, 0xa8, 0x33, 0x30, 0x30, 0x35]);
  const packet = encode(2, [2, 2, 1, 27], 0x54);
  const partial = parseFrames(packet.subarray(0, 4));
  assert.equal(partial.frames.length, 0);
  assert.equal(partial.rest.length, 4);
  const full = parseFrames(Uint8Array.of(...partial.rest, ...packet.subarray(4), ...encode(8, [], 0xff)));
  assert.deepEqual(full.frames, [{ command: 2, data: [2, 2, 1, 27] }, { command: 8, data: [] }]);
  const badPacket = encode(2, [2, 2, 1, 27], 0xaf);
  badPacket[badPacket.length - 1] ^= 1;
  assert.equal(parseFrames(badPacket).frames.length, 0);
});

test('presets match the expected volumes and recipe limits', () => {
  for (const [cups, volume] of [[2, 270], [3, 410], [4, 530], [5, 660]]) {
    for (const speed of ['normal', 'fast']) {
      const recipe = validateRecipe(automaticRecipe(cups, speed, 93));
      assert.equal(summarize(recipe.steps).volume, volume);
    }
  }
  const recipe = automaticRecipe(2, 'normal', 93);
  assert.throws(() => validateRecipe({ ...recipe, temperature: 99 }), /80~96/);
  assert.throws(() => validateRecipe({ ...recipe, steps: [...recipe.steps, { volume: 701, pour: 75, wait: 0 }] }), /물량/);
  assert.throws(() => validateRecipe({ ...recipe, steps: [{ volume: 40, pour: 4, wait: 0 }] }), /270~700/);
});

test('mock GATT pairing and brew do not need network responses', async () => {
  const connection = new EventTarget();
  const notifier = Object.assign(new EventTarget(), { startNotifications: async () => {} });
  const writes = [];
  const writer = {
    properties: { writeWithoutResponse: true },
    async writeValueWithoutResponse(bytes) { writes.push(...parseFrames(bytes).frames); }
  };
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  Object.assign(connection, {
    id: 'test-device', name: 'EVS-70SV-BT', gatt: {
      connected: false,
      async connect() { this.connected = true; return this; },
      async getPrimaryService(uuid) {
        assert.equal(uuid, SERVICE);
        return { getCharacteristic: async char => char.startsWith('00001001') ? writer : notifier };
      },
      disconnect() { this.connected = false; }
    }
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth: {
    async requestDevice(options) { assert.deepEqual(options.optionalServices, [SERVICE]); return connection; }
  } } });

  const device = new Smart7(() => {});
  await device.connect();
  await device.handleFrame({ command: 7, data: [0x31, 0x32, 0x33, 0x34, 0x35, 0x36] });
  assert.equal(device.state.connection, 'pin');
  await assert.rejects(device.acceptPin('654321', true), /일치하지 않습니다/);
  await device.acceptPin('123456', true);
  assert.equal(device.state.connection, 'ready');
  await device.brew(automaticRecipe(2, 'normal', 93));
  assert.deepEqual(writes.map(frame => frame.command), [9, 16, 15, 5, 1, 1, 1, 1, 10, 2]);
  assert.deepEqual(writes[4].data, [1, 3, 5, 25]);
  assert.deepEqual(writes.at(-1).data, [1]);
  await device.handleFrame({ command: 2, data: [2, 1, 86, 0] });
  assert.equal(device.state.phase, 'heating');
  await device.handleFrame({ command: 2, data: [2, 2, 1, 10] });
  assert.equal(device.state.seconds, 70);
  await device.pauseOrResume();
  assert.equal(device.state.phase, 'paused');
  await device.stop();
  assert.deepEqual(writes.at(-1), { command: 2, data: [3] });
  device.disconnect();
});
