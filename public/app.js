import { automaticRecipe, parseRecipeFile, summarize, validateRecipe } from './recipes.js';
import { recipePhoto } from './recipe-photos.js';
import { getCommunityIssue, issueImage, issueRecipe, issueTitle, issueUrl, listCommunityIssues, listIssueComments, recipeProposalUrl } from './community-recipes.js';
import { isSmart7Name, Smart7, workingPhases } from './protocol.js';
import { drawBrewGraph } from './brew-graph.js';
import { localizeStatic, setLanguage, t } from './i18n.js';
import { drawRecipeCrop } from './recipe-photo.js';
import { bindReorder } from './reorder.js';
import { canTranslateRecipe, translateRecipe, translationLink } from './translate-recipe.js';

const $ = id => document.getElementById(id);
const auto = $('auto-settings');
const custom = $('custom-settings');
const pinDialog = $('pin-dialog');
const pinForm = $('pin-form');
const confirmDialog = $('confirm-dialog');
const deviceDialog = $('device-dialog');
const cropDialog = $('crop-dialog');
const waterDialog = $('water-dialog');
const cleanGuide = $('clean-guide');
const switchDialog = $('switch-dialog');
const overwriteDialog = $('overwrite-dialog');
const postDialog = $('post-dialog');
const postForm = $('post-form');
const translatePage = localizeStatic(document.body);
const storageKey = 'smart7-recipes';
let mode = 'auto';
let route = 'home';
let shownScreen = '';
let postDraft;
let topicNumber;
let topicRequest = 0;
let topicRecipe;
let topicTranslation;
let selected = '';
let lastPreview = '';
let activeRecipe;
let draftPhoto;
let photoRead = 0;
let cropBitmap;
let graphSteps = [];
let graphElapsed;
let recipes = [];
let actionInProgress = false;
let wakeLock;
let requestingWakeLock = false;
let installPrompt;
let waterConfirmed = false;
let cleanStep = 1;
let knownDevices = [];
let previousConnection = 'disconnected';
const cupSettings = new Map();
let deviceAliases;

try {
  const saved = localStorage.getItem(storageKey);
  recipes = saved === null
    ? [{ ...automaticRecipe(2, 'normal', 93), id: 'default-a', name: 'default A', grounds: 18 }]
    : JSON.parse(saved);
} catch { recipes = []; }
if (!Array.isArray(recipes)) recipes = [];
try { deviceAliases = new Map(Object.entries(JSON.parse(localStorage.getItem('smart7-aliases') || '{}'))); }
catch { deviceAliases = new Map(); }

