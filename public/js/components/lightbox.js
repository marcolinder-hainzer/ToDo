import { h, icon } from '../dom.js';
import { placeToasts } from '../ui.js';

/** Full-screen image viewer. images: [{ url, originalName }] */
export function openLightbox(images, startIndex = 0) {
  let index = startIndex;
  const img = h('img', { class: 'lightbox-img', alt: '' });
  const caption = h('div', { class: 'lightbox-caption' });
  const download = h('a', { class: 'icon-btn', title: 'Herunterladen', 'aria-label': 'Herunterladen' }, icon('download'));
  const prev = h('button', { class: 'icon-btn lightbox-nav prev', type: 'button', 'aria-label': 'Vorheriges Bild', onclick: () => show(index - 1) }, icon('chevronLeft'));
  const next = h('button', { class: 'icon-btn lightbox-nav next', type: 'button', 'aria-label': 'Nächstes Bild', onclick: () => show(index + 1) }, icon('chevronRight'));
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: () => dlg.close() }, icon('x'));

  const dlg = h(
    'dialog',
    { class: 'lightbox' },
    h('div', { class: 'lightbox-bar' }, caption, h('div', { class: 'lightbox-actions' }, download, closeBtn)),
    h('div', { class: 'lightbox-stage' }, prev, img, next),
  );

  function show(i) {
    index = (i + images.length) % images.length;
    const image = images[index];
    img.src = image.url;
    img.alt = image.originalName || 'Bild';
    download.href = image.url;
    download.setAttribute('download', image.originalName || 'bild');
    caption.textContent = `${images.length > 1 ? `${index + 1} / ${images.length} · ` : ''}${image.originalName || ''}`;
    prev.hidden = next.hidden = images.length < 2;
  }

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.classList.contains('lightbox-stage')) dlg.close();
  });
  let startX = null;
  dlg.addEventListener('pointerdown', (e) => (startX = e.clientX));
  dlg.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 60 && images.length > 1) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
  dlg.addEventListener('close', () => {
    placeToasts(dlg);
    dlg.remove();
  });

  document.body.append(dlg);
  show(index);
  dlg.showModal();
  placeToasts();
}
