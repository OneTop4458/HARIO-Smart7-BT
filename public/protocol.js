import { validateRecipe } from './recipes.js';

const uuid = short => `0000${short}-0000-1000-8000-00805f9b34fb`;
export const SERVICE = uuid('1000');
const WRITE = uuid('1001');
const NOTIFY = uuid('1002');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function encode(command, payload = [], key = crypto.getRandomValues(new Uint8Array(1))[0]) {
  const sum = payload.reduce((total, byte) => total + byte, command + payload.length) & 255;
  const raw = [0x99, command, payload.length, ...payload, sum];
  return Uint8Array.of(0x54, (raw.length + 1) ^ 0x54, key ^ 0x54, ...raw.map(byte => byte ^ key));
}

export function parseFrames(bytes) {
  const frames = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0x54) { offset++; continue; }
    if (bytes.length - offset < 3) break;
    const end = offset + (bytes[offset + 1] ^ 0x54) + 2;
    if (end > bytes.length) break;
    const key = bytes[offset] ^ bytes[offset + 2];
    const raw = bytes.slice(offset + 3, end).map(byte => byte ^ key);
    for (let index = 0; index + 4 <= raw.length;) {
      if (raw[index] !== 0x99) { index++; continue; }
      const command = raw[index + 1];
      const length = raw[index + 2];
      const checksumIndex = index + 3 + length;
      if (checksumIndex >= raw.length) break;
      const data = [...raw.slice(index + 3, checksumIndex)];
      const checksum = data.reduce((sum, byte) => sum + byte, command + length) & 255;
      if (checksum === raw[checksumIndex] || command === 7 || command === 8) frames.push({ command, data });
      index = checksumIndex + 1;
    }
    offset = end;
  }
  return { frames, rest: bytes.slice(offset) };
}

export const workingPhases = ['starting', 'heating', 'brewing', 'paused', 'draining', 'checking-clean', 'cleaning', 'soaking', 'awaiting-rinse', 'rinsing'];
const brewPhases = ['starting', 'heating', 'brewing', 'paused'];
const cleanPhases = ['checking-clean', 'cleaning', 'soaking', 'awaiting-rinse', 'rinsing'];
const deviceErrors = {
  1: '본체 센서 오류가 감지됐습니다.', 2: '물이 부족합니다.', 3: '온수 오류가 감지됐습니다.',
  4: '본체가 추출 설정을 거부했습니다.', 5: '본체가 명령을 거부했습니다.'
};