const connectionLabels = {
  disconnected: '연결 안 됨', selecting: '기기 선택 대기', connecting: '연결 중', pin: 'PIN 확인', ready: 'Smart7 연결됨'
};
const connectionStages = {
  link: '본체에 블루투스 연결 중',
  services: '본체의 블루투스 서비스 확인 중',
  notifications: '본체 응답 알림 설정 중',
  'request-pin': '본체에 PIN 요청 중',
  'waiting-pin': '본체 PIN 응답 대기',
  'display-pin': '본체에 PIN 표시 요청 중',
  'accept-pin': '본체 PIN 인증 중'
};
const phaseLabels = {
  idle: '대기', starting: '명령 전송 중', heating: '가열 중', brewing: '추출 중', paused: '일시 정지',
  complete: '완료', draining: '배수 중', 'checking-clean': '상태 확인 중', cleaning: '세척 중',
  soaking: '세척 대기', 'awaiting-rinse': '헹굼 준비', rinsing: '헹굼 중'
};
const deviceAlerts = {
  busy: ['기기가 사용 중입니다', '본체에서 진행 중인 작업을 확인하세요. 확인을 누르면 요청한 작업을 취소합니다.'],
  overheat: ['탱크 수온이 너무 높습니다', '탱크의 물을 60°C 미만으로 식혀 주세요. 배수하려면 배출구 아래에 내열 용기를 놓으세요.'],
  'rinse-complete': ['헹굼 완료', '헹굼이 완료됐습니다.'],
  'brew-complete': ['추출 완료', '추출이 완료됐습니다.']
};
const userAgent = navigator.userAgent;
const appleMobile = /iPhone|iPad|iPod/i.test(userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(userAgent);
const chrome = !/(?:SamsungBrowser|Edg(?:A|iOS)?|OPR|Opera|Whale|Vivaldi|YaBrowser|DuckDuckGo|MiuiBrowser|HuaweiBrowser|KAKAOTALK)\/|; wv\)/i.test(userAgent)
  && (navigator.userAgentData?.brands?.some(({ brand }) => brand === 'Google Chrome') ?? /Chrome\//i.test(userAgent));
const supported = !appleMobile && window.isSecureContext && !!navigator.bluetooth;
const screenParents = { auto: 'home', recipes: 'home', editor: 'recipes', library: 'home', 'community-topic': 'library', maintenance: 'home' };
const sections = [...document.querySelectorAll('.screen')];
const listScroll = new Map();

function showScreen(state) {
  const busy = workingPhases.includes(state.phase);
  const finished = state.alert?.endsWith('-complete');
  const current = finished ? 'result' : busy ? 'operation' : route;
  const panel = ['auto', 'editor', 'operation'].includes(current) ? 'brew' : current;
  $('back').hidden = ['home', 'operation', 'result'].includes(current);
  $('compatibility').hidden = current !== 'home';
  $('footer').hidden = current !== 'home';
  document.body.dataset.screen = current;
  document.querySelector('.recipe-settings').hidden = current === 'operation';
  $('brew-title').textContent = t(current === 'operation' ? phaseLabels[state.phase] : current === 'editor' ? '내 레시피 편집' : '자동 모드');
  $('phase').hidden = current === 'operation';
  $('brew').classList.toggle('maintenance-operation', current === 'operation' && !activeRecipe);
  if (current !== shownScreen) {
    const enteringBrew = current === 'operation' && !!activeRecipe;
    if (shownScreen === 'recipes' || shownScreen === 'library') listScroll.set(shownScreen, window.scrollY);
    shownScreen = current;
    for (const section of sections) section.hidden = section.id !== panel;
    if (enteringBrew) $('brew-details').open = true;
    window.scrollTo(0, listScroll.get(current) || 0);
    $(panel).querySelector('h2')?.focus({ preventScroll: true });
  }
}

function setMode(next) {
  if (mode === next) return;
  mode = next;
  auto.hidden = mode !== 'auto';
  custom.hidden = mode !== 'custom';
  settingsChanged();
}

function applyRoute() {
  const hash = location.hash.slice(1);
  if (workingPhases.includes(brewer.state.phase) || brewer.state.alert?.endsWith('-complete')) {
    history.replaceState(history.state, '', route === 'home' ? location.pathname + location.search : location.pathname + location.search + '#' + route);
    return;
  }
  const number = /^community\/([1-9]\d*)$/.exec(hash)?.[1];
  const archiveId = /^shared\/([1-9]\d*)$/.exec(hash)?.[1];
  const topic = number ?? (archiveId ? 'archive-' + archiveId : null);
  const next = topic ? 'community-topic' : Object.hasOwn(screenParents, hash) && hash !== 'community-topic' ? hash : 'home';
  const enteringBoard = next === 'library' && route !== 'library';
  const enteringTopic = next === 'community-topic' && (route !== next || topicNumber !== topic);
  if (route === 'maintenance' && next !== route) {
    $('flow-tools').open = false;
    brewer.showCalibration(false);
  }
  route = next;
  if (route === 'auto') setMode('auto');
  if (route === 'editor') setMode('custom');
  render(brewer.state);
  if (enteringBoard) void loadCommunityBoard();
  if (enteringTopic) {
    topicNumber = topic;
    void loadCommunityTopic();
  }
}

function go(hash, replace = false) {
  const target = hash === 'home' ? '' : '#' + hash;
  if (target !== location.hash) {
    history[replace ? 'replaceState' : 'pushState']({ smart7Parent: route }, '', location.pathname + location.search + target);
  }
  applyRoute();
}

function renderCompatibility() {
  let message = '기기 선택 창에서 EVS-70을 선택하세요.';
  if (appleMobile) message = 'Smart7 본체를 연결하려면 Android Chrome으로 접속해 주세요.';
  else if (!chrome) message = 'Smart7을 연결하려면 Google Chrome에서 이 주소를 다시 열어 주세요.';
  else if (!supported) message = '블루투스 연결은 HTTPS에서 Android 또는 데스크톱 Chrome을 사용하세요.';
  else if (android) message = '권한 요청이 나오면 허용하고 기기 선택 창에서 EVS-70을 선택하세요.';
  $('compatibility').textContent = t(message);
}

function formRecipe() {
  if (mode === 'auto') {
    const fields = new FormData(auto);
    const cups = Number(fields.get('cups'));
    const speed = fields.get('speed');
    return { ...automaticRecipe(cups, speed, Number(fields.get('temperature'))), speed, name: t('자동 추출 {cups}잔', { cups }) };
  }
  return {
    name: custom.elements.namedItem('name').value,
    temperature: custom.elements.namedItem('temperature').valueAsNumber,
    grounds: custom.elements.namedItem('grounds').value === '' ? undefined : custom.elements.namedItem('grounds').valueAsNumber,
    beans: custom.elements.namedItem('beans').value,
    grind: custom.elements.namedItem('grind').value,
    source: recipes.find(recipe => recipe.id === selected)?.source,
    photo: draftPhoto,
    steps: [...$('steps').children].map(row => {
      const [volume, pour, wait] = [...row.querySelectorAll('input')].map(input => input.valueAsNumber);
      return { volume, pour, wait };
    })
  };
}

function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderSummary(state) {
  const recipe = activeRecipe || formRecipe();
  const steps = recipe.steps.filter(step => [step.volume, step.pour, step.wait].every(Number.isFinite)
    && step.volume > 0 && step.pour > 0 && step.wait >= 0);
  const totals = summarize(steps);
  const volumeUnit = document.createElement('small');
  volumeUnit.textContent = ' mL';
  $('volume').replaceChildren(totals.volume ? `${totals.volume}` : '—', volumeUnit);
  const seconds = state.seconds ?? totals.seconds;
  const maintenance = shownScreen === 'operation' && !activeRecipe;
  $('timer').textContent = maintenance && state.seconds == null ? '—' : formatDuration(seconds);
  $('timer-label').textContent = t(state.seconds == null ? '예상 추출 시간' : '남은 시간');
  $('recipe-title').textContent = maintenance ? t('기기 관리') : (recipe.name || t('새 레시피'));
  showPhoto($('summary-photo'), maintenance ? null : recipe.photo);
  const preview = JSON.stringify(steps);
  if (preview !== lastPreview) {
    lastPreview = preview;
    $('preview-steps').replaceChildren(...steps.map(step => {
      const item = document.createElement('li');
      item.textContent = t('{volume} mL · {pour}초 붓기 · {wait}초 대기', step);
      return item;
    }));
  }
  graphSteps = steps;
  graphElapsed = activeRecipe && state.seconds != null ? totals.seconds - state.seconds : undefined;
  repaintGraph();
}

function repaintGraph() {
  if ($('brew-details').open) drawBrewGraph($('brew-graph'), graphSteps, graphElapsed);
}

function showPhoto(image, photo) {
  image.hidden = !photo;
  if (!photo) image.removeAttribute('src');
  else if (image.getAttribute('src') !== photo) image.src = photo;
}

function renderBrewResult(recipe) {
  $('brew-result').hidden = !recipe;
  if (!recipe) return;
  showPhoto($('brew-result-photo'), recipe.photo);
  const totals = summarize(recipe.steps);
  const rows = [
    ['레시피 이름', recipe.name], ['물 온도', `${recipe.temperature} °C`],
    ['총 물량', `${totals.volume} mL`], ['예상 추출 시간', formatDuration(totals.seconds)]
  ];
  if (recipe.grounds != null) rows.push(['원두량 (g)', `${recipe.grounds} g`]);
  if (recipe.speed) rows.push(['추출 속도', t(recipe.speed === 'fast' ? '빠르게' : '기본')]);
  $('brew-result-values').replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = t(label);
    detail.textContent = value;
    return [term, detail];
  }));
}

function render(state) {
  const busy = workingPhases.includes(state.phase);
  const ready = state.connection === 'ready';
  const disconnected = state.connection === 'disconnected';
  const connectedNow = ready && previousConnection !== 'ready';
  previousConnection = state.connection;
  const locked = actionInProgress || busy || !!state.alert;
  if (!['starting', 'heating', 'brewing', 'paused', 'complete'].includes(state.phase)) activeRecipe = null;
  const alias = ready && deviceAliases.get(brewer.device?.id);
  const connection = t(connectionStages[state.connectionStage] ?? connectionLabels[state.connection]);
  $('connection').textContent = alias ? `${connection} · ${alias}` : connection;
  if (disconnected) waterConfirmed = false;
  $('connection-dot').className = ready ? 'ready' : disconnected ? '' : 'pending';
  $('connect').disabled = !supported || !disconnected;
  $('connect').hidden = ready;
  $('reconnect').hidden = !disconnected || !supported || !navigator.bluetooth?.getDevices || !localStorage.getItem('smart7-device');
  $('reconnect').disabled = actionInProgress;
  $('disconnect').hidden = !ready || busy;
  $('phase').textContent = t(phaseLabels[state.phase]);
  $('live-temperature').hidden = state.temperature == null;
  $('temperature-reading').textContent = state.temperature == null ? '' : `${state.temperature} °C`;
  $('notice').hidden = !state.message || !!state.alert?.endsWith('-complete');
  $('notice').textContent = t(state.message);
  $('start').disabled = !supported || (!ready && !disconnected) || locked;
  $('start').hidden = busy;
  $('pause').hidden = !['heating', 'brewing', 'paused'].includes(state.phase);
  $('pause').textContent = t(state.phase === 'paused' ? '계속 추출' : '일시 정지');
  $('pause').disabled = actionInProgress;
  $('stop').hidden = !busy || !ready;
  $('stop').disabled = false;
  for (const id of ['drain', 'clean', 'read-flow']) $(id).disabled = !supported || locked;
  $('rinse').hidden = state.phase !== 'awaiting-rinse';
  $('rinse').disabled = actionInProgress;
  $('current-flow').value = state.level ?? '—';
  for (const button of $('flow-levels').children) {
    const level = Number(button.value);
    button.disabled = !supported || locked;
    button.classList.toggle('is-filled', state.level != null && level <= state.level);
    button.setAttribute('aria-pressed', String(state.level === level));
  }
  renderDeviceControls(locked);
  if (connectedNow && $('device-tools').open) void refreshKnownDevices();
  if (connectedNow && $('flow-tools').open) queueMicrotask(() => void run(() => brewer.readFlow()));
  document.querySelector('.recipe-settings').inert = locked;
  $('home').inert = locked;
  if (state.connection === 'pin' && !pinDialog.open) {
    pinForm.reset();
    $('pin-error').hidden = true;
    pinDialog.showModal();
    pinForm.elements.namedItem('pin').focus();
  } else if (state.connection !== 'pin' && pinDialog.open) pinDialog.close();
  if (state.alert?.endsWith('-complete')) {
    const [title] = deviceAlerts[state.alert];
    $('result-title').textContent = t(title);
    $('finish-operation').disabled = actionInProgress;
    renderBrewResult(state.alert === 'brew-complete' ? activeRecipe : null);
    if (deviceDialog.open) deviceDialog.close();
  } else if (state.alert) {
    const hot = state.alert === 'overheat';
    const [title, message] = deviceAlerts[state.alert];
    $('device-alert-title').textContent = t(title);
    $('device-alert-text').textContent = t(message);
    $('dismiss-device-alert').textContent = t(hot ? '돌아가기' : '확인');
    $('overheat-drain').hidden = !hot;
    $('overheat-drain').disabled = actionInProgress;
    $('dismiss-device-alert').disabled = actionInProgress;
    if (!deviceDialog.open) deviceDialog.showModal();
  } else if (deviceDialog.open) {
    deviceDialog.close();
  }
  showScreen(state);
  renderSummary(state);
  holdScreen(busy);
}

