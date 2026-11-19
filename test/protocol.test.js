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
    id: 'test-device', name: 'evs70', gatt: {
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
    async requestDevice(options) {
      assert.deepEqual(options, { acceptAllDevices: true, optionalServices: [SERVICE] });
      assert.equal(writes.length, 0);
      return connection;
    }
  } } });

  const states = [];
  const device = new Smart7(state => states.push(state.connectionStage ?? state.connection));
  await device.connect();
  assert.deepEqual(states, ['selecting', 'link', 'services', 'notifications', 'request-pin', 'waiting-pin']);
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

test('connection guidance distinguishes an empty selection, blocked access and a missing GATT service', async context => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  context.after(() => Object.defineProperty(globalThis, 'navigator', navigatorDescriptor));
  const device = new Smart7(() => {});
  const bluetooth = {
    async requestDevice() { throw new DOMException('No device selected', 'NotFoundError'); }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth } });

  await device.connect();
  assert.equal(device.state.connection, 'disconnected');
  assert.match(device.state.message, /선택된 기기가 없습니다/);

  bluetooth.requestDevice = async () => { throw new DOMException('Permission denied', 'SecurityError'); };
  await device.connect();
  assert.match(device.state.message, /앱 권한을 확인/);

  const selection = Object.assign(new EventTarget(), {
    name: 'EVS-70SV-BT',
    gatt: {
      connected: false,
      async connect() { this.connected = true; return this; },
      async getPrimaryService() { throw new DOMException('No GATT service', 'NotFoundError'); },
      disconnect() { this.connected = false; }
    }
  });
  bluetooth.requestDevice = async () => selection;
  await device.connect();
  assert.match(device.state.message, /Smart7 블루투스 서비스를 찾지 못했습니다/);
  assert.equal(selection.gatt.connected, false);
});

test('manual connection waits for discovery and releases a late GATT link after timeout', async context => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  context.after(() => Object.defineProperty(globalThis, 'navigator', navigatorDescriptor));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  let finish;
  const gatt = {
    connected: false,
    connect() {
      attempts++;
      return new Promise(resolve => { finish = resolve; });
    },
    disconnect() { this.connected = false; }
  };
  const selection = Object.assign(new EventTarget(), { name: 'EVS-70SV-BT', gatt });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth: {
    async requestDevice() { return selection; }
  } } });
  const device = new Smart7(() => {});
  const connection = device.connect();
  await Promise.resolve();
  context.mock.timers.tick(1499);
  await Promise.resolve();
  assert.equal(attempts, 0);
  context.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(attempts, 1);

  context.mock.timers.tick(13500);
  await connection;
  assert.equal(device.state.connection, 'disconnected');
  assert.match(device.state.message, /본체에 블루투스로 연결하지 못했습니다/);
  gatt.connected = true;
  finish(gatt);
  await Promise.resolve();
  assert.equal(gatt.connected, false);
});

test('PIN timeouts retry without opening the device picker again', async context => {
  for (const scenario of [
    { name: 'second request on the same link', link: 1, request: 2, expected: [2] },
    { name: 'first request on the third link', link: 3, request: 1, expected: [2, 2, 1] },
    { name: 'no reply after three links', link: 0, request: 0, expected: [2, 2, 2] }
  ]) {
    await context.test(scenario.name, async child => {
      const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      const storage = new Map();
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: key => storage.get(key),
        setItem: (key, value) => storage.set(key, value)
      } });
      child.after(() => {
        Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
        else delete globalThis.localStorage;
      });
      child.mock.timers.enable({ apis: ['setTimeout'] });
      const advance = async ms => {
        child.mock.timers.tick(ms);
        await new Promise(resolve => setImmediate(resolve));
      };
      let selections = 0;
      const requests = [];
      const commands = [];
      const notifier = Object.assign(new EventTarget(), { startNotifications: async () => {} });
      const writer = {
        properties: { writeWithoutResponse: true },
        async writeValueWithoutResponse(bytes) {
          const [{ command }] = parseFrames(bytes).frames;
          commands.push(command);
          if (command !== 9) return;
          const link = requests.length;
          requests[link - 1]++;
          if (link === scenario.link && requests[link - 1] === scenario.request) {
            const frame = encode(7, [49, 50, 51, 52, 53, 54], 0x31);
            notifier.value = new DataView(frame.buffer);
            notifier.dispatchEvent(new Event('characteristicvaluechanged'));
          }
        }
      };
      const gatt = {
        connected: false,
        async connect() { this.connected = true; requests.push(0); return this; },
        async getPrimaryService() {
          return { getCharacteristic: async id => id.startsWith('00001001') ? writer : notifier };
        },
        disconnect() { this.connected = false; }
      };
      const selection = Object.assign(new EventTarget(), { id: 'pin-retry-device', name: 'EVS-70SV-BT', gatt });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth: {
        async requestDevice() { selections++; return selection; }
      } } });

      const device = new Smart7(() => {});
      const connecting = device.connect();
      await advance(0);
      for (let link = 0; link < 3 && !device.expectedPin; link++) {
        await advance(1500);
        await advance(500);
        if (device.expectedPin) break;
        await advance(4000);
        if (!device.expectedPin) await advance(8000);
      }
      await connecting;
      await advance(200);
      assert.deepEqual(requests, scenario.expected);
      assert.equal(selections, 1);

      if (scenario.link) {
        assert.equal(device.state.connection, 'pin');
        assert.equal(commands.at(-1), 16);
        await device.acceptPin('123456', true);
        await advance(24000);
        assert.equal(device.state.connection, 'ready');
        assert.equal(commands.at(-1), 15);
        device.disconnect();
      } else {
        assert.equal(device.state.connection, 'disconnected');
        assert.match(device.state.message, /PIN 응답을 기다리다 시간이 초과/);
      }
      assert.deepEqual(requests, scenario.expected);
    });
  }
});

