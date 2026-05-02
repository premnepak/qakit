// env-marker.js — QAKit
// Injected in MAIN world. Reads window.__qkitEnvMarker and renders a label.
// Variants: bar (top/bottom only), pill / ribbon (4 corners only).

(function installEnvMarker() {
  const ID = '__qkit-env-marker';
  const existing = document.getElementById(ID);
  if (existing) existing.remove();

  const cfg = window.__qkitEnvMarker;
  if (!cfg || !cfg.name) return;
  if (cfg.hidden) return;

  const variant   = cfg.variant   || 'bar';
  let position    = cfg.position  || (variant === 'bar' ? 'top' : 'top-right');
  // Coerce invalid combos: bar variant only supports top/bottom
  if (variant === 'bar' && position !== 'top' && position !== 'bottom') {
    position = position.startsWith('top') ? 'top' : 'bottom';
  }
  // pill/ribbon variants require a corner
  if ((variant === 'pill' || variant === 'ribbon') && (position === 'top' || position === 'bottom')) {
    position = position === 'top' ? 'top-right' : 'bottom-right';
  }
  const color     = cfg.color     || '#16a34a';
  const textColor = cfg.textColor || '#ffffff';
  const fontSize  = cfg.fontSize === 'small' ? '12px'
                   : cfg.fontSize === 'large' ? '16px'
                   : '14px';
  const opacityPct = (cfg.opacity != null) ? Math.max(0, Math.min(100, parseInt(cfg.opacity, 10))) : 90;
  const opacity    = (opacityPct / 100).toFixed(2);

  const el = document.createElement('div');
  el.id = ID;
  el.setAttribute('data-qkit', '1');

  const base = {
    position: 'fixed',
    'z-index': '2147483647',
    'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    'font-weight': '700',
    'font-size': fontSize,
    'letter-spacing': '.04em',
    'text-transform': 'uppercase',
    'pointer-events': 'auto',
    'user-select': 'none',
    'background': color,
    'color': textColor,
    'box-shadow': '0 2px 12px rgba(0,0,0,.25)',
    'opacity': opacity,
    'cursor': 'pointer',
    'transition': 'opacity .2s',
  };

  if (variant === 'bar') {
    Object.assign(base, {
      [position]: '0',
      [position === 'top' ? 'bottom' : 'top']: 'auto',
      'left': '0',
      'right': '0',
      'padding': '8px 16px',
      'text-align': 'center',
      'border-radius': '0',
    });
  } else if (variant === 'pill') {
    const [vert, horiz] = position.split('-');
    Object.assign(base, {
      [vert]: '12px',
      [horiz]: '12px',
      'padding': '8px 16px',
      'border-radius': '999px',
    });
  } else {
    // Ribbon — classic diagonal corner flag (GitHub-style).
    // Each corner uses a known-good offset + rotation combination.
    // transform-origin: center so the ribbon rotates around its middle.
    const [vert, horiz] = position.split('-');
    let rotate, vertVal, horizVal;

    if (vert === 'top' && horiz === 'right') {
      rotate = 45; vertVal = '30px'; horizVal = '-40px';
    } else if (vert === 'top' && horiz === 'left') {
      rotate = -45; vertVal = '30px'; horizVal = '-40px';
    } else if (vert === 'bottom' && horiz === 'right') {
      rotate = -45; vertVal = '30px'; horizVal = '-40px';
    } else {
      rotate = 45; vertVal = '30px'; horizVal = '-40px';
    }

    Object.assign(base, {
      [vert]:             vertVal,
      [horiz]:            horizVal,
      'width':            '160px',
      'padding':          '6px 0',
      'text-align':       'center',
      'white-space':      'nowrap',
      'overflow':         'hidden',
      'text-overflow':    'ellipsis',
      'transform':        `rotate(${rotate}deg)`,
      'transform-origin': 'center center',
    });
  }

  el.style.cssText = Object.entries(base).map(([k, v]) => k + ':' + v).join(';');
  el.textContent = cfg.name;
  el.title = 'QAKit · ' + cfg.name + ' — double-click to hide for this page load';

  el.addEventListener('mouseenter', () => { el.style.opacity = '1'; });
  el.addEventListener('mouseleave', () => { el.style.opacity = opacity; });

  // Double-click to hide (single click is too easy to trigger accidentally)
  el.addEventListener('dblclick', () => {
    el.style.display = 'none';
  });
  // Suppress single-click hide entirely
  el.addEventListener('click', (e) => { e.stopPropagation(); });

  document.documentElement.appendChild(el);
})();
