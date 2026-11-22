/*
  3D model viewer + inspector for the portfolio.
  Models are listed in models/models.json (see models/README.txt).
*/
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MANIFEST = 'models/models.json';
const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 7000);
}
function setStatus(msg) {
  const s = $('status');
  s.hidden = !msg;
  s.textContent = msg || '';
}

/* ================= Scene ================= */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.prepend(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', '3D model viewer: drag to orbit, scroll to zoom, right-drag to pan');

function makeScene(r) {
  const s = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(r);
  s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;   // reflections, so metal looks like metal
  s.add(new THREE.HemisphereLight(0xffffff, 0x3a3d4f, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0xf0782b, 0.8);
  rim.position.set(-4, 2, -3);
  s.add(key, rim);
  return s;
}
const scene = makeScene(renderer);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.9;
controls.minDistance = 0.8;
controls.maxDistance = 14;
controls.minPolarAngle = 0;          // orbit over the top...
controls.maxPolarAngle = Math.PI;    // ...and underneath
controls.screenSpacePanning = true;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 1.6;

// Turntable the models stand on
const turntable = new THREE.Group();
const tableMat = new THREE.MeshStandardMaterial({ color: '#232634', roughness: 0.6 });
const glowMat = new THREE.MeshStandardMaterial({ color: '#f0782b', emissive: '#f0782b', emissiveIntensity: 1.2 });
const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.4, 0.08, 64), tableMat);
disc.position.y = -0.04;
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.39, 0.018, 8, 96), glowMat);
ring.rotation.x = Math.PI / 2;
turntable.add(disc, ring);
scene.add(turntable);

const holder = new THREE.Group();   // the model currently shown
scene.add(holder);

/* ================= Textures: naming & loading ================= */
// What a texture file is, from its name.
//   "...RoughnessMetallic..."        -> roughness in RED, metallic in GREEN (Blender bake / Bed_RoughnessMetallic.png)
//   "...MetallicRoughness..." / ORM  -> glTF layout: roughness in GREEN, metallic in BLUE
export function classify(name) {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  if (/normal|nrm|_nor$|_n$/.test(n)) return 'normal';
  if (/rough\w*metal/.test(n)) return 'rm';
  if (/metal\w*rough|(^|[_\-. ])orm([_\-. ]|$)/.test(n)) return 'mr';
  if (/rough/.test(n)) return 'rough';
  if (/metal/.test(n)) return 'metal';
  if (/emiss|emit|glow/.test(n)) return 'emission';
  if (/base|albedo|diffuse|colou?r|col$|_d$/.test(n)) return 'base';
  return null;
}
const KIND_LABEL = { base: 'base color', normal: 'normal', rough: 'roughness', metal: 'metallic', emission: 'emission', rm: 'roughness (R) + metallic (G)', mr: 'roughness (G) + metallic (B)' };

// PNG / JPEG images packed inside a binary FBX, with the file name stored just before each.
export function extractEmbedded(buffer) {
  const bytes = new Uint8Array(buffer);
  const found = [];
  const latin = (a, b) => { let s = ''; for (let i = a; i < b; i++) s += String.fromCharCode(bytes[i]); return s; };
  const kinds = [
    { sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], end: [0x49, 0x45, 0x4e, 0x44], extra: 8, type: 'image/png' },
    { sig: [0xff, 0xd8, 0xff], end: [0xff, 0xd9], extra: 2, type: 'image/jpeg' },
  ];
  const at = (i, arr) => arr.every((v, k) => bytes[i + k] === v);
  for (const { sig, end, extra, type } of kinds) {
    for (let i = 0; i < bytes.length - sig.length; i++) {
      if (bytes[i] !== sig[0] || !at(i, sig)) continue;
      let j = i + sig.length;
      while (j < bytes.length - end.length && !at(j, end)) j++;
      const stop = Math.min(j + extra, bytes.length);
      const names = latin(Math.max(0, i - 3000), i).match(/[\w\- .]+\.(png|jpe?g|tga)/gi);
      found.push({ name: names ? names[names.length - 1].trim() : `embedded_${found.length}`, blob: new Blob([bytes.slice(i, stop)], { type }) });
      i = stop;
    }
  }
  return found;
}

