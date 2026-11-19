import { automaticRecipe, parseRecipeFile, summarize, validateRecipe } from './recipes.js';
import { publicRecipes } from './recipe-library.js';
import { Smart7, workingPhases } from './protocol.js';
import { drawBrewGraph } from './brew-graph.js';
import { localizeStatic, setLanguage, t } from './i18n.js';
import { drawRecipeCrop } from './recipe-photo.js';

const $ = id => document.getElementById(id);
const auto = $('auto-settings');
const custom = $('custom-settings');
const pinDialog = $('pin-dialog');
const pinForm = $('pin-form');
const confirmDialog = $('confirm-dialog');
const libraryDialog = $('recipe-library');
const deviceDialog = $('device-dialog');
const cropDialog = $('crop-dialog');
const waterDialog = $('water-dialog');
const cleanGuide = $('clean-guide');
const switchDialog = $('switch-dialog');
const overwriteDialog = $('overwrite-dialog');
const translatePage = localizeStatic(document.body);
const storageKey = 'smart7-recipes';
let mode = 'auto';
let selected = '';
let lastPreview = '';
let activeRecipe;
let draftPhoto;
let photoRead = 0;
let cropBitmap;
let graphSteps = [];
let graphElapsed;
let offlineMessage = '';
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
  disconnected: '연결 안 됨', connecting: '연결 중', pin: 'PIN 확인', ready: 'Smart7 연결됨'
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
const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(navigator.userAgent);
const supported = !appleMobile && window.isSecureContext && !!navigator.bluetooth;

function renderCompatibility() {
  let message = '기기 선택 창에서 EVS-70을 선택하세요.';
  if (appleMobile) message = 'Smart7 본체를 연결하려면 Android Chrome으로 접속해 주세요.';
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
  $('timer').textContent = formatDuration(seconds);
  $('timer-label').textContent = t(state.seconds == null ? '예상 추출 시간' : '남은 시간');
  $('recipe-title').textContent = recipe.name || t('새 레시피');
  showPhoto($('summary-photo'), recipe.photo);
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
  $('connection').textContent = alias ? `${t(connectionLabels[state.connection])} · ${alias}` : t(connectionLabels[state.connection]);
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
  $('notice').hidden = !state.message;
  $('notice').textContent = t(state.message);
  $('start').disabled = !ready || locked;
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
  document.querySelector('.mode').inert = locked;
  $('open-library').disabled = locked;
  if (state.connection === 'pin' && !pinDialog.open) {
    pinForm.reset();
    $('pin-error').hidden = true;
    pinDialog.showModal();
    pinForm.elements.namedItem('pin').focus();
  } else if (state.connection !== 'pin' && pinDialog.open) pinDialog.close();
  if (state.alert) {
    const hot = state.alert === 'overheat';
    const [title, message] = deviceAlerts[state.alert];
    $('device-alert-title').textContent = t(title);
    $('device-alert-text').textContent = t(message);
    $('dismiss-device-alert').textContent = t(hot ? '돌아가기' : '확인');
    $('overheat-drain').hidden = !hot;
    $('overheat-drain').disabled = actionInProgress;
    $('dismiss-device-alert').disabled = actionInProgress;
    renderBrewResult(state.alert === 'brew-complete' ? activeRecipe : null);
    if (!deviceDialog.open) deviceDialog.showModal();
  } else if (deviceDialog.open) {
    renderBrewResult(null);
    deviceDialog.close();
  }
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
}

function moveRecipe(offset) {
  const index = recipes.findIndex(item => item.id === selected);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= recipes.length) return;
  const next = [...recipes];
  [next[index], next[target]] = [next[target], next[index]];
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
  const connecting = state === 'connecting' || state === 'pin';
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
  knownDevices = granted.filter(device => device.name?.includes('EVS-70'));
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
    } else if (recipe.photo && !next[index].photo) {
      next[index] = { ...next[index], photo: recipe.photo };
      updated++;
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

document.querySelector('.mode').addEventListener('change', event => {
  const changed = mode !== event.target.value;
  mode = event.target.value;
  auto.hidden = mode !== 'auto';
  custom.hidden = mode !== 'custom';
  settingsChanged();
  if (changed) waterConfirmed = false;
  if (changed && event.isTrusted && brewer.state.connection === 'ready') void checkTank();
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
    saveRecipes([...recipes.filter(item => item.id !== id), { id, ...recipe }]);
    selected = id;
    refreshOptions();
    brewer.update({ message: '레시피를 이 브라우저에 저장했습니다.' });
  } catch (error) { brewer.update({ message: error.message }); }
});

function openSavedRecipe(id) {
  const option = document.querySelector('.mode [value="custom"]');
  option.checked = true;
  option.dispatchEvent(new Event('change', { bubbles: true }));
  loadRecipe(id);
  $('saved-recipes').focus();
}

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
    if (updated) results.push(t('저장된 레시피 {count}개의 사진을 가져왔습니다.', { count: updated }));
    if (results.length && skipped) results.push(t('중복 {count}개는 건너뛰었습니다.', { count: skipped }));
    brewer.update({ message: results.join(' ') || '모든 레시피가 이미 저장되어 있습니다.' });
  } catch (error) { brewer.update({ message: t('가져오기 실패. {message}', { message: t(error.message) }) }); }
});

