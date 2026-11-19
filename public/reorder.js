export function bindReorder(list, move, first = 0) {
  let drag;
  let frame;
  const index = row => [...list.children].indexOf(row);

  function updateTarget() {
    if (!drag?.active) return;
    const hit = document.elementFromPoint(drag.x, drag.y);
    const row = hit?.closest('li, .recipe-step');
    drag.target?.classList.remove('drop-target');
    drag.target = row?.parentElement === list && row !== drag.row && index(row) >= first ? row : null;
    drag.target?.classList.add('drop-target');
  }

  function scroll() {
    const edge = 72;
    const dy = drag.y < edge ? -8 : drag.y > window.innerHeight - edge ? 8 : 0;
    if (dy) {
      window.scrollBy(0, dy);
      updateTarget();
    }
    frame = requestAnimationFrame(scroll);
  }

  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-drag-handle]');
    if (!handle || event.button !== 0 || drag) return;
    const row = handle.closest('li, .recipe-step');
    if (row?.parentElement !== list || index(row) < first) return;
    drag = { row, id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    handle.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 6) {
      drag.active = true;
      drag.row.classList.add('dragging');
      frame = requestAnimationFrame(scroll);
    }
    updateTarget();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    list.addEventListener(type, event => {
      if (!drag || event.pointerId !== drag.id) return;
      const { row, target } = drag;
      drag = null;
      cancelAnimationFrame(frame);
      row.classList.remove('dragging');
      target?.classList.remove('drop-target');
      if (type === 'pointerup' && target) move(index(row), index(target));
    });
  }
}