const texLoader = new THREE.TextureLoader();
function repackRM(image) {
  // R = roughness, G = metallic  ->  three.js layout: G = roughness, B = metallic
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let p = 0; p < d.data.length; p += 4) {
    const r = d.data[p], gr = d.data[p + 1];
    d.data[p] = 0; d.data[p + 1] = r; d.data[p + 2] = gr;
  }
  g.putImageData(d, 0, 0);
  return new THREE.CanvasTexture(c);
}

// files: [{ name, url, kind? }] -> { base, normal, rough, metal, emission, notes[] }
async function buildMapSet(files, flipY) {
  const set = { notes: [] };
  for (const f of files) {
    const kind = f.kind || classify(f.name);
    if (!kind) continue;
    let tex = await texLoader.loadAsync(f.url);
    if (kind === 'rm') { tex = repackRM(tex.image); set.rough = set.metal = tex; }
    else if (kind === 'mr') { set.rough = set.metal = tex; }
    else set[kind] = tex;
    tex.flipY = flipY;
    tex.colorSpace = kind === 'base' || kind === 'emission' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    set.notes.push(`${f.name} → ${KIND_LABEL[kind]}`);
  }
  return set;
}

function pbrFrom(set, old) {
  return new THREE.MeshStandardMaterial({
    name: (old && old.name) || 'Material',
    color: set.base ? '#ffffff' : (old && old.color ? old.color.clone() : new THREE.Color('#cccccc')),
    map: set.base || (old && old.map) || null,
    normalMap: set.normal || (old && old.normalMap) || null,
    roughnessMap: set.rough || null,
    metalnessMap: set.metal || null,
    roughness: set.rough ? 1 : 0.7,
    metalness: set.metal ? 1 : 0,
    emissiveMap: set.emission || null,
    emissive: set.emission ? '#ffffff' : '#000000',
    side: old ? old.side : THREE.FrontSide,
    transparent: !!(old && old.transparent),
    opacity: old && old.opacity !== undefined ? old.opacity : 1,
  });
}

/* ================= Fetching (with a fallback for the preview host) ================= */
async function fetchBuffer(url) {
  const r = await fetch(url);
  if (r.ok) return r.arrayBuffer();
  // Preview only: some hosts can't serve .fbx, so a base64 copy may sit next to it.
  const b = await fetch(url + '.b64.txt');
  if (!b.ok) throw new Error(`Could not load ${url} (${r.status})`);
  const bin = atob((await b.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function exists(url) {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
}
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);

/* ================= Building a model ================= */
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

async function parseModel(buffer, ext) {
  if (ext === 'glb') return new Promise((res, rej) => gltfLoader.parse(buffer, '', (g) => res(g.scene), rej));
  if (ext === 'fbx') return fbxLoader.parse(buffer, '');
  throw new Error('Use a .glb or .fbx file');
}

// buffer + ext + extra texture files -> normalised root (fits the turntable), notes
async function buildModel(buffer, ext, textureFiles) {
  const root = await parseModel(buffer, ext);
  let files = ext === 'fbx' ? extractEmbedded(buffer).map((e) => ({ name: e.name, url: URL.createObjectURL(e.blob) })) : [];
  // Separate texture files win over embedded ones of the same kind.
  const kindOf = (f) => f.kind || classify(f.name);
  const kindsGiven = new Set(textureFiles.map(kindOf));
  const covers = (k) => kindsGiven.has(k) || ((k === 'rm' || k === 'mr') && (kindsGiven.has('rough') || kindsGiven.has('metal'))) ||
    ((k === 'rough' || k === 'metal') && (kindsGiven.has('rm') || kindsGiven.has('mr')));
  files = files.filter((f) => !covers(kindOf(f))).concat(textureFiles);
  const set = await buildMapSet(files, ext !== 'glb');
  const useSet = set.notes.length > 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => (useSet || !m.isMeshStandardMaterial ? pbrFrom(useSet ? set : {}, m) : m));
    o.material = Array.isArray(o.material) ? next : next[0];
  });
  normalise(root);
  return { root, notes: set.notes };
}