const brewer = new Smart7(render);

async function holdScreen(busy) {
  if (!busy && wakeLock) {
    const current = wakeLock;
    wakeLock = null;
    await current.release().catch(() => {});
  }
  if (busy && !wakeLock && !requestingWakeLock && navigator.wakeLock && !document.hidden) {
    requestingWakeLock = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!workingPhases.includes(brewer.state.phase)) await lock.release();
      else {
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      }
    } catch { /* Screen wake lock is optional. */ }
    finally { requestingWakeLock = false; }
  }
}

async function run(action) {
  if (actionInProgress) return;
  actionInProgress = true;
  render(brewer.state);
  try { await action(); }
  catch (error) { brewer.update({ message: error.message }); }
  finally { actionInProgress = false; render(brewer.state); }
}

function confirmAction(title, text, action) {
  if (confirmDialog.open || actionInProgress) return;
  $('confirm-title').textContent = t(title);
  $('confirm-text').textContent = t(text);
  confirmDialog.returnValue = '';
  confirmDialog.addEventListener('close', () => {
    if (confirmDialog.returnValue === 'confirm') void run(action);
  }, { once: true });
  confirmDialog.showModal();
}

function refreshOptions() {
  const first = new Option(t('새 레시피'), '');
  $('saved-recipes').replaceChildren(first, ...recipes.map(recipe => new Option(recipe.name, recipe.id)));
  $('saved-recipes').value = selected;
  $('delete-recipe').hidden = selected === '';
  $('copy-recipe').hidden = selected === '';
  $('replace-auto').hidden = recipes.length === 0;
  $('replace-recipe').hidden = !recipes.some(recipe => recipe.id !== selected);
  $('export-recipes').disabled = !recipes.length;
  const index = recipes.findIndex(item => item.id === selected);
  $('recipe-order').hidden = index < 0 || recipes.length < 2;
  $('recipe-up').disabled = index <= 0;
  $('recipe-down').disabled = index < 0 || index === recipes.length - 1;
  renderSavedCards();
}

function moveRecipe(offset) {
  const index = recipes.findIndex(item => item.id === selected);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= recipes.length) return;
  reorderRecipe(index, target);
}

function reorderRecipe(from, to) {
  const next = [...recipes];
  next.splice(to, 0, next.splice(from, 1)[0]);
  try {
    saveRecipes(next);
    refreshOptions();
  } catch (error) { brewer.update({ message: error.message }); }
}

function renumber() {
  const rows = [...$('steps').children];
  rows.forEach((row, index) => {
    row.querySelector('.number').textContent = String(index + 1).padStart(2, '0');
    const [up, down, remove] = row.querySelectorAll('button');
    up.disabled = index < 2;
    down.disabled = index === 0 || index === rows.length - 1;
    remove.disabled = index === 0;
    up.setAttribute('aria-label', t('{index}단계 위로', { index: index + 1 }));
    down.setAttribute('aria-label', t('{index}단계 아래로', { index: index + 1 }));
    remove.setAttribute('aria-label', t('{index}단계 삭제', { index: index + 1 }));
    row.querySelector('.number').title = index === 0 ? t('뜸들이기') : '';
    row.querySelector('[data-drag-handle]').hidden = index === 0;
  });
  $('add-step').disabled = rows.length >= 11;
}

function appendStep(step = { volume: 70, pour: 13, wait: 0 }) {
  const row = document.createElement('div');
  row.className = 'recipe-step';
  const number = document.createElement('span');
  number.className = 'number';
  row.append(number);
  for (const [key, title, min, max, increment] of [
    ['volume', '물량 (mL)', 20, 700, 10], ['pour', '붓기 (초)', 2, 80, 1], ['wait', '대기 (초)', 0, 60, 1]
  ]) {
    const label = document.createElement('label');
    label.dataset.stepLabel = title;
    label.textContent = t(title);
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min, max, step: increment, value: step[key], required: true });
    label.append(input);
    row.append(label);
  }
  const controls = document.createElement('div');
  controls.className = 'step-buttons';
  controls.append(dragHandle());
  for (const [symbol, action] of [
    ['↑', () => row.parentNode.insertBefore(row, row.previousElementSibling)],
    ['↓', () => row.parentNode.insertBefore(row.nextElementSibling, row)],
    ['×', () => row.remove()]
  ]) {
    const button = document.createElement('button');
    Object.assign(button, { type: 'button', className: 'quiet', textContent: symbol });
    button.addEventListener('click', () => { action(); renumber(); settingsChanged(); });
    controls.append(button);
  }
  row.append(controls);
  $('steps').append(row);
  renumber();
}

function loadRecipe(id) {
  selected = id;
  const recipe = recipes.find(item => item.id === id) || automaticRecipe(2, 'normal', 93);
  photoRead++;
  if (cropDialog.open) cropDialog.close('cancel');
  setDraftPhoto(recipe.photo);
  custom.elements.namedItem('name').value = id ? recipe.name : '';
  custom.elements.namedItem('temperature').value = recipe.temperature;
  custom.elements.namedItem('grounds').value = recipe.grounds ?? '';
  custom.elements.namedItem('beans').value = recipe.beans ?? '';
  custom.elements.namedItem('grind').value = recipe.grind ?? '';
  const source = $('recipe-source');
  source.hidden = !recipe.source;
  if (recipe.source) {
    source.href = recipe.source.url;
    source.textContent = recipe.source.label;
  } else {
    source.removeAttribute('href');
    source.textContent = '';
  }
  $('steps').replaceChildren();
  for (const step of recipe.steps) appendStep(step);
  refreshOptions();
  settingsChanged();
}