test('a busy brewer cancels queued preparation and waits for acknowledgement', async () => {
  const device = new Smart7(() => {});
  const writes = [];
  device.send = async (command, payload = []) => { writes.push([command, ...payload]); };
  device.update({ connection: 'ready' });
  const brew = device.brew(automaticRecipe(2, 'normal', 93));
  await device.handleFrame({ command: 2, data: [2, 2, 1, 10] });
  await brew;
  assert.equal(device.state.alert, 'busy');
  assert.deepEqual(writes, [[5]]);
  await device.acknowledgeAlert();
  assert.deepEqual(writes, [[5], [2, 3]]);
  assert.equal(device.state.alert, null);
});

test('overheat stops brewing and opens drain preparation before a separate start', async () => {
  const device = new Smart7(() => {});
  const writes = [];
  device.send = async (command, payload = []) => { writes.push([command, ...payload]); };
  device.update({ connection: 'ready', phase: 'starting' });
  await device.handleFrame({ command: 3, data: [3] });
  assert.equal(device.state.alert, 'overheat');
  assert.deepEqual(writes, [[2, 3]]);
  assert.equal(await device.acknowledgeAlert(true), true);
  assert.equal(device.state.phase, 'idle');
  assert.deepEqual(writes, [[2, 3]]);
  await device.drain();
  assert.equal(device.state.phase, 'draining');
  assert.deepEqual(writes, [[2, 3], [3, 1]]);
});

test('tank confirmation and flow calibration respect the appliance workflow', async () => {
  const device = new Smart7(() => {});
  const writes = [];
  device.send = async (command, payload = []) => { writes.push([command, ...payload]); };
  device.update({ connection: 'ready' });
  await device.prepareBrew();
  device.showCalibration(true);
  await device.readFlow();
  await device.handleFrame({ command: 2, data: [3, 1, 0, 0] });
  assert.equal(device.state.alert, 'busy');
  await device.acknowledgeAlert();
  assert.deepEqual(writes, [[3, 2], [12, 0]]);
});

test('the device completion frame opens the brew summary without sending a command', async () => {
  const device = new Smart7(() => {});
  device.send = async () => assert.fail('completion must not write to GATT');
  device.update({ connection: 'ready', phase: 'brewing' });
  await device.handleFrame({ command: 2, data: [1, 1, 0, 0] });
  assert.equal(device.state.alert, 'brew-complete');
  await device.acknowledgeAlert();
  assert.equal(device.state.phase, 'complete');
  assert.equal(device.state.alert, null);
});

test('rinse timer begins on device progress and completion sends no command', async ({ mock }) => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const device = new Smart7(() => {});
  const writes = [];
  device.send = async (command, payload = []) => { writes.push([command, ...payload]); };
  device.update({ connection: 'ready' });
  await device.clean();
  await device.handleFrame({ command: 2, data: [1, 1, 0, 0] });
  await device.handleFrame({ command: 2, data: [4, 2, 4, 0] });
  mock.timers.tick(300000);
  assert.equal(device.state.phase, 'awaiting-rinse');
  await device.rinse();
  mock.timers.tick(90000);
  assert.equal(device.state.phase, 'rinsing');
  assert.equal(device.state.seconds, null);
  await device.handleFrame({ command: 2, data: [4, 2, 5, 0] });
  mock.timers.tick(44000);
  await device.handleFrame({ command: 2, data: [4, 2, 5, 0] });
  assert.equal(device.state.phase, 'rinsing');
  mock.timers.tick(1000);
  assert.equal(device.state.alert, 'rinse-complete');
  await device.acknowledgeAlert();
  assert.equal(device.state.phase, 'complete');
  assert.deepEqual(writes, [[4], [13, 1], [13, 1]]);
});

test('cancelling a rinse clears the completion timer and sends rinse stop only', async ({ mock }) => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const device = new Smart7(() => {});
  const writes = [];
  device.send = async (command, payload = []) => { writes.push([command, ...payload]); };
  device.update({ connection: 'ready', phase: 'rinsing' });
  await device.handleFrame({ command: 2, data: [4, 2, 5, 0] });
  await device.stop();
  mock.timers.tick(46000);
  assert.equal(device.state.phase, 'idle');
  assert.equal(device.state.alert, null);
  assert.deepEqual(writes, [[13, 0]]);
});