export class Smart7 {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = { connection: 'disconnected', phase: 'idle', message: '', temperature: null, seconds: null, level: null };
    this.pending = new Uint8Array();
    this.queue = Promise.resolve();
    this.operation = 0;
    this.receive = event => this.receiveBytes(new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength));
    this.lost = () => this.reset('블루투스 연결이 끊겼습니다. 본체에서 상태를 확인하세요.');
  }

  update(values) {
    Object.assign(this.state, values);
    this.onChange(this.state);
  }

  async connect(reuse = false) {
    if (this.state.connection !== 'disconnected') return;
    this.update({ connection: 'connecting', message: '', phase: 'idle' });
    try {
      const bluetooth = navigator.bluetooth;
      if (!bluetooth) throw new Error('이 브라우저에서 Web Bluetooth를 사용할 수 없습니다.');
      const device = reuse
        ? (await bluetooth.getDevices()).find(item => item.id === localStorage.getItem('smart7-device'))
        : await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE] });
      if (!device) throw new Error('저장된 기기를 찾지 못했습니다. 기기 연결에서 다시 선택하세요.');
      if (!device.name?.includes('EVS-70')) throw new Error('목록에서 이름에 EVS-70이 포함된 Smart7 BT를 선택하세요.');
      this.device = device;
      device.addEventListener('gattserverdisconnected', this.lost);
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(SERVICE);
      this.writer = await service.getCharacteristic(WRITE);
      this.notifier = await service.getCharacteristic(NOTIFY);
      this.notifier.addEventListener('characteristicvaluechanged', this.receive);
      await this.notifier.startNotifications();
      await wait(500);
      await this.send(9);
      if (this.state.connection === 'connecting') {
        this.pinTimer = setTimeout(() => {
          this.disconnect('본체의 PIN 응답을 기다리다 시간이 초과됐습니다.');
        }, 12000);
      }
    } catch (error) {
      this.disconnect(error.name === 'NotFoundError' ? '기기 선택이 취소됐습니다.' : error.message);
    }
  }

  reset(message) {
    clearTimeout(this.pinTimer);
    clearTimeout(this.soakTimer);
    this.notifier?.removeEventListener('characteristicvaluechanged', this.receive);
    this.device?.removeEventListener('gattserverdisconnected', this.lost);
    this.device = this.writer = this.notifier = this.expectedPin = null;
    this.pending = new Uint8Array();
    this.operation++;
    this.update({ connection: 'disconnected', phase: 'idle', message, temperature: null, seconds: null, level: null });
  }

  disconnect(message = '') {
    const device = this.device;
    this.reset(message);
    if (device?.gatt.connected) device.gatt.disconnect();
  }

  send(command, payload) {
    const writer = this.writer;
    const write = async () => {
      if (!writer || writer !== this.writer || !this.device?.gatt.connected) throw new Error('먼저 Smart7을 연결하세요.');
      const packet = encode(command, payload);
      if (writer.properties.writeWithoutResponse) await writer.writeValueWithoutResponse(packet);
      else if (writer.properties.write) await writer.writeValueWithResponse(packet);
      else throw new Error('브라우저가 본체의 쓰기 특성을 사용할 수 없습니다.');
    };
    const result = this.queue.then(write);
    this.queue = result.catch(() => {});
    return result;
  }

  receiveBytes(chunk) {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const { frames, rest } = parseFrames(joined);
    this.pending = rest;
    for (const frame of frames) this.handleFrame(frame).catch(error => this.update({ message: error.message }));
  }

  async handleFrame({ command, data }) {
    if (command === 8) {
      await wait(50);
      if (this.writer) await this.send(18);
      return;
    }
    if (command === 7 && this.state.connection === 'connecting' && data.length >= 6) {
      clearTimeout(this.pinTimer);
      const digits = data.slice(0, 6).map(byte => byte & 15);
      if (digits.some(digit => digit > 9)) throw new Error('본체에서 지원되지 않는 PIN 형식이 도착했습니다.');
      this.expectedPin = digits.join('');
      const saved = localStorage.getItem(`smart7-pin-${this.device.id}`);
      if (saved === this.expectedPin) await this.acceptPin(saved, true);
      else {
        this.update({ connection: 'pin', message: '' });
        await this.send(16);
      }
      return;
    }
    if (command === 6 && data[0] >= 1 && data[0] <= 9) this.update({ level: data[0] });
    if (command === 3 && deviceErrors[data[0]] && workingPhases.includes(this.state.phase)) {
      const phase = this.state.phase;
      this.operation++;
      clearTimeout(this.soakTimer);
      this.update({ phase: 'idle', message: deviceErrors[data[0]] });
      if (phase === 'draining') await this.send(3, [2]);
      else if (cleanPhases.includes(phase)) await this.stopCleaning();
      else await this.send(2, [3]);
      return;
    }
    if (command !== 2 || data.length !== 4) return;
    const [mode, step, first, second] = data;
    const phase = this.state.phase;
    if (brewPhases.includes(phase)) {
      if (mode === 2 && step === 1 && phase !== 'paused') this.update({ phase: 'heating', temperature: first });
      if (mode === 2 && step === 2 && phase !== 'paused') this.update({ phase: 'brewing', seconds: first * 60 + second });
      if (mode === 1 && step === 1 && first === 0 && second === 0 && (phase === 'heating' || phase === 'brewing')) {
        this.update({ phase: 'complete', seconds: 0 });
      }
    }
    if (phase === 'draining' && mode === 3 && step === 1) {
      this.update({ phase: 'complete', message: '배수가 완료됐습니다.' });
      await this.send(3, [2]);
      await this.send(3, [2]);
    }
    if (phase === 'checking-clean' && mode === 1 && step === 1) {
      clearTimeout(this.soakTimer);
      this.update({ phase: 'cleaning', message: '세척 중입니다.' });
      await this.send(13, [1]);
    }
    if (phase === 'cleaning' && mode === 4 && step === 1) this.update({ temperature: first });
    if (phase === 'cleaning' && mode === 4 && step === 2 && first < 5) this.startSoak();
    if (phase === 'rinsing' && mode === 4 && step === 2 && this.soakTimer === null) {
      this.soakTimer = setTimeout(() => this.update({ message: '헹굼 상태를 본체에서 확인한 뒤 종료하세요.' }), 45000);
    }
  }

  async acceptPin(input, remember) {
    if (!this.expectedPin || input !== this.expectedPin) throw new Error('본체 화면에 표시된 PIN과 일치하지 않습니다.');
    await this.send(15);
    const id = this.device.id;
    localStorage.setItem('smart7-device', id);
    if (remember) localStorage.setItem(`smart7-pin-${id}`, input);
    else localStorage.removeItem(`smart7-pin-${id}`);
    this.expectedPin = null;
    this.update({ connection: 'ready', message: '' });
  }

  async cancelPin() {
    try { await this.send(17); } finally { this.disconnect(); }
  }

  checkReady() {
    if (this.state.connection !== 'ready') throw new Error('먼저 본체 연결과 PIN 확인을 완료하세요.');
    if (workingPhases.includes(this.state.phase)) throw new Error('진행 중인 작업을 먼저 종료하세요.');
  }

  async brew(input) {
    this.checkReady();
    const recipe = validateRecipe(input);
    const operation = ++this.operation;
    const sendCurrent = async (delay, command, data) => {
      if (delay) await wait(delay);
      if (operation !== this.operation) return false;
      await this.send(command, data);
      return operation === this.operation;
    };
    this.update({ phase: 'starting', message: '', temperature: null, seconds: null });
    try {
      if (!await sendCurrent(0, 5)) return;
      for (const [index, step] of recipe.steps.entries()) {
        if (!await sendCurrent(200, 1, [index + 1, step.volume / 10, step.pour, step.wait])) return;
      }
      if (!await sendCurrent(100, 10, [recipe.temperature])) return;
      await sendCurrent(100, 2, [1]);
    } catch (error) {
      if (operation !== this.operation) return;
      this.update({ phase: 'idle' });
      throw error;
    }
  }

  async pauseOrResume() {
    const operation = this.operation;
    if (this.state.phase === 'paused') {
      await this.send(2, [1]);
      if (operation === this.operation && this.state.phase === 'paused') this.update({ phase: this.prePausePhase });
    } else if (this.state.phase === 'heating' || this.state.phase === 'brewing') {
      this.prePausePhase = this.state.phase;
      await this.send(2, [2]);
      if (operation === this.operation && brewPhases.includes(this.state.phase)) this.update({ phase: 'paused' });
    }
  }

  async stop() {
    if (!workingPhases.includes(this.state.phase)) return;
    this.operation++;
    clearTimeout(this.soakTimer);
    if (this.state.phase === 'draining') await this.send(3, [2]);
    else if (cleanPhases.includes(this.state.phase)) await this.stopCleaning();
    else await this.send(2, [3]);
    this.update({ phase: 'idle', message: '중지 명령을 보냈습니다.', temperature: null, seconds: null });
  }

  async drain() {
    this.checkReady();
    await this.send(3, [1]);
    this.update({ phase: 'draining', message: '', temperature: null, seconds: null });
  }

  async clean() {
    this.checkReady();
    this.update({ phase: 'checking-clean', message: '본체가 준비 상태인지 확인 중입니다.', seconds: null, temperature: null });
    try { await this.send(4); } catch (error) { this.update({ phase: 'idle' }); throw error; }
    if (this.state.phase === 'checking-clean') this.soakTimer = setTimeout(() => {
      this.update({ phase: 'idle', message: '본체가 준비 상태인지 확인한 뒤 다시 시도하세요.' });
    }, 12000);
  }

  startSoak() {
    this.update({ phase: 'soaking', message: '5분간 기다린 뒤 깨끗한 물로 헹굼을 시작하세요.', seconds: 300 });
    const end = Date.now() + 300000;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (seconds === 0) this.update({ phase: 'awaiting-rinse', seconds: 0, message: '깨끗한 물과 받침 용기를 준비하세요.' });
      else {
        this.update({ seconds });
        this.soakTimer = setTimeout(tick, 1000);
      }
    };
    this.soakTimer = setTimeout(tick, 1000);
  }

  async rinse() {
    if (this.state.phase !== 'awaiting-rinse') return;
    this.soakTimer = null;
    await this.send(13, [1]);
    this.update({ phase: 'rinsing', message: '본체에서 헹굼 진행을 확인하세요.', seconds: null });
  }

  async stopCleaning() {
    await this.send(13, [0]);
    await wait(200);
    await this.send(2, [3]);
  }

  async readFlow() {
    this.checkReady();
    this.update({ level: null });
    await this.send(12, [0]);
  }

  async setFlow(level) {
    this.checkReady();
    if (!Number.isInteger(level) || level < 1 || level > 9) throw new Error('유량을 1~9 사이로 설정하세요.');
    this.update({ level: null });
    await this.send(11, [level]);
    await wait(200);
    await this.send(12, [0]);
  }
}