function normalise(root) {
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.scale.multiplyScalar(2.2 / (Math.max(size.x, size.y, size.z) || 1));
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= box.min.y;
}

function materialsOf(root) {
  const set = new Set();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.helper) return;
    const orig = o.userData.orig || o.material;
    (Array.isArray(orig) ? orig : [orig]).forEach((m) => set.add(m));
  });
  return [...set];
}

/* ================= Showing a model ================= */
let current = null;        // { root, title, notes }
let loadToken = 0;

function frameModel(root) {
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const h = size.y;
  controls.target.set(0, Math.max(h / 2, 0.3), 0);
  const dist = 2.2 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.5 + 0.6;
  camera.position.set(dist * 0.45, h * 0.6 + dist * 0.35, dist * 0.85);
  controls.update();
  controls.saveState();
}

function display(model) {
  holder.children.slice().forEach((c) => holder.remove(c));
  holder.add(model.root);
  current = model;
  materialsOf(model.root).forEach(rememberDefaults);
  $('model-name').textContent = model.title;
  $('model-sub').textContent = model.subtitle || 'Orbit it like in Blender';
  frameModel(model.root);
  syncSliders();
  refreshView();
  setStatus('');
}

/* ================= Inspector ================= */
let mode = 'final';
const overlays = { wire: false, normals: false };
const LABELS = {
  clay: 'Clay', base: 'Base Color', normal: 'Normal Map',
  roughness: 'Roughness · black = glossy, white = rough', metallic: 'Metallic · white = metal',
  emission: 'Emission', uv: 'UV checker',
};

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const matcapTex = canvasTexture(256, (g, s) => {
  const grad = g.createRadialGradient(s * 0.38, s * 0.34, s * 0.04, s * 0.5, s * 0.5, s * 0.5);
  grad.addColorStop(0, '#fff6ea'); grad.addColorStop(0.45, '#d3b89b'); grad.addColorStop(0.85, '#8a6f58'); grad.addColorStop(1, '#3b2f27');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
});
const checkerTex = canvasTexture(512, (g, s) => {
  const n = 8, cell = s / n;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${cell * 0.32}px Poppins, sans-serif`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? '#232634' : '#f0782b';
    g.fillRect(x * cell, y * cell, cell, cell);
    g.fillStyle = (x + y) % 2 ? '#ffffff' : '#1b1d29';
    g.fillText(String.fromCharCode(65 + x) + (n - y), x * cell + cell / 2, y * cell + cell / 2);
  }
});

const channelVert = `
  varying vec2 vUv;
  uniform mat3 uvTransform;
  void main() {
    vUv = (uvTransform * vec3(uv, 1.0)).xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const channelFrag = `
  uniform sampler2D map;
  uniform bool hasMap;
  uniform int channel;   // 0 = rgb, 1 = green, 2 = blue
  uniform vec3 factor;
  varying vec2 vUv;
  void main() {
    vec3 c = vec3(1.0);
    if (hasMap) {
      vec4 t = texture2D(map, vUv);
      c = channel == 0 ? t.rgb : (channel == 1 ? vec3(t.g) : vec3(t.b));
    }
    gl_FragColor = vec4(c * factor, 1.0);
    #ifdef ENCODE
    #include <colorspace_fragment>
    #endif
  }`;
function channelMaterial(map, channel, factor, encode, side) {
  if (map) map.updateMatrix();
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map || null }, hasMap: { value: !!map }, channel: { value: channel },
      factor: { value: factor }, uvTransform: { value: map ? map.matrix : new THREE.Matrix3() },
    },
    vertexShader: channelVert, fragmentShader: channelFrag,
    defines: encode ? { ENCODE: '' } : {}, side, toneMapped: false,
  });
}
const v3 = (x, y = x, z = x) => new THREE.Vector3(x, y, z);