function saveRecipes(items) {
  try { localStorage.setItem(storageKey, JSON.stringify(items)); }
  catch (error) {
    if (error.name === 'QuotaExceededError') throw new Error('브라우저 저장 공간이 부족합니다. 레시피를 백업한 뒤 공간을 비워 주세요.');
    throw error;
  }
  recipes = items;
}

function renderDeviceControls(locked) {
  const id = $('known-devices').value;
  const state = brewer.state.connection;
  const connecting = state === 'selecting' || state === 'connecting' || state === 'pin';
  $('known-devices').disabled = !knownDevices.length || locked || connecting;
  $('device-alias').disabled = !id || locked || connecting;
  $('save-alias').disabled = !id || locked || connecting;
  $('use-device').disabled = !supported || !id || locked || connecting || brewer.device?.id === id;
  $('pick-device').disabled = !supported || locked || connecting;
}

function renderKnownDevices() {
  const picker = $('known-devices');
  const selection = picker.value || brewer.device?.id || localStorage.getItem('smart7-device');
  const options = knownDevices.map(device => new Option(deviceAliases.get(device.id) || device.name || 'Smart7', device.id));
  picker.replaceChildren(...(options.length ? options : [new Option(t('저장된 기기 없음'), '')]));
  if (knownDevices.some(device => device.id === selection)) picker.value = selection;
  $('device-alias').value = deviceAliases.get(picker.value) || '';
  render(brewer.state);
}

async function refreshKnownDevices() {
  let granted = [];
  if (supported && navigator.bluetooth.getDevices) {
    try { granted = await navigator.bluetooth.getDevices(); } catch { /* Connecting through the picker is still available. */ }
  }
  const current = brewer.device;
  if (current && !granted.some(device => device.id === current.id)) granted.push(current);
  knownDevices = granted.filter(device => isSmart7Name(device.name));
  renderKnownDevices();
}

function requestOperationConnection() {
  if (brewer.state.connection === 'ready') return true;
  if (supported && brewer.state.connection === 'disconnected') {
    const reuse = Boolean(navigator.bluetooth.getDevices && localStorage.getItem('smart7-device'));
    void brewer.connect(reuse);
  }
  return false;
}

function showDrainPreparation() {
  waterConfirmed = false;
  go('maintenance');
  $('drain-tools').open = true;
  $('drain-tools').scrollIntoView({ block: 'nearest' });
  $('drain').focus();
}

async function checkTank() {
  if (waterConfirmed) return true;
  if (waterDialog.open || brewer.state.connection !== 'ready') return false;
  waterDialog.returnValue = '';
  const choice = await new Promise(resolve => {
    waterDialog.addEventListener('close', () => resolve(waterDialog.returnValue), { once: true });
    waterDialog.showModal();
  });
  if (choice === 'drain') showDrainPreparation();
  if (choice !== 'ready') return false;
  try {
    await brewer.prepareBrew();
    waterConfirmed = true;
  } catch (error) { brewer.update({ message: error.message }); }
  return waterConfirmed;
}

function showCleanStep(step) {
  cleanStep = step;
  $('clean-step-one').hidden = step !== 1;
  $('clean-step-two').hidden = step !== 2;
  $('clean-guide-back').hidden = step === 1;
  $('clean-guide-next').hidden = step !== 1;
  $('clean-guide-start').hidden = step !== 2;
}

function recipeKey(recipe) {
  const steps = recipe.steps.map(({ volume, pour, wait }) => [volume, pour, wait]);
  return JSON.stringify([recipe.name.trim(), recipe.temperature, recipe.grounds || 0, steps]);
}

function addRecipes(items) {
  const next = [...recipes];
  const saved = new Map(recipes.map((recipe, index) => [recipeKey(recipe), index]));
  let firstId;
  let updated = 0;
  for (const recipe of items) {
    const key = recipeKey(recipe);
    let index = saved.get(key);
    if (index === undefined) {
      index = next.length;
      next.push({ id: crypto.randomUUID(), ...recipe });
      saved.set(key, index);
    } else {
      const missing = ['photo', 'beans', 'grind'].filter(field => recipe[field] && !next[index][field]);
      if (missing.length) {
        next[index] = { ...next[index], ...Object.fromEntries(missing.map(field => [field, recipe[field]])) };
        updated++;
      }
    }
    firstId ??= next[index].id;
  }
  const added = next.length - recipes.length;
  if (added || updated) saveRecipes(next);
  return { firstId, added, updated };
}

function settingsChanged() {
  if (!workingPhases.includes(brewer.state.phase)) {
    activeRecipe = null;
    if (brewer.state.phase === 'complete') brewer.update({ phase: 'idle', seconds: null, temperature: null, message: '' });
  }
  renderSummary(brewer.state);
}

function setDraftPhoto(photo) {
  draftPhoto = photo;
  showPhoto($('photo-preview'), photo);
  $('remove-photo').hidden = !photo;
}

async function pickPhoto(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const reading = ++photoRead;
  try {
    if (file.size > 20000000 || !file.type.startsWith('image/')) throw new Error('20MB 이하 이미지 파일을 선택하세요.');
    const bitmap = await createImageBitmap(file);
    if (reading !== photoRead) { bitmap.close(); return; }
    cropBitmap?.close();
    cropBitmap = bitmap;
    cropDialog.querySelector('form').reset();
    cropDialog.returnValue = '';
    paintCrop();
    if (!cropDialog.open) cropDialog.showModal();
  } catch (error) {
    if (reading === photoRead) brewer.update({ message: error.name === 'InvalidStateError' ? '이미지를 열 수 없습니다.' : error.message });
  }
}

function paintCrop() {
  if (!cropBitmap) return;
  drawRecipeCrop($('photo-crop'), cropBitmap, $('crop-zoom').valueAsNumber / 100,
    $('crop-x').valueAsNumber / 100, $('crop-y').valueAsNumber / 100);
}

