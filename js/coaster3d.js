// Klassmålet – 3D-berg- och dalbana i toppen av startsidan (Three.js)
// Faller tillbaka på den platta SVG-versionen om WebGL saknas.
(function () {
  const host = document.querySelector(".hero-coaster");
  const svg = document.getElementById("coaster");
  if (!host || !window.THREE) return;

  // Finns WebGL?
  try {
    const t = document.createElement("canvas");
    if (!(t.getContext("webgl2") || t.getContext("webgl"))) return;
  } catch (e) { return; }

  const T = THREE;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Renderer & scen ----------
  const canvas = document.createElement("canvas");
  canvas.className = "coaster-3d";
  canvas.setAttribute("aria-hidden", "true");
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) { return; }
  if (svg) svg.remove();                 // 3D fungerar – ta bort SVG-versionen
  host.insertBefore(canvas, host.firstChild);
  host.classList.add("has-3d");

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene();
  scene.fog = new T.Fog(0x8d6cf6, 26, 62);
  const camera = new T.PerspectiveCamera(38, 2, 0.1, 200);

  scene.add(new T.HemisphereLight(0xffffff, 0x6d4ce8, 0.85));
  const sun = new T.DirectionalLight(0xffffff, 1.0);
  sun.position.set(6, 18, 14);
  scene.add(sun);
  const rim = new T.DirectionalLight(0xff9de2, 0.7);
  rim.position.set(-10, 6, -16);
  scene.add(rim);

  // ---------- Banans form ----------
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const pts = [
    V(-15, 1.2, -6), V(-12.5, 4.5, -8), V(-9.5, 8.5, -9.4), V(-7, 9.6, -9.6),   // liftbacken
    V(-4.5, 8.2, -8.6), V(-2.2, 3.5, -6), V(0, 0.9, -3), V(2.5, 0.7, -0.4)      // första stupet mot tittaren
  ];
  // Loopen
  const lc = V(6.2, 4.4, 0.6), R = 3.6;
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
    pts.push(V(lc.x + Math.cos(a) * R + i * 0.05, lc.y + Math.sin(a) * R, lc.z + i * 0.17));
  }
  pts.push(
    V(10.5, 1.0, 3.6), V(14, 1.8, 2), V(16, 3.2, -2.5), V(14.5, 4.6, -7.5),   // svängen bakåt
    V(10, 6.4, -10.5), V(5, 3.2, -12), V(0, 5.6, -13), V(-5, 2.4, -13),        // kamelryggar längst bak
    V(-10, 4.2, -12.5), V(-14, 1.6, -10.5), V(-16.5, 1.0, -8)
  );
  const curve = new T.CatmullRomCurve3(pts, true, "centripetal", 0.5);
  const L = curve.getLength();
  const N = 1600;

  // Positioner, tangenter och ramar (parallel transport, utan vridning vid skarven)
  const P = [], TG = [], NR = [], BN = [];
  for (let i = 0; i < N; i++) { P.push(curve.getPointAt(i / N)); TG.push(curve.getTangentAt(i / N).normalize()); }
  let n = V(0, 1, 0);
  n.sub(TG[0].clone().multiplyScalar(n.dot(TG[0]))).normalize();
  for (let i = 0; i < N; i++) {
    if (i > 0) {
      const axis = new T.Vector3().crossVectors(TG[i - 1], TG[i]);
      const s = axis.length();
      if (s > 1e-6) n.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, s)));
      n.sub(TG[i].clone().multiplyScalar(n.dot(TG[i]))).normalize();
    }
    NR.push(n.clone());
  }
  // Fördela restvridningen jämnt så att ramen möts vid skarven
  const end = NR[N - 1].clone(), start = NR[0];
  let twist = Math.acos(Math.max(-1, Math.min(1, end.dot(start))));
  if (new T.Vector3().crossVectors(end, start).dot(TG[0]) < 0) twist = -twist;
  for (let i = 0; i < N; i++) {
    NR[i].applyAxisAngle(TG[i], twist * i / N).normalize();
    BN.push(new T.Vector3().crossVectors(TG[i], NR[i]).normalize());
  }
  const inLoop = i => { const p = P[i]; return Math.abs(p.x - 6.4) < 4.6 && p.y > 1.4 && p.z > -1 && p.z < 4; };

  // ---------- Räls, ryggrad, slipers, stöttor ----------
  function offsetTube(off, up, radius, mat) {
    const arr = [];
    for (let i = 0; i < N; i += 2) arr.push(P[i].clone().add(BN[i].clone().multiplyScalar(off)).add(NR[i].clone().multiplyScalar(up)));
    const c = new T.CatmullRomCurve3(arr, true, "catmullrom", 0.5);
    scene.add(new T.Mesh(new T.TubeGeometry(c, 1400, radius, 8, true), mat));
  }
  const railMat = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.28 });
  const spineMat = new T.MeshStandardMaterial({ color: 0xfcd34d, metalness: 0.3, roughness: 0.45 });
  offsetTube(0.55, 0, 0.085, railMat);
  offsetTube(-0.55, 0, 0.085, railMat);
  offsetTube(0, -0.38, 0.17, spineMat);

  const tieGeo = new T.BoxGeometry(0.12, 0.08, 1.25);
  const tieMat = new T.MeshStandardMaterial({ color: 0xf5f3ff, metalness: 0.3, roughness: 0.5 });
  const ties = new T.InstancedMesh(tieGeo, tieMat, Math.ceil(N / 6));
  const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(1, 1, 1);
  const basis = new T.Matrix4();
  let k = 0;
  for (let i = 0; i < N; i += 6) {
    basis.makeBasis(TG[i], NR[i], BN[i]);
    q.setFromRotationMatrix(basis);
    m4.compose(P[i].clone().add(NR[i].clone().multiplyScalar(-0.16)), q, sc);
    ties.setMatrixAt(k++, m4);
  }
  ties.count = k;
  scene.add(ties);

  const GROUND = -2.2;
  const supGeo = new T.CylinderGeometry(0.07, 0.1, 1, 6);
  const supMat = new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.6 });
  const sups = new T.InstancedMesh(supGeo, supMat, 200);
  k = 0;
  for (let i = 0; i < N; i += 22) {
    if (inLoop(i) || NR[i].y < 0.6) continue;
    const top = P[i].clone().add(NR[i].clone().multiplyScalar(-0.45));
    const h = top.y - GROUND;
    if (h < 0.4) continue;
    m4.compose(V(top.x, GROUND + h / 2, top.z), new T.Quaternion(), V(1, h, 1));
    sups.setMatrixAt(k++, m4);
  }
  // Loopens bärande ben
  for (const x of [lc.x - 1.2, lc.x + 1.2]) {
    const h = lc.y + R * 0.2 - GROUND;
    m4.compose(V(x, GROUND + h / 2, lc.z + 1), new T.Quaternion(), V(1.6, h, 1.6));
    sups.setMatrixAt(k++, m4);
  }
  sups.count = k;
  scene.add(sups);

  // Mjuk "skugga"/glöd på marken
  const glow = new T.Mesh(new T.CircleGeometry(22, 48), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, GROUND, -5); glow.scale.set(1.2, 0.55, 1);
  scene.add(glow);

  // ---------- Tåget ----------
  const COLORS = [0xfcd34d, 0xf472b6, 0x67e8f9, 0xa3e635];
  const SKIN = [0xfde68a, 0xf5d0a9, 0xc08457, 0xfbcfe8, 0xe8b48a, 0x8d5a3b];
  function makeCar(color, first, seed) {
    const g = new T.Group();
    const bodyMat = new T.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.35 });
    const body = new T.Mesh(new T.BoxGeometry(1.3, 0.42, 1.05), bodyMat);
    body.position.y = 0.42; g.add(body);
    const seat = new T.Mesh(new T.BoxGeometry(0.16, 0.38, 0.95), new T.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.7 }));
    seat.position.set(-0.45, 0.78, 0); g.add(seat);
    if (first) {
      const nose = new T.Mesh(new T.CylinderGeometry(0.21, 0.21, 1.05, 16, 1, false, 0, Math.PI), bodyMat);
      nose.rotation.x = Math.PI / 2; nose.rotation.z = -Math.PI / 2; nose.position.set(0.65, 0.42, 0); g.add(nose);
    }
    const stripe = new T.Mesh(new T.BoxGeometry(1.32, 0.07, 1.07), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    stripe.position.y = 0.5; g.add(stripe);
    const wheelMat = new T.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.5 });
    for (const x of [-0.4, 0.4]) for (const z of [-0.55, 0.55]) {
      const w = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.1, 10), wheelMat);
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.12, z); g.add(w);
    }
    // Två passagerare med armarna i luften
    for (const z of [-0.25, 0.25]) {
      const skin = new T.MeshStandardMaterial({ color: SKIN[(seed + (z > 0 ? 1 : 0)) % SKIN.length], roughness: 0.6 });
      const head = new T.Mesh(new T.SphereGeometry(0.17, 14, 10), skin);
      head.position.set(-0.15, 0.95, z); g.add(head);
      const hair = new T.Mesh(new T.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), new T.MeshStandardMaterial({ color: [0x3b2414, 0xfacc15, 0x7c2d12, 0x111827][(seed + (z > 0 ? 2 : 0)) % 4] }));
      hair.position.copy(head.position); hair.rotation.z = 0.35; g.add(hair);
      for (const dz of [-0.12, 0.12]) {
        const arm = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.5, 6), skin);
        arm.position.set(-0.05, 1.22, z + dz * 1.3); arm.rotation.x = dz * 2.2; arm.rotation.z = 0.25; g.add(arm);
      }
    }
    scene.add(g);
    return g;
  }
  const cars = COLORS.map((c, i) => makeCar(c, i === 0, i * 2));
  const GAP = 1.5;  // meter mellan vagnarna

  // ---------- Fysik ----------
  let maxY = -Infinity, liftTopIdx = 0;
  for (let i = 0; i < N * 0.25; i++) if (P[i].y > maxY) { maxY = P[i].y; liftTopIdx = i; }
  const LIFT_END = liftTopIdx / N;
  const g = 9.0;
  function speedAt(u) {
    u = ((u % 1) + 1) % 1;
    const y = P[Math.floor(u * N) % N].y;
    if (u < LIFT_END - 0.002) return 4.2;                       // kedjan drar upp
    return Math.max(2.8, Math.sqrt(Math.max(0, 2 * g * (maxY + 0.35 - y))));
  }

  function placeCar(car, u) {
    u = ((u % 1) + 1) % 1;
    const f = u * N, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const p = P[i].clone().lerp(P[j], t);
    const tg = TG[i].clone().lerp(TG[j], t).normalize();
    const nr = NR[i].clone().lerp(NR[j], t).normalize();
    const bn = new T.Vector3().crossVectors(tg, nr).normalize();
    basis.makeBasis(tg, nr, bn);
    car.quaternion.setFromRotationMatrix(basis);
    car.position.copy(p).add(nr.multiplyScalar(0.05));
  }

  // ---------- Kamera & storlek ----------
  let mouseX = 0, mouseY = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Se till att hela banan (ca 36 m bred) får plats även på smala skärmar
    const halfW = camera.aspect < 1.4 ? 10 : 19;
    const dist = halfW / (Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    camera.userData.dist = Math.max(22, Math.min(dist + 6, 70));
    // Diset följer kameraavståndet så banan aldrig försvinner
    scene.fog.near = camera.userData.dist - 2; scene.fog.far = camera.userData.dist + 38;
    // Lägre bana i bilden när rubriken tar mer plats (smala skärmar)
    camera.userData.lookY = camera.aspect < 1.4 ? 9 : 10;
    camera.userData.lookX = camera.aspect < 1.4 ? 2 : 0;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener("pointermove", e => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  function placeCamera(time) {
    const d = camera.userData.dist || 30;
    const sway = Math.sin(time * 0.12) * 3;
    camera.position.set((camera.userData.lookX || 0) + sway + mouseX * 2.5, 11 - mouseY * 1.2 + d * 0.1, d - 6);
    camera.lookAt(camera.userData.lookX || 0, camera.userData.lookY || 8.5, -4.5);
  }

  // ---------- Loop ----------
  let u = 0.02, last = null, visible = true;
  if (window.IntersectionObserver) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(host);

  function frame(now) {
    if (last == null) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (visible && !document.hidden) {
      u += speedAt(u) * dt / L;
      cars.forEach((c, i) => placeCar(c, u - (i * GAP) / L));
      placeCamera(now / 1000);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }

  resize();
  if (reduce) {
    cars.forEach((c, i) => placeCar(c, LIFT_END - 0.01 - (i * GAP) / L));
    placeCamera(0);
    renderer.render(scene, camera);
    window.addEventListener("resize", () => { resize(); placeCamera(0); renderer.render(scene, camera); });
  } else {
    requestAnimationFrame(frame);
  }
})();