const cache = new Map();
function viewMaterial(orig, m) {
  if (m === 'final') return orig;
  const key = orig.uuid + m;
  if (cache.has(key)) return cache.get(key);
  const side = orig.side;
  const col = orig.color || new THREE.Color(1, 1, 1);
  let out;
  if (m === 'clay') {
    out = new THREE.MeshMatcapMaterial({ matcap: matcapTex, normalMap: orig.normalMap || null, side });
    if (orig.normalScale) out.normalScale.copy(orig.normalScale);
  }
  else if (m === 'uv') out = new THREE.MeshBasicMaterial({ map: checkerTex, side });
  else if (m === 'base') out = channelMaterial(orig.map, 0, v3(col.r, col.g, col.b), true, side);
  else if (m === 'normal') out = channelMaterial(orig.normalMap, 0, orig.normalMap ? v3(1) : v3(0.5, 0.5, 1.0), false, side);
  else if (m === 'roughness') out = channelMaterial(orig.roughnessMap, 1, v3(orig.roughness ?? 1), false, side);
  else if (m === 'metallic') out = channelMaterial(orig.metalnessMap, 2, v3(orig.metalness ?? 0), false, side);
  else if (m === 'emission') {
    const e = orig.emissive ? orig.emissive.clone().multiplyScalar(orig.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0);
    out = channelMaterial(orig.emissiveMap, 0, v3(e.r, e.g, e.b), true, side);
  }
  cache.set(key, out);
  return out;
}

// Swap every mesh to the material for the current mode. Cheap: safe to call while a slider moves.
function applyMaterials() {
  cache.forEach((m) => m.dispose && m.dispose());
  cache.clear();
  if (!current) return;
  current.root.traverse((o) => {
    if (!o.isMesh || o.userData.helper) return;
    if (!o.userData.orig) o.userData.orig = o.material;
    const orig = o.userData.orig;
    o.material = Array.isArray(orig) ? orig.map((om) => viewMaterial(om, mode)) : viewMaterial(orig, mode);
  });
  const lab = $('channel-label');
  lab.hidden = mode === 'final';
  lab.textContent = LABELS[mode] || '';
}

const helpers = [];
const wireMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
function applyOverlays() {
  helpers.splice(0).forEach((h) => { h.parent && h.parent.remove(h); h.geometry && h.geometry.dispose(); });
  if (!current) return;
  current.root.updateMatrixWorld(true);
  const meshes = [];
  current.root.traverse((o) => { if (o.isMesh && !o.userData.helper) meshes.push(o); });
  for (const o of meshes) {
    if (overlays.wire) {
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), wireMat);
      w.userData.helper = true;
      o.add(w);
      helpers.push(w);
    }
    if (overlays.normals && o.geometry.attributes.normal) {
      const box = new THREE.Box3().setFromObject(current.root).getSize(new THREE.Vector3());
      const h = new VertexNormalsHelper(o, Math.max(box.x, box.y, box.z) * 0.02, 0x7fd1b9);
      h.userData.helper = true;
      scene.add(h);
      helpers.push(h);
    }
  }
}

function updateStats() {
  if (!current) return;
  let tris = 0, verts = 0;
  const tex = new Set();
  current.root.traverse((o) => {
    if (!o.isMesh || o.userData.helper) return;
    const g = o.geometry;
    verts += g.attributes.position.count;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  const mats = materialsOf(current.root);
  mats.forEach((m) => ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'].forEach((k) => m[k] && tex.add(m[k].uuid)));
  $('st-tris').textContent = Math.round(tris).toLocaleString();
  $('st-verts').textContent = verts.toLocaleString();
  $('st-tex').textContent = tex.size;
  $('st-mats').textContent = mats.length;
}

function refreshView() {
  applyMaterials();
  applyOverlays();
  updateStats();
}

$('inspector').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) {
    mode = b.dataset.mode;
    document.querySelectorAll('#inspector [data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('view-label').textContent = b.textContent.trim();
    $('view-ic').className = b.querySelector('.ic').className;
    applyMaterials();
    closeMenus();
  } else if (b.dataset.toggle) {
    overlays[b.dataset.toggle] = !overlays[b.dataset.toggle];
    b.setAttribute('aria-pressed', String(overlays[b.dataset.toggle]));
    applyOverlays();
  }
});

/* ================= Compact dropdowns (View / Material) ================= */
const MENUS = [['view-btn', 'inspector'], ['mat-btn', 'mat-menu']];
function closeMenus(except) {
  for (const [b, m] of MENUS) {
    if (b === except) continue;
    $(m).hidden = true;
    $(b).setAttribute('aria-expanded', 'false');
  }
}
for (const [b, m] of MENUS) {
  $(b).addEventListener('click', () => {
    const open = $(m).hidden;
    closeMenus(b);
    $(m).hidden = !open;
    $(b).setAttribute('aria-expanded', String(open));
  });
}
// Close when clicking anywhere else, or pressing Escape.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest || !e.target.closest('.dd')) closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const openBtn = MENUS.find(([, m]) => !$(m).hidden);
  closeMenus();
  if (openBtn) $(openBtn[0]).focus();
});

