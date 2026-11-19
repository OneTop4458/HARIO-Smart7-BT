import { automaticRecipe, parseRecipeFile, summarize, validateRecipe } from './recipes.js';
import { publicRecipes } from './recipe-library.js';
import { Smart7, workingPhases } from './protocol.js';
import { drawBrewGraph } from './brew-graph.js';
import { localizeStatic, setLanguage, t } from './i18n.js';

const $ = id => document.getElementById(id);
const auto = $('auto-settings');
const custom = $('custom-settings');
const pinDialog = $('pin-dialog');
const pinForm = $('pin-form');
const confirmDialog = $('confirm-dialog');
const libraryDialog = $('recipe-library');
const deviceDialog = $('device-dialog');
const translatePage = localizeStatic(document.body);
const storageKey = 'smart7-recipes';
let mode = 'auto';
let selected = '';
let lastPreview = '';
let displayedLevel = null;
let activeRecipe;
let draftPhoto;
let photoRead = 0;
let graphSteps = [];
let graphElapsed;
let offlineMessage = '';
let recipes = [];
let actionInProgress = false;
let wakeLock;
let requestingWakeLock = false;
let installPrompt;

try { recipes = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { recipes = []; }
if (!Array.isArray(recipes)) recipes = [];

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
  'rinse-complete': ['헹굼 완료', '헹굼이 완료됐습니다.']
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
    return { ...automaticRecipe(cups, fields.get('speed'), Number(fields.get('temperature'))), name: t('자동 추출 {cups}잔', { cups }) };
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

function renderSummary(state) {
  const recipe = activeRecipe || formRecipe();
  const steps = recipe.steps.filter(step => [step.volume, step.pour, step.wait].every(Number.isFinite)
    && step.volume > 0 && step.pour > 0 && step.wait >= 0);
  const totals = summarize(steps);
  const volumeUnit = document.createElement('small');
  volumeUnit.textContent = ' mL';
  $('volume').replaceChildren(totals.volume ? `${totals.volume}` : '—', volumeUnit);
  const seconds = state.seconds ?? totals.seconds;
  $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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

function render(state) {
  const busy = workingPhases.includes(state.phase);
  const ready = state.connection === 'ready';
  const disconnected = state.connection === 'disconnected';
  const locked = actionInProgress || busy || !!state.alert;
  if (!['starting', 'heating', 'brewing', 'paused', 'complete'].includes(state.phase)) activeRecipe = null;
  $('connection').textContent = t(connectionLabels[state.connection]);
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
  for (const id of ['drain', 'clean', 'read-flow', 'save-flow']) $(id).disabled = !ready || locked;
  $('rinse').hidden = state.phase !== 'awaiting-rinse';
  $('rinse').disabled = actionInProgress;
  if (state.level !== displayedLevel) {
    displayedLevel = state.level;
    if (state.level !== null) $('level').value = state.level;
  }
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
    if (!deviceDialog.open) deviceDialog.showModal();
  } else if (deviceDialog.open) deviceDialog.close();
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
  $('export-recipes').disabled = !recipes.length;
}

function renumber() {
  const rows = [...$('steps').children];
  rows.forEach((row, index) => {
    row.querySelector('.number').textContent = String(index + 1).padStart(2, '0');
    const remove = row.querySelector('button');
    remove.disabled = rows.length === 1;
    remove.setAttribute('aria-label', t('{index}단계 삭제', { index: index + 1 }));
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
  const remove = document.createElement('button');
  Object.assign(remove, { type: 'button', className: 'quiet', textContent: '×' });
  remove.addEventListener('click', () => { row.remove(); renumber(); settingsChanged(); });
  row.append(remove);
  $('steps').append(row);
  renumber();
}

function loadRecipe(id) {
  selected = id;
  const recipe = recipes.find(item => item.id === id) || automaticRecipe(2, 'normal', 93);
  photoRead++;
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
    let photo;
    try {
      const size = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
      photo = canvas.toDataURL('image/jpeg', 0.84);
    } finally { bitmap.close(); }
    if (reading !== photoRead) return;
    setDraftPhoto(photo);
    settingsChanged();
  } catch (error) {
    if (reading === photoRead) brewer.update({ message: error.name === 'InvalidStateError' ? '이미지를 열 수 없습니다.' : error.message });
  }
}

document.querySelector('.mode').addEventListener('change', event => {
  mode = event.target.value;
  auto.hidden = mode !== 'auto';
  custom.hidden = mode !== 'custom';
  settingsChanged();
});
auto.addEventListener('change', settingsChanged);
custom.addEventListener('input', settingsChanged);
$('saved-recipes').addEventListener('change', event => loadRecipe(event.target.value));
$('new-recipe').addEventListener('click', () => loadRecipe(''));
$('add-step').addEventListener('click', () => { appendStep(); settingsChanged(); });
$('brew-details').addEventListener('toggle', repaintGraph);
new ResizeObserver(repaintGraph).observe($('brew-graph'));
$('recipe-photo').addEventListener('change', pickPhoto);
$('take-photo').addEventListener('change', pickPhoto);
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
$('dismiss-device-alert').addEventListener('click', () => run(() => brewer.acknowledgeAlert()));
$('overheat-drain').addEventListener('click', () => run(() => brewer.acknowledgeAlert(true)));

$('start').addEventListener('click', () => {
  try {
    const recipe = validateRecipe(formRecipe());
    const { volume } = summarize(recipe.steps);
    const preparation = t('탱크에 신선한 물을 {volume}mL 이상 넣고, 드리퍼와 서버를 준비했는지 확인하세요.', { volume });
    confirmAction('추출을 시작할까요?', preparation, async () => {
      activeRecipe = recipe;
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
$('drain').addEventListener('click', () => confirmAction('배수를 시작할까요?', '배출구 아래 내열 용기를 놓고 본체 가까이에 있어 주세요.', () => brewer.drain()));
$('clean').addEventListener('click', () => confirmAction('세척을 시작할까요?', '본체 설명서의 세척 준비를 마쳤는지 확인하세요.', () => brewer.clean()));
$('rinse').addEventListener('click', () => confirmAction('헹굼을 시작할까요?', '탱크에 깨끗한 물을 넣고 배출구 아래 내열 용기를 놓으세요.', () => brewer.rinse()));
$('read-flow').addEventListener('click', () => run(() => brewer.readFlow()));
$('save-flow').addEventListener('click', () => {
  const level = $('level').valueAsNumber;
  return run(() => brewer.setFlow(level));
});
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
  render(brewer.state);
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