window.addEventListener('popstate', applyRoute);
window.addEventListener('hashchange', applyRoute);
$('back').addEventListener('click', () => {
  const parent = screenParents[route];
  if (parent === history.state?.smart7Parent) history.back();
  else if (parent) go(parent, true);
});
document.querySelector('.console-menu').addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const destination = link.hash.slice(1);
  go(destination);
  if (destination === 'auto' || destination === 'recipes') {
    waterConfirmed = false;
    if (brewer.state.connection === 'ready') void checkTank();
  }
});
auto.addEventListener('change', event => {
  const { cups, temperature, speed } = auto.elements;
  if (event.target.name === 'cups') {
    const preferences = cupSettings.get(cups.value);
    temperature.value = preferences?.temperature ?? '93';
    speed.value = preferences?.speed ?? 'normal';
  } else {
    cupSettings.set(cups.value, { temperature: temperature.value, speed: speed.value });
  }
  settingsChanged();
});
custom.addEventListener('input', settingsChanged);
$('saved-recipes').addEventListener('change', event => loadRecipe(event.target.value));
$('new-recipe').addEventListener('click', () => loadRecipe(''));
$('recipe-up').addEventListener('click', () => moveRecipe(-1));
$('recipe-down').addEventListener('click', () => moveRecipe(1));
$('add-step').addEventListener('click', () => { appendStep(); settingsChanged(); });
$('brew-details').addEventListener('toggle', repaintGraph);
new ResizeObserver(repaintGraph).observe($('brew-graph'));
$('recipe-photo').addEventListener('change', pickPhoto);
$('take-photo').addEventListener('change', pickPhoto);
cropDialog.addEventListener('input', paintCrop);
cropDialog.addEventListener('close', () => {
  if (cropDialog.returnValue === 'apply' && cropBitmap) {
    setDraftPhoto($('photo-crop').toDataURL('image/jpeg', 0.84));
    settingsChanged();
  }
  cropBitmap?.close();
  cropBitmap = null;
});
$('remove-photo').addEventListener('click', () => { photoRead++; setDraftPhoto(undefined); settingsChanged(); });
custom.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const recipe = validateRecipe(formRecipe());
    const id = selected || crypto.randomUUID();
    const saved = { id, ...recipe };
    saveRecipes(selected ? recipes.map(item => item.id === id ? saved : item) : [...recipes, saved]);
    selected = id;
    refreshOptions();
    brewer.update({ message: '레시피를 이 브라우저에 저장했습니다.' });
  } catch (error) { brewer.update({ message: error.message }); }
});

function openSavedRecipe(id) {
  setMode('custom');
  loadRecipe(id);
  go('editor');
}
$('create-recipe').addEventListener('click', () => openSavedRecipe(''));

function saveCopy(fromAuto) {
  try {
    const recipe = formRecipe();
    const name = fromAuto ? recipe.name : t('{name} 복사본', { name: recipe.name.slice(0, 43) });
    const id = crypto.randomUUID();
    saveRecipes([...recipes, { id, ...validateRecipe({ ...recipe, name, photo: undefined }) }]);
    openSavedRecipe(id);
    brewer.update({ message: '레시피를 이 브라우저에 저장했습니다.' });
  } catch (error) { brewer.update({ message: error.message }); }
}
$('save-auto').addEventListener('click', () => saveCopy(true));
$('copy-recipe').addEventListener('click', () => saveCopy(false));
function replaceRecipe(fromAuto) {
  try {
    const replacement = validateRecipe({ ...formRecipe(), photo: undefined });
    const targets = fromAuto ? recipes : recipes.filter(recipe => recipe.id !== selected);
    $('overwrite-target').replaceChildren(...targets.map(recipe => new Option(recipe.name, recipe.id)));
    overwriteDialog.returnValue = '';
    overwriteDialog.addEventListener('close', () => {
      if (overwriteDialog.returnValue !== 'overwrite') return;
      const id = $('overwrite-target').value;
      if (!recipes.some(recipe => recipe.id === id)) return;
      try {
        saveRecipes(recipes.map(recipe => recipe.id === id ? { id, ...replacement } : recipe));
        openSavedRecipe(id);
        brewer.update({ message: '선택한 레시피에 설정을 덮어썼습니다.' });
      } catch (error) { brewer.update({ message: error.message }); }
    }, { once: true });
    overwriteDialog.showModal();
  } catch (error) { brewer.update({ message: error.message }); }
}
$('replace-auto').addEventListener('click', () => replaceRecipe(true));
$('replace-recipe').addEventListener('click', () => replaceRecipe(false));
$('delete-recipe').addEventListener('click', () => confirmAction('저장한 레시피 삭제', '이 브라우저에서 선택한 레시피를 삭제합니다.', () => {
  saveRecipes(recipes.filter(item => item.id !== selected));
  loadRecipe('');
  brewer.update({ message: '레시피를 삭제했습니다.' });
}));
function exportFile(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-recipe').addEventListener('click', () => {
  try { exportFile(validateRecipe(formRecipe()), 'smart7-recipe.json'); }
  catch (error) { brewer.update({ message: error.message }); }
});
$('export-recipes').addEventListener('click', () => exportFile({ version: 1, recipes }, 'smart7-recipes.json'));
$('import-recipes').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 12000000) throw new Error('12MB 이하 레시피 파일을 선택하세요.');
    const imported = parseRecipeFile(await file.text());
    const { firstId, added, updated } = addRecipes(imported);
    loadRecipe(firstId);
    const skipped = imported.length - added - updated;
    const results = [];
    if (added) results.push(t('레시피 {count}개를 가져왔습니다.', { count: added }));
    if (updated) results.push(t('저장된 레시피 {count}개의 누락된 정보를 채웠습니다.', { count: updated }));
    if (results.length && skipped) results.push(t('중복 {count}개는 건너뛰었습니다.', { count: skipped }));
    brewer.update({ message: results.join(' ') || '모든 레시피가 이미 저장되어 있습니다.' });
  } catch (error) { brewer.update({ message: t('가져오기 실패. {message}', { message: t(error.message) }) }); }
});

function addPublicRecipe(recipe) {
  try {
    const { firstId, added } = addRecipes([validateRecipe(recipe)]);
    openSavedRecipe(firstId);
    brewer.update({ message: added ? '공개 레시피를 내 레시피에 추가했습니다.' : '이미 저장된 레시피를 열었습니다.' });
  } catch (error) {
    brewer.update({ message: error.message });
  }
}

function dragHandle() {
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.dataset.dragHandle = '';
  handle.setAttribute('aria-hidden', 'true');
  handle.title = t('끌어서 순서 바꾸기');
  handle.textContent = '⠿';
  return handle;
}

function recipeCard(recipe, photo, open) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  const picture = document.createElement('span');
  const name = document.createElement('strong');
  const info = document.createElement('small');
  const { volume } = summarize(recipe.steps);
  button.type = 'button';
  button.className = 'recipe-card';
  picture.className = 'card-picture';
  picture.setAttribute('aria-hidden', 'true');
  if (photo) {
    const image = new Image();
    image.alt = '';
    image.src = photo;
    picture.append(image);
  } else {
    picture.textContent = '▤';
  }
  name.textContent = recipe.name;
  info.textContent = recipe.grounds == null
    ? `${recipe.temperature} °C · ${volume} mL`
    : t('{temperature} °C · {volume} mL · 원두 {grounds} g', { temperature: recipe.temperature, volume, grounds: recipe.grounds });
  button.append(picture, name, info);
  button.addEventListener('click', open);
  item.append(button);
  return item;
}

function renderSavedCards() {
  $('saved-empty').hidden = recipes.length > 0;
  $('saved-cards').replaceChildren(...recipes.map(recipe => {
    const card = recipeCard(recipe, recipe.photo, () => openSavedRecipe(recipe.id));
    if (recipes.length > 1) card.append(dragHandle());
    return card;
  }));
}

function usePublicCover(image, credit, photo, fallback) {
  credit.hidden = !!photo;
  image.referrerPolicy = 'no-referrer';
  image.onerror = photo ? () => {
    image.onerror = null;
    image.src = fallback;
    credit.hidden = false;
  } : null;
  image.src = photo || fallback;
}