/* ================= Material sliders ================= */
function rememberDefaults(m) {
  if (m.userData.def) return;
  m.userData.def = {
    color: m.color ? m.color.clone() : null,
    roughness: m.roughness, metalness: m.metalness,
    normalScale: m.normalScale ? m.normalScale.clone() : null,
    emissiveIntensity: m.emissiveIntensity,
  };
}
const S = { tint: $('s-tint'), rough: $('s-rough'), metal: $('s-metal'), normal: $('s-normal'), emit: $('s-emit') };
const O = { rough: $('o-rough'), metal: $('o-metal'), normal: $('o-normal'), emit: $('o-emit') };
function showValues() {
  O.rough.textContent = Number(S.rough.value).toFixed(2);
  O.metal.textContent = Number(S.metal.value).toFixed(2);
  O.normal.textContent = Number(S.normal.value).toFixed(2);
  O.emit.textContent = Number(S.emit.value).toFixed(2);
}
// Put the sliders where the loaded model's first material is.
function syncSliders() {
  const m = current && materialsOf(current.root).find((x) => x.isMeshStandardMaterial);
  S.tint.value = '#ffffff';
  S.rough.value = m ? m.roughness : 1;
  S.metal.value = m ? m.metalness : 0;
  S.normal.value = m && m.normalScale ? m.normalScale.x : 1;
  S.emit.value = m ? m.emissiveIntensity : 1;
  showValues();
}
function applySliders() {
  if (!current) return;
  const tint = new THREE.Color(S.tint.value);
  for (const m of materialsOf(current.root)) {
    if (!m.isMeshStandardMaterial) continue;
    const d = m.userData.def;
    if (d.color) m.color.copy(d.color).multiply(tint);
    m.roughness = Number(S.rough.value);
    m.metalness = Number(S.metal.value);
    if (m.normalScale) { const v = Number(S.normal.value); m.normalScale.set(v, d.normalScale && d.normalScale.y < 0 ? -v : v); }
    m.emissiveIntensity = Number(S.emit.value);
  }
  showValues();
  if (mode !== 'final') applyMaterials();
}
Object.values(S).forEach((el) => el.addEventListener('input', applySliders));
$('mat-reset').addEventListener('click', () => {
  if (!current) return;
  for (const m of materialsOf(current.root)) {
    const d = m.userData.def;
    if (!d) continue;
    if (d.color) m.color.copy(d.color);
    m.roughness = d.roughness; m.metalness = d.metalness;
    if (d.normalScale) m.normalScale.copy(d.normalScale);
    m.emissiveIntensity = d.emissiveIntensity;
  }
  syncSliders();
  applyMaterials();
});

/* ================= Render loop & viewer tools ================= */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const ro = new ResizeObserver(resize);
ro.observe(stage);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

const spinBtn = $('spin');
spinBtn.setAttribute('aria-pressed', String(controls.autoRotate));
controls.addEventListener('start', () => { controls.autoRotate = false; spinBtn.setAttribute('aria-pressed', 'false'); });
spinBtn.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  spinBtn.setAttribute('aria-pressed', String(controls.autoRotate));
});
$('reset').addEventListener('click', () => controls.reset());
$('full').addEventListener('click', () => {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen().catch(() => toast('Fullscreen is not available here.'));
  } catch { toast('Fullscreen is not available here.'); }
});

