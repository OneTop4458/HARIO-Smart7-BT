// Smart7 overlays planned cumulative water with the device's countdown.
export function brewPoints(steps) {
  let seconds = 0;
  let volume = 0;
  const points = [{ seconds, volume }];
  for (const step of steps) {
    seconds += step.pour;
    volume += step.volume;
    points.push({ seconds, volume });
    if (step.wait > 0) {
      seconds += step.wait;
      points.push({ seconds, volume });
    }
  }
  return points;
}

export function drawBrewGraph(canvas, steps, elapsed) {
  const { width, height } = canvas.getBoundingClientRect();
  if (width < 80 || height < 70) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!steps.length) return;
  ctx.scale(ratio, ratio);
  const points = brewPoints(steps);
  const total = points.at(-1);
  const xMax = Math.max(30, Math.ceil(total.seconds / 30) * 30);
  const yMax = Math.max(1, total.volume);
  const margin = { left: 42, right: 14, top: 16, bottom: 23 };
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const x = seconds => margin.left + seconds / xMax * (right - margin.left);
  const y = volume => bottom - volume / yMax * (bottom - margin.top);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#b7c3d1';
  ctx.strokeStyle = '#495767';
  for (const volume of [0, Math.round(total.volume / 2), total.volume]) {
    ctx.textAlign = 'right';
    ctx.fillText(`${volume}`, margin.left - 6, y(volume) + 4);
    ctx.beginPath();
    ctx.moveTo(margin.left, y(volume));
    ctx.lineTo(right, y(volume));
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  const interval = Math.max(30, Math.ceil((xMax / 30) / ((right - margin.left) / 39)) * 30);
  for (let seconds = 0; seconds <= xMax; seconds += interval) {
    const minutes = Math.floor(seconds / 60);
    ctx.fillText(`${minutes}:${String(seconds % 60).padStart(2, '0')}`, x(seconds), bottom + 16);
  }

  ctx.strokeStyle = '#a4c8db';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [index, point] of points.entries()) {
    if (index === 0) ctx.moveTo(x(point.seconds), y(point.volume));
    else ctx.lineTo(x(point.seconds), y(point.volume));
  }
  ctx.stroke();
  if (elapsed != null) {
    const position = x(Math.max(0, Math.min(total.seconds, elapsed)));
    ctx.strokeStyle = '#ffd291';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(position, margin.top);
    ctx.lineTo(position, bottom);
    ctx.stroke();
  }
}