function libraryCard(issue) {
  const open = () => go('community/' + issue.number);
  const attachment = issueRecipe(issue);
  const name = issueTitle(issue, attachment, document.documentElement.lang) || issue.title;
  if (attachment) {
    const fallback = recipePhoto(attachment.archive?.photo).file;
    const item = recipeCard({ ...attachment.recipe, name }, fallback, open);
    const credit = document.createElement('small');
    credit.className = 'card-credit';
    credit.textContent = t('참고 사진');
    item.querySelector('.card-picture').append(credit);
    usePublicCover(item.querySelector('img'), credit, issueImage(issue), fallback);
    return item;
  }
  const item = document.createElement('li');
  const button = document.createElement('button');
  const title = document.createElement('strong');
  const meta = document.createElement('small');
  button.type = 'button';
  button.className = 'recipe-card discussion-card';
  title.textContent = name;
  meta.textContent = `@${issue.user?.login ?? 'ghost'} · ${t('댓글 {count}개', { count: issue.comments })}`;
  button.append(title, meta);
  button.addEventListener('click', open);
  item.append(button);
  return item;
}

function renderSharedDetail(recipe, archive, details, photo) {
  const { beans, grind, ice, grinder, description, guide } = archive ?? details ?? {};
  const { file, author, source, license, licenseUrl } = recipePhoto(archive?.photo);
  const { volume, seconds } = summarize(recipe.steps);
  const locale = document.documentElement.lang;
  const local = values => Array.isArray(values) ? values[locale === 'en' ? 1 : locale === 'ja' ? 2 : 0] : values;
  usePublicCover($('shared-photo'), $('shared-photo-caption'), photo, file);
  $('shared-photo-credit').href = source;
  $('shared-photo-credit').textContent = author;
  $('shared-photo-license').href = licenseUrl;
  $('shared-photo-license').textContent = license;
  $('shared-description').textContent = local(description) ?? '';
  $('shared-description').hidden = !$('shared-description').textContent;
  $('shared-grinder').textContent = typeof grinder === 'string' ? grinder : '';
  $('shared-grinder').hidden = !grinder;
  const values = [
    ['물 온도', `${recipe.temperature} °C`],
    ['총 물량', `${volume} mL`], ['예상 추출 시간', formatDuration(seconds)]
  ];
  if (recipe.grounds != null) values.unshift(['원두량 (g)', `${recipe.grounds} g`]);
  if (archive || beans || grind) values.unshift(['원두', local(beans) || t('원문에 미기재')], ['분쇄도', typeof grind === 'string' && grind ? t(grind) : t('원문에 미기재')]);
  if (Number.isFinite(ice) && ice > 0) values.push(['원문 얼음량', `${ice} g`]);
  $('shared-values').replaceChildren(...values.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = t(label);
    detail.textContent = value;
    return [term, detail];
  }));
  const originalSource = archive ? recipe.source.url : details?.source;
  $('shared-source').href = originalSource || '';
  $('shared-source').textContent = archive ? recipe.source.label : t('출처 URL');
  $('shared-sources').hidden = !originalSource;
  const hasGuide = typeof guide === 'string' && guide.startsWith('https://');
  $('shared-archive').hidden = !hasGuide;
  if (hasGuide) $('shared-archive').href = guide;
  $('shared-source-note').hidden = !archive || new URL(recipe.source.url).hostname === 'web.archive.org';
  $('shared-steps').replaceChildren(...recipe.steps.map(step => {
    const item = document.createElement('li');
    item.textContent = t('{volume} mL · {pour}초 붓기 · {wait}초 대기', step);
    return item;
  }));
}

async function loadCommunityBoard() {
  const refresh = $('refresh-community');
  if (refresh.disabled) return;
  const list = $('library-list');
  refresh.disabled = true;
  list.setAttribute('aria-busy', 'true');
  $('community-status').hidden = true;
  try {
    const issues = await listCommunityIssues();
    list.replaceChildren(...issues.map(libraryCard));
  } catch (error) {
    $('community-status').textContent = t(error.code === 'rate-limit'
      ? 'GitHub 조회 한도에 도달했습니다. 잠시 후 새로고침해 주세요.'
      : '공개 레시피를 불러오지 못했습니다.');
    $('community-status').hidden = false;
  } finally {
    list.setAttribute('aria-busy', 'false');
    refresh.disabled = false;
  }
}

async function loadCommunityTopic() {
  const topic = topicNumber;
  const request = ++topicRequest;
  const current = () => request === topicRequest && route === 'community-topic';
  $('topic-content').hidden = true;
  $('community-title').textContent = t('커뮤니티 게시글');
  $('topic-status').textContent = t('게시판을 불러오는 중…');
  $('topic-comments').replaceChildren();
  $('comment-status').textContent = '';
  topicRecipe = null;
  topicTranslation = null;
  try {
    const archiveId = topic.startsWith('archive-') ? Number(topic.slice(8)) : 0;
    const issue = archiveId
      ? (await listCommunityIssues()).find(item => issueRecipe(item)?.archive?.id === archiveId)
      : await getCommunityIssue(topic);
    if (!current()) return;
    if (!issue) {
      $('topic-status').textContent = t('글이 닫혔거나 삭제되었습니다.');
      return;
    }
    if (archiveId) {
      history.replaceState(history.state, '', '#community/' + issue.number);
      topicNumber = String(issue.number);
    }
    const attachment = issueRecipe(issue);
    topicRecipe = attachment?.recipe;
    const language = document.documentElement.lang;
    const supplied = attachment?.translations?.[language];
    const details = supplied ? { ...attachment?.details, ...supplied } : attachment?.details;
    $('community-title').textContent = issueTitle(issue, attachment, language) || issue.title;
    $('topic-byline').textContent = `#${issue.number} · @${issue.user?.login ?? 'ghost'}`;
    $('topic-body').textContent = attachment?.body ?? issue.body ?? '';
    $('topic-body').hidden = !!(attachment?.archive || details) || !$('topic-body').textContent;
    $('reply-on-github').href = issueUrl(issue.number);
    $('topic-recipe').hidden = !topicRecipe;
    const photo = issueImage(issue);
    if (topicRecipe) renderSharedDetail(topicRecipe, attachment.archive, details, photo);
    updateTopicTranslation(issue, attachment, details, supplied, photo);
    $('topic-status').textContent = '';
    $('topic-content').hidden = false;
    if (topicRecipe) requestAnimationFrame(() => {
      if (current() && topicRecipe) drawBrewGraph($('shared-graph'), topicRecipe.steps);
    });
    if (!issue.comments) {
      $('comment-status').textContent = t('아직 댓글이 없습니다.');
      return;
    }
    const comments = await listIssueComments(issue.number);
    if (!current()) return;
    $('topic-comments').replaceChildren(...(comments ?? []).map(comment => {
      const row = document.createElement('li');
      const author = document.createElement('strong');
      const body = document.createElement('p');
      author.textContent = '@' + (comment.user?.login ?? 'ghost');
      body.className = 'post-text';
      body.textContent = comment.body;
      row.append(author, body);
      return row;
    }));
  } catch (error) {
    if (!current()) return;
    const status = $('topic-content').hidden ? $('topic-status') : $('comment-status');
    status.textContent = t(error.code === 'rate-limit'
      ? 'GitHub 조회 한도에 도달했습니다. 잠시 후 새로고침해 주세요.'
      : '게시판을 불러오지 못했습니다. GitHub에서 볼 수 있습니다.');
  }
}

