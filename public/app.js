import { automaticRecipe, summarize, validateRecipe } from './recipes.js';
import { Smart7, workingPhases } from './protocol.js';

const $ = id => document.getElementById(id);
const auto = $('auto-settings');
const custom = $('custom-settings');
const pinDialog = $('pin-dialog');
const pinForm = $('pin-form');
const confirmDialog = $('confirm-dialog');
const storageKey = 'smart7-recipes';
let mode = 'auto';
let selected = '';
let lastPreview = '';
let displayedLevel = null;
let activeRecipe;
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
const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(navigator.userAgent);
const supported = !appleMobile && window.isSecureContext && !!navigator.bluetooth;
if (appleMobile) $('compatibility').textContent = 'Smart7 본체를 연결하려면 Android Chrome으로 접속해 주세요.';
else if (!supported) $('compatibility').textContent = '블루투스 연결은 HTTPS에서 Android 또는 데스크톱 Chrome을 사용하세요.';
else if (android) $('compatibility').textContent = '권한 요청이 나오면 허용하고 기기 선택 창에서 EVS-70을 선택하세요.';

function formRecipe() {
  if (mode === 'auto') {
    const fields = new FormData(auto);
    return automaticRecipe(Number(fields.get('cups')), fields.get('speed'), Number(fields.get('temperature')));
  }
  return {
    name: custom.elements.namedItem('name').value,
    temperature: custom.elements.namedItem('temperature').valueAsNumber,
    steps: [...$('steps').children].map(row => {
      const [volume, pour, wait] = [...row.querySelectorAll('input')].map(input => input.valueAsNumber);
      return { volume, pour, wait };
    })
  };
}

function renderSummary(state) {
  const recipe = activeRecipe || formRecipe();
  const steps = recipe.steps.filter(step => [step.volume, step.pour, step.wait].every(Number.isFinite));
  const totals = summarize(steps);
  const volumeUnit = document.createElement('small');
  volumeUnit.textContent = ' mL';
  $('volume').replaceChildren(totals.volume ? `${totals.volume}` : '—', volumeUnit);
  const seconds = state.seconds ?? totals.seconds;
  $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('timer-label').textContent = state.seconds == null ? '예상 추출 시간' : '남은 시간';
  $('recipe-title').textContent = recipe.name || '새 레시피';
  const preview = JSON.stringify(steps);
  if (preview !== lastPreview) {
    lastPreview = preview;
    $('preview-steps').replaceChildren(...steps.map(step => {
      const item = document.createElement('li');
      item.textContent = `${step.volume} mL · ${step.pour}초 붓기 · ${step.wait}초 대기`;
      return item;
    }));
  }
}

function render(state) {
  const busy = workingPhases.includes(state.phase);
  const ready = state.connection === 'ready';
  const disconnected = state.connection === 'disconnected';
  const locked = actionInProgress || busy;
  if (state.phase === 'idle') activeRecipe = null;
  $('connection').textContent = connectionLabels[state.connection];
  $('connection-dot').className = ready ? 'ready' : disconnected ? '' : 'pending';
  $('connect').disabled = !supported || !disconnected;
  $('connect').hidden = ready;
  $('reconnect').hidden = !disconnected || !supported || !navigator.bluetooth?.getDevices || !localStorage.getItem('smart7-device');
  $('reconnect').disabled = actionInProgress;
  $('disconnect').hidden = !ready || busy;
  $('phase').textContent = phaseLabels[state.phase];
  $('live-temperature').hidden = state.temperature == null;
  $('temperature-reading').textContent = state.temperature == null ? '' : `${state.temperature} °C`;
  $('notice').hidden = !state.message;
  $('notice').textContent = state.message;
  $('start').disabled = !ready || locked;
  $('start').hidden = busy;
  $('pause').hidden = !['heating', 'brewing', 'paused'].includes(state.phase);
  $('pause').textContent = state.phase === 'paused' ? '계속 추출' : '일시 정지';
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
  if (state.connection === 'pin' && !pinDialog.open) {
    pinForm.reset();
    $('pin-error').hidden = true;
    pinDialog.showModal();
    pinForm.elements.namedItem('pin').focus();
  } else if (state.connection !== 'pin' && pinDialog.open) pinDialog.close();
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
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  confirmDialog.returnValue = '';
  confirmDialog.addEventListener('close', () => {
    if (confirmDialog.returnValue === 'confirm') void run(action);
  }, { once: true });
  confirmDialog.showModal();
}

