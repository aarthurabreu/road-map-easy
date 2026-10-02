import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const page = readFileSync(new URL('../app/trip-guide/live-google-map.tsx', import.meta.url), 'utf8');
const markers = readFileSync(new URL('../app/map-markers.ts', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

function functionSource(name) {
  const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing ${name}`);
  return declaration.getText(ast).replace(/^export /, '');
}

function runtime() {
  const state = { maps: [], markers: [], pins: [], detached: 0, pans: 0, watches: new Map() };
  class FakeMap {
    constructor(container, options) { this.options = options; this.center = options.center; this.zoom = options.zoom; state.maps.push(this); }
    addListener(type, fn) { this.click = fn; return { remove: () => { this.click = null; } }; }
    getCenter() { return { toJSON: () => this.center }; }
    getZoom() { return this.zoom; }
    getHeading() { return 0; }
    getTilt() { return 0; }
    panTo(position) { state.pans++; this.center = position; }
  }
  class Marker {
    constructor(options) { Object.assign(this, options); this.events = new Map(); state.markers.push(this); }
    set map(value) { if (value === null) state.detached++; this.attachedMap = value; }
    get map() { return this.attachedMap; }
    addEventListener(type, fn) { this.events.set(type, fn); }
    removeEventListener(type) { this.events.delete(type); }
  }
  class Pin { constructor(options) { Object.assign(this, options); state.pins.push(this); } }
  const context = vm.createContext({
    exports: {},
    google: { maps: { Map: FakeMap, marker: { AdvancedMarkerElement: Marker, PinElement: Pin }, event: { clearInstanceListeners() {} } } },
    navigator: { geolocation: {
      watchPosition(fn) { const id = state.watches.size + 1; state.watches.set(id, fn); return id; },
      clearWatch(id) { state.watches.delete(id); },
    } },
    document: { createElement: () => ({ className: '' }) },
  });
  const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInContext(compile(markers), context);
  return { state, context, compile, registry: context.exports.createMarkerRegistry };
}

const pin = (id, selected = false) => ({ id, lat: -27.5, lng: -48.5, color: '#1f7a50', glyph: '•', title: id, selected });

test('GPS-driven reordering and 100 refreshes preserve marker and pin instances', () => {
  const { state, registry } = runtime();
  const saved = registry({}, () => {});
  saved.update([pin('a'), pin('b')]);
  const originals = [...state.markers];
  for (let index = 0; index < 100; index++) saved.update(index % 2 ? [pin('a'), pin('b')] : [pin('b'), pin('a')]);
  assert.equal(state.markers.length, 2);
  assert.equal(state.pins.length, 2);
  assert.equal(state.detached, 0);
  assert.deepEqual(state.markers, originals);
  assert.equal(state.pans, 0);
});

test('selection, pin color, translation and coordinates update in place; removal cleans only its marker', () => {
  const { state, registry } = runtime();
  const clicks = [];
  const saved = registry({}, (id) => clicks.push(id));
  saved.update([pin('a'), pin('b')]);
  saved.update([{ ...pin('a', true), color: '#2f80da', title: 'Aberto agora', lat: -28 }, pin('b')]);
  assert.equal(state.markers.length, 2);
  assert.equal(state.pins[0].background, '#2f80da');
  assert.equal(state.pins[0].scale, 1.28);
  assert.equal(state.markers[0].title, 'Aberto agora');
  assert.equal(state.markers[0].position.lat, -28);
  state.markers[0].events.get('gmp-click')();
  assert.deepEqual(clicks, ['a']);
  saved.update([pin('b')]);
  assert.equal(state.detached, 1);
  assert.equal(state.markers[0].events.size, 0);
  saved.update([pin('b'), pin('c')]);
  assert.equal(state.markers.length, 3);
  saved.clear();
  assert.equal(state.detached, 3);
  saved.clear();
  assert.equal(state.detached, 3);
});

test('live component: GPS/notes/language do not reset camera; theme retains viewport and one GPS watch', () => {
  const { state, context, compile } = runtime();
  const refs = [], effects = [];
  let cursor = 0, queue = [];
  const host = { replaceChildren() {} };
  context.useRef = (value) => { const index = cursor++; return refs[index] ??= { current: value }; };
  context.useEffect = (effect, dependencies) => {
    const index = cursor++;
    const previous = effects[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      queue.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: effect() }; });
    }
  };
  context.React = { createElement(tag, props) { if (props.ref) props.ref.current = host; return {}; } };
  context.translations = { pt: { liveLocation: 'Localização', liveMapLabel: 'Mapa' }, en: { liveLocation: 'Location', liveMapLabel: 'Map' } };
  context.getPinColor = (place) => place.pinColor || '#1f7a50';
  context.localizedStatusLabel = (label) => label;
  vm.runInContext(compile(functionSource('LiveGoogleMap')), context);
  const render = (props) => { cursor = 0; queue = []; context.LiveGoogleMap(props); queue.forEach((effect) => effect()); };
  let readyMap, selected = '', location;
  const props = {
    places: [{ id: 'a', lat: -27.5, lng: -48.5, name: 'A', category: 'Parque', statusLabel: 'Aberto' }],
    selectedId: 'a', onSelect: (id) => { selected = id; }, onMapPlaceClick() {},
    onUserPosition: (value) => { location = value; }, onMapReady: (map) => { readyMap = map; },
    trackUser: true, userPosition: { lat: -27.51, lng: -48.51 }, language: 'pt', theme: 'light',
  };
  render(props);
  assert.equal(state.maps.length, 1);
  assert.equal(state.watches.size, 1);
  assert.equal(state.markers.length, 2); // Saved place + blue location dot.
  readyMap.center = { lat: -27.7, lng: -48.8 };
  readyMap.zoom = 17;
  for (let step = 0; step < 30; step++) {
    state.watches.values().next().value({ coords: { latitude: -27.52 + step / 1000, longitude: -48.51 } });
    render({ ...props, places: props.places.map((place) => ({ ...place, note: `${step}` })), userPosition: location, onSelect: (id) => { selected = `latest:${id}`; } });
  }
  state.markers[0].events.get('gmp-click')();
  assert.equal(selected, 'latest:a');
  assert.equal(state.maps.length, 1);
  assert.equal(state.markers.length, 2);
  assert.equal(state.detached, 0);
  assert.equal(state.pans, 0);
  render({ ...props, language: 'en' });
  assert.equal(state.maps.length, 1);
  assert.equal(state.watches.size, 1);
  render({ ...props, theme: 'dark', userPosition: location });
  assert.equal(state.maps.length, 2);
  assert.equal(readyMap.options.colorScheme, 'DARK');
  assert.equal(readyMap.center.lat, -27.7);
  assert.equal(readyMap.zoom, 17);
  assert.equal(state.watches.size, 1);
  assert.equal(state.pans, 0);
  effects.forEach((effect) => effect?.cleanup?.());
  assert.equal(state.watches.size, 0);
  assert.ok(state.markers.every((marker) => marker.map === null));
});

test('theme bootstrap respects saved choice, falls back to device and tolerates blocked storage', () => {
  const source = layout.match(/const themeBootstrap = `([^`]+)`;/)?.[1];
  assert.ok(source);
  for (const [saved, systemDark, expected, blocked] of [
    ['dark', false, 'dark'], ['light', true, 'light'], [null, true, 'dark'],
    ['invalid', false, 'light'], [null, true, 'dark', true],
  ]) {
    const root = { dataset: {} }, meta = {};
    vm.runInNewContext(source, {
      localStorage: { getItem() { if (blocked) throw new Error('blocked'); return saved; } },
      window: { matchMedia: () => ({ matches: systemDark }) },
      document: { documentElement: root, querySelector: () => meta },
    });
    assert.equal(root.dataset.theme, expected);
    assert.equal(meta.content, expected === 'dark' ? '#14201b' : '#fffdfa');
  }
});