function updateTopicTranslation(issue, attachment, details, supplied, photo) {
  const target = document.documentElement.lang;
  const source = attachment?.language;
  const original = attachment?.details;
  const fields = {
    title: supplied?.title ? '' : issueTitle(issue),
    description: supplied?.description ? '' : original?.description || (!details ? $('topic-body').textContent : ''),
    beans: supplied?.beans ? '' : original?.beans,
    grind: supplied?.grind ? '' : original?.grind
  };
  const available = !attachment?.archive && source !== target && Object.values(fields).some(Boolean);
  $('topic-translation').hidden = !available;
  $('translation-status').textContent = '';
  if (!available) return;
  const native = canTranslateRecipe(source);
  $('translate-topic').hidden = !native;
  $('translate-topic').disabled = false;
  $('external-topic-translation').hidden = native;
  $('external-topic-translation').href = translationLink(fields, target, source);
  topicTranslation = { fields, source, target, attachment, details, photo };
}

$('translate-topic').addEventListener('click', async () => {
  const request = topicTranslation;
  if (!request) return;
  const { fields, target, source, attachment, details, photo } = request;
  const button = $('translate-topic');
  button.disabled = true;
  $('translation-status').textContent = t('번역 중…');
  const current = () => topicTranslation === request && route === 'community-topic';
  try {
    const translated = await translateRecipe(fields, target, source);
    if (!current()) return;
    if (translated.title) $('community-title').textContent = translated.title;
    if (attachment?.recipe) renderSharedDetail(attachment.recipe, undefined, { ...details, ...translated }, photo);
    else if (translated.description) $('topic-body').textContent = translated.description;
    $('topic-translation').hidden = true;
  } catch {
    if (!current()) return;
    $('translation-status').textContent = t('브라우저 번역을 사용할 수 없습니다.');
    $('external-topic-translation').hidden = false;
  } finally {
    if (current()) {
      button.disabled = false;
      if ($('topic-translation').hidden) $('translation-status').textContent = '';
    }
  }
});

function selectedPostRecipe() {
  const value = postForm.elements.namedItem('recipe').value;
  return value === 'draft' ? postDraft : recipes.find(recipe => recipe.id === value);
}

function updatePostRecipe() {
  const selectedRecipe = selectedPostRecipe();
  postForm.elements.namedItem('title').value = selectedRecipe?.name ?? '';
  postForm.elements.namedItem('beans').value = selectedRecipe?.beans ?? '';
  postForm.elements.namedItem('grind').value = selectedRecipe?.grind ?? '';
  const photo = selectedRecipe?.photo;
  const hasPhoto = typeof photo === 'string' && photo.startsWith('data:image/jpeg;base64,');
  $('post-photo-tools').hidden = !hasPhoto;
  showPhoto($('post-photo'), hasPhoto ? photo : undefined);
  if (hasPhoto) $('post-photo-download').href = photo;
  else $('post-photo-download').removeAttribute('href');
  $('publish-post').disabled = !selectedRecipe;
  $('post-attachment').hidden = !selectedRecipe;
  if (selectedRecipe) {
    const { volume } = summarize(selectedRecipe.steps);
    $('post-attachment').textContent = t('{temperature} °C · {volume} mL · 추출 {count}단계', {
      temperature: selectedRecipe.temperature, volume, count: selectedRecipe.steps.length
    });
  }
}

function openPost(draft) {
  postForm.reset();
  postForm.elements.namedItem('language').value = document.documentElement.lang;
  $('post-translations').open = false;
  showPostTranslationFields();
  postDraft = draft;
  const picker = postForm.elements.namedItem('recipe');
  const options = recipes.map(recipe => new Option(recipe.name, recipe.id));
  if (draft) options.unshift(new Option(t('편집 중인 레시피'), 'draft'));
  picker.replaceChildren(new Option(t('레시피 선택'), ''), ...options);
  picker.value = draft ? 'draft' : '';
  $('post-error').hidden = true;
  updatePostRecipe();
  postDialog.showModal();
}

function showPostTranslationFields() {
  const source = postForm.elements.namedItem('language').value;
  for (const fields of postForm.querySelectorAll('[data-translation]')) fields.hidden = fields.dataset.translation === source;
}

$('new-community-post').addEventListener('click', () => openPost());
$('propose-recipe').addEventListener('click', () => {
  try { openPost(validateRecipe(formRecipe())); }
  catch (error) { brewer.update({ message: error.message }); }
});
$('new-post-recipe').addEventListener('click', () => { postDialog.close(); openSavedRecipe(''); });
postForm.elements.namedItem('recipe').addEventListener('change', updatePostRecipe);
postForm.elements.namedItem('language').addEventListener('change', showPostTranslationFields);
postForm.addEventListener('submit', event => {
  event.preventDefault();
  const selectedRecipe = selectedPostRecipe();
  if (!selectedRecipe) return;
  const { title, message, beans, grind, source, language } = postForm.elements;
  const translations = Object.fromEntries(['ko', 'en', 'ja'].filter(code => code !== language.value).map(code => [code, {
    title: postForm.elements.namedItem(code + '-title').value,
    description: postForm.elements.namedItem(code + '-notes').value
  }]));
  try {
    const url = recipeProposalUrl({ ...selectedRecipe, name: title.value }, {
      beans: beans.value, grind: grind.value, description: message.value, source: source.value, language: language.value, translations
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    postDialog.close();
  } catch (error) {
    $('post-error').textContent = t(error.message);
    $('post-error').hidden = false;
  }
});
$('cancel-post').addEventListener('click', () => postDialog.close());
$('refresh-community').addEventListener('click', loadCommunityBoard);
$('save-topic-recipe').addEventListener('click', () => addPublicRecipe(topicRecipe));
window.addEventListener('focus', () => {
  if (route === 'library') void loadCommunityBoard();
  if (route === 'community-topic') void loadCommunityTopic();
});
new ResizeObserver(() => {
  if (topicRecipe && route === 'community-topic') drawBrewGraph($('shared-graph'), topicRecipe.steps);
}).observe($('shared-graph'));
bindReorder($('saved-cards'), reorderRecipe);
bindReorder($('steps'), (from, to) => {
  const rows = $('steps').children;
  const row = rows[from];
  rows[to][from < to ? 'after' : 'before'](row);
  renumber();
  settingsChanged();
}, 1);

$('connect').addEventListener('click', () => brewer.connect());
$('reconnect').addEventListener('click', () => brewer.connect(true));
$('disconnect').addEventListener('click', () => brewer.disconnect());
$('device-tools').addEventListener('toggle', () => { if ($('device-tools').open) void refreshKnownDevices(); });
$('known-devices').addEventListener('change', event => {
  $('device-alias').value = deviceAliases.get(event.target.value) || '';
  render(brewer.state);
});
$('alias-form').addEventListener('submit', event => {
  event.preventDefault();
  const id = $('known-devices').value;
  if (!id) return;
  const alias = $('device-alias').value.trim();
  const next = new Map(deviceAliases);
  if (alias) next.set(id, alias);
  else next.delete(id);
  try {
    localStorage.setItem('smart7-aliases', JSON.stringify(Object.fromEntries(next)));
    deviceAliases = next;
    renderKnownDevices();
  } catch (error) { brewer.update({ message: error.message }); }
});
$('use-device').addEventListener('click', () => {
  const id = $('known-devices').value;
  const connect = () => { if (brewer.device) brewer.disconnect(); return brewer.connect(true, id); };
  if (brewer.state.connection === 'ready') confirmAction('다른 기기로 전환할까요?', '지금 연결을 해제하고 선택한 Smart7에 연결합니다.', connect);
  else void run(connect);
});
$('pick-device').addEventListener('click', () => {
  if (brewer.state.connection === 'ready') switchDialog.showModal();
  else void brewer.connect();
});
$('confirm-switch').addEventListener('click', () => {
  switchDialog.close();
  brewer.disconnect();
  void brewer.connect();
});
pinForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = pinForm.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    await brewer.acceptPin(pinForm.elements.namedItem('pin').value, pinForm.elements.namedItem('remember').checked);
    pinForm.reset();
  } catch (error) {
    $('pin-error').textContent = t(error.message);
    $('pin-error').hidden = false;
  } finally { submit.disabled = false; }
});
$('cancel-pin').addEventListener('click', () => run(() => brewer.cancelPin()));
pinDialog.addEventListener('cancel', event => { event.preventDefault(); void run(() => brewer.cancelPin()); });
deviceDialog.addEventListener('cancel', event => event.preventDefault());
$('dismiss-device-alert').addEventListener('click', () => run(async () => {
  if (brewer.state.alert === 'busy' && brewer.alertPhase === 'calibration') $('flow-tools').open = false;
  await brewer.acknowledgeAlert();
}));
$('finish-operation').addEventListener('click', () => run(() => brewer.acknowledgeAlert()));
$('overheat-drain').addEventListener('click', async () => {
  let showDrain = false;
  await run(async () => { showDrain = await brewer.acknowledgeAlert(true); });
  if (showDrain) showDrainPreparation();
});