function refreshOptions() {
  const first = new Option('새 레시피', '');
  $('saved-recipes').replaceChildren(first, ...recipes.map(recipe => new Option(recipe.name, recipe.id)));
  $('saved-recipes').value = selected;
  $('delete-recipe').hidden = selected === '';
  $('export-recipes').disabled = !recipes.length;
}

function renumber() {
  const rows = [...$('steps').children];
  rows.forEach((row, index) => {
    row.querySelector('.number').textContent = String(index + 1).padStart(2, '0');
    const remove = row.querySelector('button');
    remove.disabled = rows.length === 1;
    remove.setAttribute('aria-label', `${index + 1}단계 삭제`);
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
    label.textContent = title;
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
  custom.elements.namedItem('name').value = id ? recipe.name : '';
  custom.elements.namedItem('temperature').value = recipe.temperature;
  $('steps').replaceChildren();
  for (const step of recipe.steps) appendStep(step);
  refreshOptions();
  settingsChanged();
}

function saveRecipes(items) {
  localStorage.setItem(storageKey, JSON.stringify(items));
  recipes = items;
}

function settingsChanged() {
  if (!workingPhases.includes(brewer.state.phase)) {
    activeRecipe = null;
    if (brewer.state.phase === 'complete') brewer.update({ phase: 'idle', seconds: null, temperature: null, message: '' });
  }
  renderSummary(brewer.state);
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
$('delete-recipe').addEventListener('click', () => confirmAction('저장한 레시피 삭제', '이 브라우저에서 선택한 레시피를 삭제합니다.', () => {
  saveRecipes(recipes.filter(item => item.id !== selected));
  loadRecipe('');
  brewer.update({ message: '레시피를 삭제했습니다.' });
}));
$('export-recipes').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, recipes }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'smart7-recipes.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import-recipes').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 1000000) throw new Error('1MB 이하 레시피 파일을 선택하세요.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.recipes) || data.recipes.length === 0) throw new Error('Smart7 Offline 레시피 파일을 선택하세요.');
    const imported = data.recipes.map(recipe => ({ id: crypto.randomUUID(), ...validateRecipe(recipe) }));
    saveRecipes([...recipes, ...imported]);
    loadRecipe(imported[0].id);
    brewer.update({ message: `레시피 ${imported.length}개를 가져왔습니다.` });
  } catch (error) { brewer.update({ message: `가져오기 실패. ${error.message}` }); }
});

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
    $('pin-error').textContent = error.message;
    $('pin-error').hidden = false;
  } finally { submit.disabled = false; }
});
$('cancel-pin').addEventListener('click', () => run(() => brewer.cancelPin()));
pinDialog.addEventListener('cancel', event => { event.preventDefault(); void run(() => brewer.cancelPin()); });

$('start').addEventListener('click', () => {
  try {
    const recipe = validateRecipe(formRecipe());
    const { volume } = summarize(recipe.steps);
    confirmAction('추출을 시작할까요?', `탱크에 신선한 물을 ${volume}mL 이상 넣고, 드리퍼와 서버를 준비했는지 확인하세요.`, async () => {
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
    .then(() => { $('offline-status').textContent = '오프라인 사용 가능'; })
    .catch(() => { $('offline-status').textContent = '오프라인 저장을 완료하지 못했습니다.'; });
}

loadRecipe('');
render(brewer.state);

if (appleMobile || android) {
  $('platform-title').textContent = appleMobile ? 'iPhone·iPad 연결 미지원' : '블루투스 권한을 허용해 주세요';
  $('platform-message').textContent = appleMobile
    ? 'iPhone과 iPad에서는 Smart7 본체에 연결할 수 없습니다. Android 기기의 Chrome에서 이 주소를 다시 열어 주세요.'
    : 'Android Chrome에서 블루투스를 켠 뒤 BT 연결을 눌러 주세요. 블루투스 또는 주변 기기 권한을 묻는 창이 나오면 허용해 주세요.';
  $('platform-dialog').showModal();
}
