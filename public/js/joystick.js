// On-screen stick for phones: drag the knob, onChange(x, y) gets -1..1 (y up = positive), 0,0 on release.
export function attachJoystick(el, onChange) {
  const knob = el.querySelector('i'); let id = null; let cx = 0, cy = 0;
  const set = (x, y) => onChange(x, y);
  const reset = () => { id = null; el.classList.remove('active'); knob.style.transform = ''; set(0, 0); };
  el.addEventListener('pointerdown', (ev) => {
    if (id !== null) return; id = ev.pointerId; el.setPointerCapture(id); el.classList.add('active');
    const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(ev); ev.preventDefault();
  });
  const move = (ev) => {
    if (ev.pointerId !== id) return;
    const max = el.offsetWidth * 0.42; let dx = ev.clientX - cx, dy = ev.clientY - cy; const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; set(dx / max, -dy / max);
  };
  el.addEventListener('pointermove', move);
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, (ev) => { if (ev.pointerId === id) reset(); });
  addEventListener('blur', reset);
}