$('start').addEventListener('click', async () => {
  try {
    const draft = formRecipe();
    const recipe = validateRecipe(draft);
    if (!requestOperationConnection()) return;
    if (!await checkTank()) return;
    const { volume } = summarize(recipe.steps);
    const preparation = t('탱크에 신선한 물을 {volume}mL 이상 넣고, 드리퍼와 서버를 준비했는지 확인하세요.', { volume });
    confirmAction('추출을 시작할까요?', preparation, async () => {
      waterConfirmed = false;
      activeRecipe = { ...recipe, speed: draft.speed };
      await brewer.brew(recipe);
    });
  } catch (error) { brewer.update({ message: error.message }); }
});
$('pause').addEventListener('click', () => run(() => brewer.pauseOrResume()));
$('stop').addEventListener('click', async () => {
  const button = $('stop');
  if (button.dataset.stopping) return;
  button.dataset.stopping = 'true';
  try { await brewer.stop(); }
  catch (error) { brewer.update({ message: error.message }); }
  finally { delete button.dataset.stopping; }
});
$('drain').addEventListener('click', () => {
  if (!requestOperationConnection()) return;
  confirmAction('배수를 시작할까요?', '배출구 아래 내열 용기를 놓고 본체 가까이에 있어 주세요.', () => {
    waterConfirmed = false;
    return brewer.drain();
  });
});
$('clean').addEventListener('click', () => {
  showCleanStep(1);
  cleanGuide.returnValue = '';
  cleanGuide.showModal();
});
$('clean-guide-back').addEventListener('click', () => showCleanStep(cleanStep - 1));
$('clean-guide-next').addEventListener('click', () => showCleanStep(cleanStep + 1));
$('clean-guide-start').addEventListener('click', event => {
  event.preventDefault();
  if (!requestOperationConnection()) return;
  cleanGuide.close('start');
  waterConfirmed = false;
  void run(() => brewer.clean());
});
$('rinse').addEventListener('click', () => confirmAction('헹굼을 시작할까요?', '탱크에 깨끗한 물을 넣고 배출구 아래 내열 용기를 놓으세요.', () => brewer.rinse()));
$('flow-tools').addEventListener('toggle', () => {
  const open = $('flow-tools').open;
  brewer.showCalibration(open);
  if (open && brewer.state.connection === 'ready' && !brewer.state.alert && !workingPhases.includes(brewer.state.phase)) {
    void run(() => brewer.readFlow());
  }
});
$('read-flow').addEventListener('click', () => {
  if (requestOperationConnection()) void run(() => brewer.readFlow());
});
for (let level = 1; level <= 9; level++) {
  const button = document.createElement('button');
  Object.assign(button, { type: 'button', value: String(level), className: 'quiet', textContent: level });
  button.addEventListener('click', () => { if (requestOperationConnection()) void run(() => brewer.setFlow(level)); });
  $('flow-levels').append(button);
}
document.addEventListener('visibilitychange', () => void holdScreen(workingPhases.includes(brewer.state.phase)));

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $('install').hidden = true;
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn(error));
}

function applyLanguage(value) {
  const language = setLanguage(value);
  document.documentElement.lang = language;
  $('language').value = language;
  translatePage();
  renderCompatibility();
  refreshOptions();
  for (const label of $('steps').querySelectorAll('[data-step-label]')) {
    label.firstChild.nodeValue = t(label.dataset.stepLabel);
  }
  renumber();
  lastPreview = '';
  renderKnownDevices();
}
$('language').addEventListener('change', event => {
  localStorage.setItem('smart7-language', event.target.value);
  applyLanguage(event.target.value);
});

loadRecipe('');
applyLanguage(localStorage.getItem('smart7-language'));
applyRoute();

function reconnectSaved() {
  if (supported && navigator.bluetooth.getDevices && localStorage.getItem('smart7-device')) void brewer.connect(true);
}

if (appleMobile || !chrome || android) {
  const dialog = $('platform-dialog');
  const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
  const locale = preferences.map(tag => tag?.toLowerCase().split('-')[0])
    .find(code => ['ko', 'en', 'ja'].includes(code)) ?? 'en';
  const notice = key => t(key, undefined, locale);
  dialog.lang = locale;
  $('platform-title').textContent = notice(appleMobile ? 'iPhone·iPad 연결 미지원' : chrome ? '블루투스 권한을 허용해 주세요' : 'Chrome에서 열어 주세요');
  $('platform-message').textContent = notice(appleMobile
    ? 'iPhone과 iPad에서는 Smart7 본체에 연결할 수 없습니다. Android 기기의 Chrome에서 이 주소를 다시 열어 주세요.'
    : chrome
      ? 'BT 연결을 누르고 Chrome에서 주변 기기 권한을 허용하세요. EVS-70을 고른 뒤 선택창의 페어링 또는 연결 버튼을 누르세요.'
      : 'Smart7을 연결하려면 Google Chrome에서 이 주소를 다시 열어 주세요.');
  dialog.querySelector('button').textContent = notice('확인');
  if (chrome) dialog.addEventListener('close', reconnectSaved, { once: true });
  dialog.showModal();
} else reconnectSaved();
