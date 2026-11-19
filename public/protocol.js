import { validateRecipe } from './recipes.js';

const uuid = short => `0000${short}-0000-1000-8000-00805f9b34fb`;
export const SERVICE = uuid('1000');
const WRITE = uuid('1001');
const NOTIFY = uuid('1002');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function isSmart7Name(name) {
  return /EVS[\s-]*70(?!\d)/i.test(name ?? '');
}

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
const connectionFailures = {
  link: '본체에 블루투스로 연결하지 못했습니다. 공식 앱의 연결을 해제한 뒤 다시 시도하세요.',
  services: '선택한 기기의 Smart7 블루투스 서비스를 찾지 못했습니다.',
  notifications: '본체의 PIN 알림을 설정하지 못했습니다.',
  'request-pin': '본체에 PIN을 요청하지 못했습니다.',
  'waiting-pin': '본체의 PIN 응답을 기다리다 시간이 초과됐습니다.',
  'display-pin': '본체에 PIN 표시 명령을 보내지 못했습니다.',
  'accept-pin': '본체에 PIN 인증 명령을 보내지 못했습니다.'
};
const deviceErrors = {
  1: '본체 센서 오류가 감지됐습니다.', 2: '물이 부족합니다.', 3: '온수 오류가 감지됐습니다.',
  4: '본체가 추출 설정을 거부했습니다.', 5: '본체가 명령을 거부했습니다.'
};

