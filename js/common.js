// Klassmålet – gemensamma hjälpfunktioner
(function () {
  const cfg = window.KM_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const DEFAULT_SETTINGS = {
    fixed_costs: [
      { label: "Frukost", amount: 200, food: true },
      { label: "Lunch", amount: 300, food: true },
      { label: "Middag", amount: 500, food: true },
      { label: "Fickpengar", amount: 400, food: false }
    ],
    default_transport: 10000,
    goal_destination_id: null
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Bara http(s)-länkar eller relativa sökvägar till vår egen sajt
  function safeUrl(u) {
    if (!u) return "";
    const s = String(u).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("/") && !s.startsWith("//")) return s;
    return "";
  }

  // Gör om YouTube/Vimeo-länkar till inbäddningsbara adresser
  function videoEmbed(u) {
    const s = safeUrl(u);
    if (!s) return "";
    let m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (m) {
      const t = s.match(/[?&](?:t|start)=(\d+)/);
      return "https://www.youtube-nocookie.com/embed/" + m[1] + (t ? "?start=" + t[1] : "");
    }
    m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return "https://player.vimeo.com/video/" + m[1];
    return "";
  }

  function kr(n) {
    return Math.round(Number(n) || 0).toLocaleString("sv-SE") + " kr";
  }

  function num(v) {
    const n = parseFloat(String(v).replace(",", "."));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function settingsOf(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    if (!Array.isArray(s.fixed_costs)) s.fixed_costs = DEFAULT_SETTINGS.fixed_costs.slice();
    return s;
  }

  // Räkna ut kostnad för ett resmål
  function calcDest(cls, settings, d) {
    const s = settingsOf(settings);
    const people = Math.max(1, (Number(cls.student_count) || 0) + (Number(cls.adult_count) || 0));
    const fixed = s.fixed_costs
      .filter(f => !(d.includes_food && f.food))
      .reduce((a, f) => a + num(f.amount), 0);
    const transport = d.cost_transport == null || d.cost_transport === "" ? num(s.default_transport) : num(d.cost_transport);
    const perPerson = num(d.cost_entrance) + num(d.cost_extra) + num(d.cost_accommodation) + fixed + transport / people;
    return { people, fixed, transport, perPerson, total: perPerson * people };
  }

  function fundBar(raised, total) {
    if (!(total > 0)) return "";
    const pct = Math.min(100, Math.round(raised / total * 100));
    const remaining = Math.max(0, total - raised);
    const cls = pct >= 100 ? "funded" : pct >= 70 ? "almost" : "far";
    const icon = pct >= 100 ? "✅" : pct >= 70 ? "🟡" : "🎯";
    return `<div class="fund-track"><div class="fund-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="fund-label"><span>${icon} ${pct}% insamlat</span>${remaining > 0
        ? `<span class="need">Kvar: ${kr(remaining)}</span>`
        : `<span class="covered">Klassen har råd! 🎉</span>`}</div>`;
  }

  function toast(msg, isErr) {
    document.querySelectorAll(".toast").forEach(x => x.remove());
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 4500 : 2500);
  }

  function emojiFor(name) {
    const n = (name || "").toLowerCase();
    const map = [["vatten", "💦"], ["bad", "🌊"], ["djur", "🦁"], ["zoo", "🦊"], ["liseberg", "🎡"], ["tivoli", "🎠"], ["lund", "🎠"],
      ["boda", "🧩"], ["chaparral", "🤠"], ["challenge", "🏆"], ["bowling", "🎳"], ["museum", "🏛️"], ["strand", "🏖️"], ["hav", "⛵"],
      ["fjäll", "🏔️"], ["skid", "⛷️"], ["stockholm", "👑"], ["göteborg", "🎡"], ["trampolin", "🤸"], ["laser", "🔫"], ["go", "🏎️"]];
    for (const [k, e] of map) if (n.includes(k)) return e;
    return "🎢";
  }

  function codeFromUrl() {
    const q = new URLSearchParams(location.search).get("kod");
    if (q) return q.trim().toUpperCase();
    const m = location.pathname.match(/\/k\/([A-Za-z0-9]{4,10})\/?$/);
    return m ? m[1].toUpperCase() : "";
  }

  function classLink(code) {
    return location.origin + "/k/" + encodeURIComponent(code);
  }

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  window.KM = { sb, cfg, DEFAULT_SETTINGS, esc, safeUrl, videoEmbed, kr, num, settingsOf, calcDest, fundBar, toast, emojiFor, codeFromUrl, classLink, storageGet, storageSet };
})();