/* ================= Gallery (models/models.json) ================= */
let entries = [];
const built = new Map();     // index -> { root, title, notes, subtitle }
const CUBE = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderGallery() {
  const grid = $('gallery-grid');
  if (!entries.length) {
    grid.innerHTML = '<p class="empty">No models yet. Add them to models/models.json (see models/README.txt).</p>';
    return;
  }
  grid.innerHTML = entries.map((e, i) => `
    <button type="button" class="card tile" data-i="${i}" aria-pressed="false">
      <span class="thumb">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy">` : CUBE}<span class="now" hidden>In viewer</span></span>
      <span class="tile-body">
        <strong>${esc(e.title || 'Untitled model')}</strong>
        ${e.description ? `<small>${esc(e.description)}</small>` : ''}
        ${e.tags && e.tags.length ? `<span class="tags">${e.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span>` : ''}
      </span>
    </button>`).join('');
}
function markActive(i) {
  document.querySelectorAll('#gallery-grid .tile').forEach((t) => {
    const on = Number(t.dataset.i) === i;
    t.setAttribute('aria-pressed', String(on));
    t.querySelector('.now').hidden = !on;
  });
}

async function texturesFor(entry) {
  const base = dirOf(entry.file);
  if (entry.textures && typeof entry.textures === 'object') {
    // { "basecolor": "textures/x.jpg", ... } — paths relative to the model's folder
    const KIND = { basecolor: 'base', base: 'base', normal: 'normal', roughness: 'rough', metallic: 'metal', emission: 'emission', roughnessmetallic: 'rm', metallicroughness: 'mr' };
    return Object.entries(entry.textures).map(([k, p]) => ({ name: p.split('/').pop(), url: base + p, kind: KIND[k.toLowerCase()] || classify(p) }));
  }
  // No list given: look for the standard names in the model's textures/ folder.
  const out = [];
  for (const n of ['basecolor', 'normal', 'roughness', 'metallic', 'emission', 'roughnessmetallic']) {
    for (const ext of ['png', 'jpg']) {
      const url = `${base}textures/${n}.${ext}`;
      if (await exists(url)) { out.push({ name: `${n}.${ext}`, url }); break; }
    }
  }
  return out;
}

async function buildEntry(i) {
  if (built.has(i)) return built.get(i);
  const e = entries[i];
  const ext = e.file.split('.').pop().toLowerCase();
  const [buffer, textures] = await Promise.all([fetchBuffer(e.file), texturesFor(e)]);
  const { root, notes } = await buildModel(buffer, ext, textures);
  const model = { root, title: e.title || 'Untitled model', subtitle: e.description || 'Orbit it like in Blender', notes };
  built.set(i, model);
  return model;
}

async function openEntry(i, scroll) {
  const token = ++loadToken;
  markActive(i);
  if (scroll) $('viewer').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  if (!built.has(i)) setStatus(`Loading ${entries[i].title || 'model'}…`);
  try {
    const model = await buildEntry(i);
    if (token !== loadToken) return;            // a newer click won
    display(model);
    if (model.notes.length) toast('Texture maps: ' + model.notes.join(' · '));
    makeThumbnail(i);
  } catch (err) {
    console.error(err);
    if (token === loadToken) setStatus(`Couldn't load "${entries[i].title}". Check the file path in models/models.json.`);
  }
}

$('gallery-grid').addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (t) openEntry(Number(t.dataset.i), true);
});

