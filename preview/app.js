import component from '/watch-entry.js';

const markup = await fetch('/watch.hml').then(response => response.text());
document.querySelector('#watch').innerHTML = markup;
const bindings = [];
const root = document.querySelector('#watch');
const rings = [...root.querySelectorAll('progress')].map(ring => {
  const size = parseFloat(getComputedStyle(ring).width);
  const center = size / 2;
  const radius = center - 7;
  const color = getComputedStyle(ring).color;
  const track = ring.classList.contains('five-hour-ring') ? '#102B39' : '#30271A';
  const valueKey = ring.getAttribute('percent').replace(/[{}\s]/g, '');
  const angle = degree => [center + radius * Math.cos(degree * Math.PI / 180), center + radius * Math.sin(degree * Math.PI / 180)];
  const start = angle(130), end = angle(410);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = `<path d="M${start} A${radius} ${radius} 0 1 1 ${end}" fill="none" stroke="${track}" stroke-width="7" stroke-linecap="round"/><path class="fill" d="M${start} A${radius} ${radius} 0 1 1 ${end}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" pathLength="100"/>`;
  const replacement = document.createElement('div');
  replacement.className = ring.className;
  if (ring.hasAttribute('show')) replacement.setAttribute('show', ring.getAttribute('show'));
  replacement.append(svg);
  ring.replaceWith(replacement);
  return { fill: svg.querySelector('.fill'), valueKey };
});
root.querySelectorAll('*').forEach(element => {
  for (const attribute of [...element.attributes]) {
    if (attribute.value.includes('{{')) bindings.push({ element, name: attribute.name, template: attribute.value });
  }
  if (!element.children.length && element.textContent.includes('{{')) bindings.push({ element, name: 'text', template: element.textContent });
});
let app;
const interpolate = template => template.replace(/{{\s*(!?\w+)\s*}}/g, (_, key) => key[0] === '!' ? !app[key.slice(1)] : app[key] ?? '');
const paint = () => {
  for (const binding of bindings) {
    const value = interpolate(binding.template);
    if (binding.name === 'text') binding.element.textContent = value;
    else if (binding.name === 'show') binding.element.hidden = value !== 'true';
    else binding.element.setAttribute(binding.name, value);
  }
  for (const {fill, valueKey} of rings) {
    const percent = app[valueKey] || 0;
    fill.setAttribute('stroke-dasharray', `${percent} 100`);
    fill.style.visibility = percent ? 'visible' : 'hidden';
  }
  const refresh = root.querySelector('.refresh');
  refresh.disabled = app.refreshing;
  refresh.setAttribute('aria-busy', String(app.refreshing));
};
app = new Proxy({ ...component.data }, { set(target, key, value) { target[key] = value; queueMicrotask(paint); return true; } });
for (const [key, value] of Object.entries(component)) if (typeof value === 'function') app[key] = value.bind(app);
root.querySelectorAll('[onclick]').forEach(element => {
  const method = element.getAttribute('onclick');
  element.removeAttribute('onclick');
  element.addEventListener('click', () => app[method]());
  if (element.tagName !== 'INPUT') {
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); app[method](); } });
  }
});
document.querySelector('#offline').onclick = event => {
  window.simulateOffline = !window.simulateOffline;
  event.target.textContent = window.simulateOffline ? '恢复联网' : '模拟断网';
};
document.querySelector('#retry').onclick = () => { app.onDestroy(); app.onInit(); };
window.addEventListener('pagehide', () => app.onDestroy());
paint();
app.onInit();