export class Smart7 {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = { connection: 'disconnected', connectionStage: null, phase: 'idle', alert: null, message: '', temperature: null, seconds: null, level: null };
    this.stageTimer = null;
    this.calibrating = false;
    this.calibrationAlerted = false;
    this.pending = new Uint8Array();
    this.queue = Promise.resolve();
    this.operation = 0;
    this.receive = event => this.receiveBytes(new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength));
    this.lost = () => this.reset(this.state.connection === 'connecting'
      ? connectionFailures[this.state.connectionStage] ?? '블루투스 연결이 끊겼습니다. 본체에서 상태를 확인하세요.'
      : '블루투스 연결이 끊겼습니다. 본체에서 상태를 확인하세요.');
  }

  update(values) {
    Object.assign(this.state, values);
    this.onChange(this.state);
  }

  async connect(reuse = false, savedId) {
    if (this.state.connection !== 'disconnected') return;
    const attempt = this.operation;
    const active = () => this.operation === attempt;
    let setupTimer;
    this.update({ connection: reuse ? 'connecting' : 'selecting', connectionStage: null, message: '', phase: 'idle' });
    try {
      const bluetooth = navigator.bluetooth;
      if (!bluetooth) throw new Error('이 브라우저에서 Web Bluetooth를 사용할 수 없습니다.');
      const device = reuse
        ? (await bluetooth.getDevices()).find(item => item.id === (savedId ?? localStorage.getItem('smart7-device')))
        : await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE] });
      if (!device) throw new Error('저장된 기기를 찾지 못했습니다. 기기 연결에서 다시 선택하세요.');
      if (!isSmart7Name(device.name)) throw new Error('목록에서 이름에 EVS-70이 포함된 Smart7 BT를 선택하세요.');
      if (!active()) return;
      this.device = device;
      this.update({ connection: 'connecting', connectionStage: 'link' });
      device.addEventListener('gattserverdisconnected', this.lost);
      const setup = async () => {
        // Give discovery time to stop, matching manual selection in the native app.
        if (!reuse) await wait(1500);
        if (!active()) return;
        const gatt = await device.gatt.connect();
        if (!active()) {
          if (this.device !== device && gatt.connected) gatt.disconnect();
          return;
        }
        this.update({ connectionStage: 'services' });
        const service = await gatt.getPrimaryService(SERVICE);
        if (!active()) return;
        const writer = await service.getCharacteristic(WRITE);
        if (!active()) return;
        const notifier = await service.getCharacteristic(NOTIFY);
        if (!active()) return;
        this.writer = writer;
        this.notifier = notifier;
        this.update({ connectionStage: 'notifications' });
        notifier.addEventListener('characteristicvaluechanged', this.receive);
        await notifier.startNotifications();
        if (!active()) return;
        this.update({ connectionStage: 'request-pin' });
        await wait(500);
        if (active()) await this.send(9);
      };
      await Promise.race([setup(), new Promise((_, reject) => {
        setupTimer = setTimeout(() => reject(new Error('Bluetooth setup timed out')), 15000);
      })]);
      if (active() && this.state.connection === 'connecting') {
        if (!this.expectedPin) this.update({ connectionStage: 'waiting-pin' });
        this.pinTimer = setTimeout(() => {
          this.disconnect(connectionFailures[this.state.connectionStage]);
        }, 12000);
      }
    } catch (error) {
      if (!active()) return;
      let message = error.message;
      if (this.state.connection === 'selecting') {
        if (error.name === 'NotFoundError') {
          message = '선택된 기기가 없습니다. Smart7이 보이지 않으면 공식 앱의 연결을 해제하고 Chrome의 주변 기기 권한을 확인하세요.';
        } else if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          message = 'Chrome의 사이트 블루투스 설정과 휴대폰의 Chrome 앱 권한을 확인한 뒤 BT 연결을 다시 누르세요.';
        }
      } else {
        message = connectionFailures[this.state.connectionStage] ?? message;
      }
      this.disconnect(message);
    } finally {
      clearTimeout(setupTimer);
    }
  }

  reset(message) {
    clearTimeout(this.pinTimer);
    this.clearStageTimer();
    this.notifier?.removeEventListener('characteristicvaluechanged', this.receive);
    this.device?.removeEventListener('gattserverdisconnected', this.lost);
    this.device = this.writer = this.notifier = this.expectedPin = null;
    this.pending = new Uint8Array();
    this.operation++;
    this.calibrationAlerted = false;
    this.update({ connection: 'disconnected', connectionStage: null, phase: 'idle', alert: null, message, temperature: null, seconds: null, level: null });
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
    if (command === 7 && this.state.connection === 'connecting' && data.length >= 6 && !this.expectedPin) {
      const digits = data.slice(0, 6).map(byte => byte & 15);
      if (digits.some(digit => digit > 9)) throw new Error('본체에서 지원되지 않는 PIN 형식이 도착했습니다.');
      const attempt = this.operation;
      this.expectedPin = digits.join('');
      const saved = localStorage.getItem(`smart7-pin-${this.device.id}`);
      try {
        if (saved === this.expectedPin) {
          this.update({ connectionStage: 'accept-pin' });
          await this.acceptPin(saved, true);
        } else {
          this.update({ connectionStage: 'display-pin' });
          await wait(200);
          if (attempt !== this.operation) return;
          await this.send(16);
          if (attempt !== this.operation) return;
          clearTimeout(this.pinTimer);
          this.update({ connection: 'pin', connectionStage: null, message: '' });
        }
      } catch {
        if (attempt === this.operation) this.disconnect(connectionFailures[this.state.connectionStage]);
      }
      return;
    }
    if (command === 6 && data[0] >= 1 && data[0] <= 9) this.update({ level: data[0] });
    const phase = this.state.phase;
    if (command === 3 && data.length === 1 && deviceErrors[data[0]] && workingPhases.includes(phase)) {
      this.operation++;
      this.clearStageTimer();
      const alert = data[0] === 3 && phase === 'starting' ? 'overheat' : null;
      this.update({ phase: 'idle', alert, temperature: null, seconds: null, message: deviceErrors[data[0]] });
      await this.send(2, [3]);
      return;
    }
    if (command !== 2 || data.length !== 4) return;
    const [mode, step, first, second] = data;
    if (mode === 1 && step === 0 && workingPhases.includes(phase)) {
      if (phase === 'draining') await this.send(13, [0]);
      this.disconnect('본체가 시작 화면으로 돌아갔습니다. 다시 연결해 주세요.');
      return;
    }
    if (this.state.alert) return;
    const brewBusy = phase === 'starting' && ((mode === 2 && (step === 2 || step === 3)) || mode === 3 || mode === 4);
    const drainBusy = phase === 'draining' && (mode === 2 || mode === 4);
    const cleaningBusy = (phase === 'checking-clean' || phase === 'cleaning') && (mode === 2 || mode === 3);
    const calibrationBusy = this.calibrating && !this.calibrationAlerted && this.state.connection === 'ready'
      && (phase === 'idle' || phase === 'complete') && (mode === 2 || mode === 3 || mode === 4);
    if (brewBusy || drainBusy || cleaningBusy || calibrationBusy) {
      this.operation++;
      this.clearStageTimer();
      this.alertPhase = calibrationBusy ? 'calibration' : phase;
      if (calibrationBusy) this.calibrationAlerted = true;
      this.update({ phase: 'idle', alert: 'busy', message: '기기가 사용 중입니다.', temperature: null, seconds: null });
      return;
    }
    if (brewPhases.includes(phase)) {
      if (mode === 2 && step === 1 && phase !== 'paused') this.update({ phase: 'heating', temperature: first });
      if (mode === 2 && step === 2 && phase !== 'paused') this.update({ phase: 'brewing', seconds: first * 60 + second });
      if (mode === 1 && step === 1 && first === 0 && second === 0 && (phase === 'heating' || phase === 'brewing')) {
        this.update({ phase: 'complete', alert: 'brew-complete', seconds: 0 });
      }
    }
    if (phase === 'draining' && mode === 3 && step === 1) {
      const confirmation = Promise.all([this.send(3, [2]), this.send(3, [2])]);
      this.update({ phase: 'complete', message: '배수가 완료됐습니다.' });
      await confirmation;
    }
    if (phase === 'checking-clean' && mode === 1 && step === 1) {
      this.clearStageTimer();
      this.update({ phase: 'cleaning', message: '세척 중입니다.' });
      await this.send(13, [1]);
    }
    if (phase === 'cleaning' && mode === 4 && step === 1) this.update({ temperature: first });
    if (phase === 'cleaning' && mode === 4 && step === 2 && first < 5) this.startSoak();
    if (phase === 'rinsing' && mode === 4 && step === 1) this.update({ temperature: first });
    if (phase === 'rinsing' && mode === 4 && step === 2 && this.stageTimer === null) {
      this.startCountdown(45, () => this.update({ phase: 'complete', alert: 'rinse-complete', seconds: 0, message: '헹굼이 완료됐습니다.' }));
    }
  }

  async acknowledgeAlert(drain = false) {
    const { alert } = this.state;
    if (!alert) return;
    const alertsWithMessage = { 'rinse-complete': '헹굼이 완료됐습니다.', 'brew-complete': '추출이 완료됐습니다.' };
    try {
      if (alert === 'busy' && this.alertPhase !== 'calibration') await this.cancelOperation(this.alertPhase);
      else if (alert === 'overheat' && !drain) await this.send(2, [3]);
    } finally {
      this.update({ alert: null, message: alertsWithMessage[alert] ?? '' });
    }
    return alert === 'overheat' && drain;
  }

  async acceptPin(input, remember) {
    if (!this.expectedPin || input !== this.expectedPin) throw new Error('본체 화면에 표시된 PIN과 일치하지 않습니다.');
    await this.send(15);
    const id = this.device.id;
    localStorage.setItem('smart7-device', id);
    if (remember) localStorage.setItem(`smart7-pin-${id}`, input);
    else localStorage.removeItem(`smart7-pin-${id}`);
    clearTimeout(this.pinTimer);
    this.expectedPin = null;
    this.update({ connection: 'ready', connectionStage: null, message: '' });
  }

  async cancelPin() {
    try { await this.send(17); } finally { this.disconnect(); }
  }

  checkReady() {
    if (this.state.connection !== 'ready') throw new Error('먼저 본체 연결과 PIN 확인을 완료하세요.');
    if (this.state.alert || workingPhases.includes(this.state.phase)) throw new Error('진행 중인 작업을 먼저 종료하세요.');
  }

  async prepareBrew() {
    this.checkReady();
    await this.send(3, [2]);
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
    const phase = this.state.phase;
    if (!workingPhases.includes(phase)) return;
    this.operation++;
    this.clearStageTimer();
    await this.cancelOperation(phase);
    this.update({ phase: 'idle', message: '중지 명령을 보냈습니다.', temperature: null, seconds: null });
  }

  async cancelOperation(phase) {
    if (phase === 'draining') await this.send(3, [2]);
    else if (phase === 'rinsing') await this.send(13, [0]);
    else if (phase === 'checking-clean' || phase === 'cleaning') await this.stopCleaning();
    else await this.send(2, [3]);
  }

  async drain() {
    this.checkReady();
    this.update({ phase: 'draining', message: '', temperature: null, seconds: null });
    try { await this.send(3, [1]); }
    catch (error) { if (this.state.phase === 'draining') this.update({ phase: 'idle' }); throw error; }
  }

  async clean() {
    this.checkReady();
    this.update({ phase: 'checking-clean', message: '본체가 준비 상태인지 확인 중입니다.', seconds: null, temperature: null });
    try { await this.send(4); } catch (error) { this.update({ phase: 'idle' }); throw error; }
    if (this.state.phase === 'checking-clean') this.stageTimer = setTimeout(() => {
      this.update({ phase: 'idle', message: '본체가 준비 상태인지 확인한 뒤 다시 시도하세요.' });
    }, 12000);
  }

  startSoak() {
    this.update({ phase: 'soaking', message: '5분간 기다린 뒤 깨끗한 물로 헹굼을 시작하세요.' });
    this.startCountdown(300, () => this.update({ phase: 'awaiting-rinse', seconds: 0, message: '깨끗한 물과 받침 용기를 준비하세요.' }));
  }

  clearStageTimer() {
    clearTimeout(this.stageTimer);
    this.stageTimer = null;
  }

  startCountdown(duration, complete) {
    const end = Date.now() + duration * 1000;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (seconds === 0) {
        this.stageTimer = null;
        complete();
        return;
      }
      this.stageTimer = setTimeout(tick, 1000);
      this.update({ seconds });
    };
    tick();
  }

  async rinse() {
    if (this.state.phase !== 'awaiting-rinse') return;
    this.clearStageTimer();
    this.update({ phase: 'rinsing', message: '본체에서 헹굼 진행을 확인하세요.', seconds: null });
    try { await this.send(13, [1]); }
    catch (error) {
      if (this.state.phase === 'rinsing') {
        this.clearStageTimer();
        this.update({ phase: 'awaiting-rinse', seconds: 0 });
      }
      throw error;
    }
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

  showCalibration(open) {
    this.calibrating = open;
    this.calibrationAlerted = false;
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