/* ---------- automatic thumbnails for models without one ---------- */
let thumbR = null, thumbScene, thumbCam;
function makeThumbnail(i) {
  const e = entries[i];
  const model = built.get(i);
  if (e.thumbnail || !model || model.thumb) return;
  try {
    if (!thumbR) {
      thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbR.setSize(480, 360, false);
      thumbR.outputColorSpace = THREE.SRGBColorSpace;
      thumbR.toneMapping = THREE.ACESFilmicToneMapping;
      thumbScene = makeScene(thumbR);
      thumbCam = new THREE.PerspectiveCamera(35, 4 / 3, 0.05, 100);
    }
    // Render with the real materials, whatever the inspector is showing.
    const swaps = [];
    model.root.traverse((o) => { if (o.isMesh && o.userData.orig) { swaps.push([o, o.material]); o.material = o.userData.orig; } });
    const hidden = [];
    model.root.traverse((o) => { if (o.userData.helper && o.visible) { hidden.push(o); o.visible = false; } });
    const parent = model.root.parent;
    thumbScene.add(model.root);
    const h = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3()).y;
    thumbCam.position.set(2.0, h * 0.6 + 1.5, 3.4);
    thumbCam.lookAt(0, h / 2, 0);
    thumbR.render(thumbScene, thumbCam);
    const url = thumbR.domElement.toDataURL('image/png');
    thumbScene.remove(model.root);
    if (parent) parent.add(model.root);
    swaps.forEach(([o, m]) => { o.material = m; });
    hidden.forEach((o) => { o.visible = true; });
    model.thumb = url;
    const thumb = document.querySelector(`#gallery-grid .tile[data-i="${i}"] .thumb`);
    if (thumb) {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      thumb.querySelector('svg') && thumb.querySelector('svg').remove();
      thumb.prepend(img);
    }
  } catch (err) {
    console.warn('Thumbnail failed', err);
  }
}
// After the first model is up, build the others quietly so their thumbnails appear.
async function backgroundThumbnails() {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].thumbnail || built.has(i)) continue;
    try { await buildEntry(i); makeThumbnail(i); } catch (err) { console.warn(err); }
  }
}

/* ================= Your own files: button + drag and drop ================= */
async function loadFiles(fileList) {
  const files = [...fileList];
  const modelFile = files.find((f) => /\.(glb|fbx)$/i.test(f.name));
  const textures = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name)).map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
  const unknown = textures.filter((t) => !classify(t.name)).map((t) => t.name);
  const token = ++loadToken;
  try {
    let model;
    if (modelFile) {
      setStatus(`Loading ${modelFile.name}…`);
      const ext = modelFile.name.split('.').pop().toLowerCase();
      const r = await buildModel(await modelFile.arrayBuffer(), ext, textures);
      model = { root: r.root, title: modelFile.name, subtitle: 'Your file (only on this device)', notes: r.notes };
    } else if (textures.length) {
      const set = await buildMapSet(textures, true);
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), pbrFrom(set, null)));
      normalise(root);
      model = { root, title: 'Material preview', subtitle: 'Your maps on a sphere', notes: set.notes };
    } else {
      toast('Drop a .glb or .fbx file, texture maps (.png / .jpg), or both.');
      return;
    }
    if (token !== loadToken) return;
    markActive(-1);
    display(model);
    const parts = [];
    if (model.notes.length) parts.push('Maps: ' + model.notes.join(' · '));
    if (unknown.length) parts.push(`Not recognised (rename to include basecolor, normal, roughness, metallic or emission): ${unknown.join(', ')}`);
    toast(parts.join('. ') || 'Loaded with the materials inside the file.');
  } catch (err) {
    console.error(err);
    setStatus('');
    toast('That file could not be loaded. Export it again as .glb (glTF Binary) or binary .fbx.');
  }
}
// (No upload button on the site. Drag files onto the viewer to preview them; they are never saved.)

// Drop overlay: only while files are dragged over the viewer, and never left stuck on screen.
const dz = $('dropzone');
let dzTimer;
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
function hideDrop() { clearTimeout(dzTimer); dz.hidden = true; }
stage.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dz.hidden = false;
  clearTimeout(dzTimer);
  dzTimer = setTimeout(hideDrop, 250);   // dragover fires continuously while over the stage
});
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  hideDrop();
  if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});
window.addEventListener('dragend', hideDrop);
window.addEventListener('drop', hideDrop);

/* ================= Start ================= */
async function start() {
  setStatus('Loading models…');
  try {
    const r = await fetch(MANIFEST, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${MANIFEST}: ${r.status}`);
    const data = await r.json();
    entries = (Array.isArray(data) ? data : data.models || []).filter((e) => e && e.file);
  } catch (err) {
    console.warn(err);
    entries = [];
  }
  renderGallery();
  if (!entries.length) {
    setStatus('No models listed yet. Add one to models/models.json, or use “Load model”.');
    return;
  }
  await openEntry(0, false);
  backgroundThumbnails();
}
start();
