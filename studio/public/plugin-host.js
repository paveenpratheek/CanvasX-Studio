/* The pages' side of the host API, version 1, as ter-manager defines it
 * (t-33bd14605d). NoteX's and RAGX's pages load it from /plugin-host.js
 * and get window.TerManager:
 *
 *   .ready                  host.info, once the studio has answered
 *   .terminal.open(opts)    { cwd, cmd, title }
 *   .storage.get/set/remove remembered per page by the studio
 *   .theme.get/onChange     the palette, applied to <html> for the page
 *
 * Messages are { __tm: 1, id, method, params } up and { __tm: 1, id, ok,
 * result | error } back, always to this page's own origin. Opened on its
 * own, outside the studio, it answers itself so the page still works.
 */
(function (global) {
  'use strict';

  const HOST_API = '1';
  const ORIGIN = global.location.origin;
  const HOSTED = !!(global.parent && global.parent !== global);

  let seq = 0;
  const pending = new Map();
  const listeners = [];
  let theme = { vars: {}, attrs: {} };

  function call(method, params) {
    if (!HOSTED) return alone(method, params || {});
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      global.parent.postMessage({ __tm: 1, id, method, params: params || {} }, ORIGIN);
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('the studio did not answer ' + method));
      }, 10000);
    });
  }

  global.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || e.source !== global.parent) return;
    const m = e.data;
    if (!m || m.__tm !== 1) return;
    if (m.event === 'theme') { take(m.theme); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || (m.method || 'call') + ' failed'));
  });

  function take(t) {
    if (!t) return;
    theme = t;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(t.vars || {})) root.style.setProperty(k, v);
    for (const [k, v] of Object.entries(t.attrs || {})) {
      if (v == null) root.removeAttribute(k); else root.setAttribute(k, v);
    }
    listeners.forEach((fn) => { try { fn(t); } catch (err) { console.error(err); } });
  }

  function alone(method, params) {
    switch (method) {
      case 'host.info': return Promise.resolve({ hostApi: HOST_API, pluginId: 'dev', hosted: false });
      case 'terminal.open': return Promise.resolve({ opened: false });
      case 'storage.get': try { const raw = localStorage.getItem('studio-dev.' + params.key); return Promise.resolve(raw == null ? null : JSON.parse(raw)); } catch (_) { return Promise.resolve(null); }
      case 'storage.set': try { localStorage.setItem('studio-dev.' + params.key, JSON.stringify(params.value)); } catch (_) {} return Promise.resolve(true);
      case 'storage.remove': try { localStorage.removeItem('studio-dev.' + params.key); } catch (_) {} return Promise.resolve(true);
      case 'theme.get': return Promise.resolve(theme);
      default: return Promise.reject(new Error('unknown method ' + method));
    }
  }

  const TerManager = {
    hostApi: HOST_API,
    isHosted: HOSTED,
    ready: null,
    terminal: { open(opts) { return call('terminal.open', opts || {}); } },
    storage: {
      get(key) { return call('storage.get', { key: String(key) }); },
      set(key, value) { return call('storage.set', { key: String(key), value }); },
      remove(key) { return call('storage.remove', { key: String(key) }); },
    },
    theme: {
      get() { return theme; },
      onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      },
    },
  };

  TerManager.ready = call('host.info').then((info) => {
    if (info && info.theme) take(info.theme);
    return info;
  }).catch(() => ({ hostApi: HOST_API, pluginId: 'dev', hosted: false }));

  global.TerManager = TerManager;
})(window);
