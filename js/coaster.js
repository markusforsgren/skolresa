// Klassmålet – animerad berg- och dalbana i toppen av sidan
(function () {
  const svg = document.getElementById("coaster");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg";
  const track = svg.querySelector("#coaster-track");
  const L = track.getTotalLength();

  // Stöttor: lodräta linjer från banan ner till marken
  const supports = svg.querySelector("#coaster-supports");
  for (let s = 20; s < L; s += 26) {
    const p = track.getPointAtLength(s);
    if (p.x < -10 || p.x > 1210) continue;
    // inga stöttor genom själva loopen
    if (p.x > 605 && p.x < 715 && p.y < 185) continue;
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", p.x); ln.setAttribute("y1", p.y + 4);
    ln.setAttribute("x2", p.x); ln.setAttribute("y2", 260);
    supports.appendChild(ln);
  }
  // Loopens mittstötta
  const mid = document.createElementNS(NS, "line");
  mid.setAttribute("x1", 662); mid.setAttribute("y1", 130); mid.setAttribute("x2", 662); mid.setAttribute("y2", 260);
  supports.appendChild(mid);

  const cars = [...svg.querySelectorAll(".coaster-car")];
  const GAP = 40;  // avstånd mellan vagnarna längs banan

  function place(car, s) {
    const c = Math.max(0, Math.min(L, s));
    const p = track.getPointAtLength(c);
    const q = track.getPointAtLength(Math.min(L, c + 2));
    const r = track.getPointAtLength(Math.max(0, c - 2));
    const a = Math.atan2(q.y - r.y, q.x - r.x) * 180 / Math.PI;
    car.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${a.toFixed(1)})`);
  }

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    // Stillastående tåg på första toppen
    const top = 300;
    cars.forEach((car, i) => place(car, top + 150 - i * GAP));
    return;
  }

  let s = 0, last = null;
  function frame(t) {
    if (last == null) last = t;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const y = track.getPointAtLength(Math.min(L, Math.max(0, s))).y;
    // Lägre punkt (större y) = högre fart, som en riktig berg- och dalbana
    const v = 55 + 10 * Math.sqrt(Math.max(0, y - 45));
    s += v * dt;
    if (s - GAP * (cars.length - 1) > L) s = 0;
    cars.forEach((car, i) => place(car, s - i * GAP));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