async function importLegacy(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length || $('legacy-backup').disabled) return;
  const result = $('legacy-result');
  const skips = $('legacy-skips');
  $('legacy-backup').disabled = $('legacy-folder').disabled = true;
  result.hidden = false;
  skips.hidden = true;
  skips.replaceChildren();
  result.textContent = t('구형 앱 백업을 읽고 있습니다.');
  try {
    const { readLegacyBackup } = await import('./legacy-backup.js');
    const { recipes: imported, missingPhotos, skipped } = await readLegacyBackup(files);
    const { firstId, added, updated } = addRecipes(imported);
    if (firstId && mode === 'custom' && !workingPhases.includes(brewer.state.phase)) loadRecipe(firstId);
    const messages = [t('레시피 {count}개를 가져왔습니다.', { count: added })];
    if (updated) messages.push(t('저장된 레시피 {count}개의 사진을 가져왔습니다.', { count: updated }));
    const duplicates = imported.length - added - updated;
    if (duplicates) messages.push(t('중복 {count}개는 건너뛰었습니다.', { count: duplicates }));
    if (missingPhotos) messages.push(t('사진을 찾지 못한 레시피 {count}개는 설정만 가져왔습니다.', { count: missingPhotos }));
    if (skipped.length) {
      messages.push(t('값을 읽을 수 없는 레시피 {count}개는 건너뛰었습니다.', { count: skipped.length }));
      for (const item of skipped) {
        const li = document.createElement('li');
        li.textContent = `${item.name || t('레시피 이름')} · ${t(item.message)}`;
        skips.append(li);
      }
      skips.hidden = false;
    }
    result.textContent = messages.join(' ');
  } catch (error) {
    result.textContent = t('가져오기 실패. {message}', { message: t(error.message) });
  } finally { $('legacy-backup').disabled = $('legacy-folder').disabled = false; }
}
$('legacy-backup').addEventListener('change', importLegacy);
$('legacy-folder').addEventListener('change', importLegacy);

function addPublicRecipe(recipe) {
  try {
    const { firstId, added } = addRecipes([validateRecipe(recipe)]);
    libraryDialog.close();
    openSavedRecipe(firstId);
    brewer.update({ message: added ? '공개 레시피를 내 레시피에 추가했습니다.' : '이미 저장된 레시피를 열었습니다.' });
  } catch (error) {
    libraryDialog.close();
    brewer.update({ message: error.message });
  }
}
function renderLibrary() {
  $('library-list').replaceChildren();
  for (const recipe of publicRecipes) {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const name = document.createElement('strong');
    const metrics = document.createElement('small');
    const source = document.createElement('a');
    const add = document.createElement('button');
    const { volume } = summarize(recipe.steps);
    name.textContent = recipe.name;
    metrics.textContent = t('{temperature} °C · {volume} mL · 원두 {grounds} g', { temperature: recipe.temperature, volume, grounds: recipe.grounds });
    Object.assign(source, { href: recipe.source.url, target: '_blank', rel: 'noopener noreferrer', className: 'micro source-link', textContent: recipe.source.label });
    Object.assign(add, { type: 'button', className: 'secondary', textContent: t('추가') });
    add.setAttribute('aria-label', t('{name} 추가', { name: recipe.name }));
    add.addEventListener('click', () => addPublicRecipe(recipe));
    details.append(name, metrics, source);
    item.append(details, add);
    $('library-list').append(item);
  }
}
$('open-library').addEventListener('click', () => libraryDialog.showModal());

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
$('overheat-drain').addEventListener('click', async () => {
  let showDrain = false;
  await run(async () => { showDrain = await brewer.acknowledgeAlert(true); });
  if (showDrain) showDrainPreparation();
});

$('start').addEventListener('click', async () => {
  try {
    const draft = formRecipe();
    const recipe = validateRecipe(draft);
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
  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { offlineMessage = '오프라인 사용 가능'; $('offline-status').textContent = t(offlineMessage); })
    .catch(() => { offlineMessage = '오프라인 저장을 완료하지 못했습니다.'; $('offline-status').textContent = t(offlineMessage); });
}

function applyLanguage(value) {
  const language = setLanguage(value);
  document.documentElement.lang = language;
  $('language').value = language;
  translatePage();
  renderCompatibility();
  renderLibrary();
  refreshOptions();
  for (const label of $('steps').querySelectorAll('[data-step-label]')) {
    label.firstChild.nodeValue = t(label.dataset.stepLabel);
  }
  renumber();
  lastPreview = '';
  $('offline-status').textContent = t(offlineMessage);
  renderKnownDevices();
}
$('language').addEventListener('change', event => {
  localStorage.setItem('smart7-language', event.target.value);
  applyLanguage(event.target.value);
});

loadRecipe('');
applyLanguage(localStorage.getItem('smart7-language'));

function reconnectSaved() {
  if (supported && navigator.bluetooth.getDevices && localStorage.getItem('smart7-device')) void brewer.connect(true);
}

if (appleMobile || android) {
  $('platform-title').textContent = t(appleMobile ? 'iPhone·iPad 연결 미지원' : '블루투스 권한을 허용해 주세요');
  $('platform-message').textContent = t(appleMobile
    ? 'iPhone과 iPad에서는 Smart7 본체에 연결할 수 없습니다. Android 기기의 Chrome에서 이 주소를 다시 열어 주세요.'
    : 'Android Chrome에서 블루투스를 켠 뒤 BT 연결을 눌러 주세요. 블루투스 또는 주변 기기 권한을 묻는 창이 나오면 허용해 주세요.');
  $('platform-dialog').addEventListener('close', reconnectSaved, { once: true });
  $('platform-dialog').showModal();
} else reconnectSaved();
