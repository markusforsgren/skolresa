// Klassmålet – adminpanel
(function () {
  const { sb, cfg, esc, safeUrl, kr, num, settingsOf, calcDest, fundBar, toast, emojiFor, classLink } = KM;
  const $ = id => document.getElementById(id);
  const TPL = window.KM_TEMPLATES;

  const S = {
    user: null,
    classes: [],
    cls: null, dests: [], votes: [], sales: [],
    tab: "dela",
    dirty: false,
    lastHash: "",
    recovery: false
  };

  // =====================================================================
  // Vyer & routing
  // =====================================================================
  function show(view) {
    ["loading", "view-auth", "view-reset", "view-dashboard", "view-class"].forEach(v => $(v).classList.toggle("hidden", v !== view));
  }
  function hero(title, sub, back) {
    $("hero-title").textContent = title;
    $("hero-sub").textContent = sub || "";
    $("hero-back").classList.toggle("hidden", !back);
  }
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    if (h.includes("access_token") || h.includes("error_description")) return { name: "home" };
    const p = h.split("/").filter(Boolean);
    if (p[0] === "klass" && p[1]) return { name: "class", id: p[1], tab: p[2] || "dela" };
    if (p[0] === "registrera") return { name: "signup" };
    return { name: "home" };
  }

  async function route() {
    if (S.recovery) { show("view-reset"); hero("Nytt lösenord", ""); return; }
    const r = parseRoute();
    if (!S.user) {
      setAuthMode(r.name === "signup" ? "signup" : "login");
      hero("Adminpanel", "För lärare och föräldrar som ordnar klassresan");
      show("view-auth");
      return;
    }
    if (S.dirty && location.hash !== S.lastHash) {
      if (!confirm("Du har ändringar som inte är sparade. Vill du lämna ändå?")) {
        history.replaceState(null, "", S.lastHash || "#/");
        return;
      }
    }
    S.dirty = false;
    S.lastHash = location.hash;
    if (r.name === "class") await openClass(r.id, r.tab);
    else await showDashboard();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  // =====================================================================
  // Auth
  // =====================================================================
  let authMode = "login";
  function setAuthMode(m) {
    authMode = m;
    document.querySelectorAll("[data-auth]").forEach(b => b.classList.toggle("active", b.dataset.auth === m));
    $("auth-submit").textContent = m === "login" ? "Logga in" : "Skapa konto";
    $("auth-signup-note").classList.toggle("hidden", m !== "signup");
    $("auth-pw").autocomplete = m === "login" ? "current-password" : "new-password";
    $("auth-status").textContent = "";
  }
  document.querySelectorAll("[data-auth]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));

  function authErr(e) {
    const m = (e && e.message || "").toLowerCase();
    if (m.includes("invalid login")) return "Fel e-post eller lösenord.";
    if (m.includes("email not confirmed")) return "Du behöver bekräfta din e-post först – kolla inkorgen (och skräpposten).";
    if (m.includes("already registered") || m.includes("already been registered")) return "Det finns redan ett konto med den e-posten. Logga in i stället.";
    if (m.includes("password")) return "Lösenordet måste vara minst 8 tecken.";
    if (m.includes("rate limit")) return "För många försök. Vänta en stund och försök igen.";
    return "Något gick fel: " + (e && e.message || "okänt fel");
  }

  $("auth-form").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("auth-email").value.trim(), pw = $("auth-pw").value;
    const st = $("auth-status");
    if (pw.length < 8) { st.className = "status err"; st.textContent = "Lösenordet måste vara minst 8 tecken."; return; }
    st.className = "status"; st.textContent = authMode === "login" ? "Loggar in…" : "Skapar konto…";
    $("auth-submit").disabled = true;
    try {
      if (authMode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + "/admin.html" } });
        if (error) throw error;
        if (!data.session) {
          st.className = "status ok";
          st.textContent = "Konto skapat! Vi har skickat ett mejl till " + email + " – klicka på länken i mejlet för att aktivera kontot.";
          return;
        }
      }
    } catch (err) {
      st.className = "status err"; st.textContent = authErr(err);
    } finally { $("auth-submit").disabled = false; }
  });

  $("forgot-link").addEventListener("click", async e => {
    e.preventDefault();
    const email = $("auth-email").value.trim();
    const st = $("auth-status");
    if (!email) { st.className = "status err"; st.textContent = "Skriv in din e-post ovan först."; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/admin.html" });
    st.className = error ? "status err" : "status ok";
    st.textContent = error ? authErr(error) : "Om kontot finns har vi skickat en länk för att välja nytt lösenord.";
  });

  $("reset-form").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("reset-status");
    const { error } = await sb.auth.updateUser({ password: $("reset-pw").value });
    if (error) { st.className = "status err"; st.textContent = authErr(error); return; }
    S.recovery = false;
    toast("Lösenordet är uppdaterat ✓");
    location.hash = "#/";
    route();
  });

  $("logout-btn").addEventListener("click", async () => {
    if (S.dirty && !confirm("Du har osparade ändringar. Logga ut ändå?")) return;
    S.dirty = false;
    await sb.auth.signOut();
    location.hash = "#/";
  });

  function setUser(u) {
    const changed = (S.user && S.user.id) !== (u && u.id);
    S.user = u;
    $("user-box").classList.toggle("hidden", !u);
    $("user-email").textContent = u ? u.email : "";
    if (changed) { S.classes = []; S.cls = null; }
    return changed;
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") S.recovery = true;
    const changed = setUser(session ? session.user : null);
    // Anropa inte Supabase direkt i callbacken (kan låsa sig) – kör efter en tick
    if (event === "PASSWORD_RECOVERY" || event === "SIGNED_OUT" || (event === "SIGNED_IN" && changed)) setTimeout(route, 0);
  });

  // =====================================================================
  // Dashboard
  // =====================================================================
  async function loadClasses() {
    const { data, error } = await sb.from("km_classes").select("*, km_votes(count), km_destinations(count)").order("created_at", { ascending: false });
    if (error) throw error;
    S.classes = data;
  }

  async function showDashboard() {
    hero("Mina klasser", "Välj en klass eller skapa en ny");
    show("loading");
    try { await loadClasses(); } catch (e) { toast("Kunde inte hämta klasser: " + e.message, true); }
    show("view-dashboard");
    const g = $("class-grid");
    g.innerHTML = S.classes.map(c => {
      const votes = c.km_votes && c.km_votes[0] ? c.km_votes[0].count : 0;
      const dests = c.km_destinations && c.km_destinations[0] ? c.km_destinations[0].count : 0;
      return `<button class="class-card" data-id="${esc(c.id)}">
        <div class="code">${esc(c.code)}</div>
        <h3>${esc(c.name)}</h3>
        <div class="small muted">${esc(c.school || "")}</div>
        <div class="small" style="margin-top:.6rem;font-weight:700">🗳️ ${votes} av ${c.student_count} har röstat · 🗺️ ${dests} resmål</div>
        <div class="small" style="margin-top:.2rem;color:${c.voting_open ? "var(--green-dark)" : "var(--red)"};font-weight:700">${c.voting_open ? "● Röstningen är öppen" : "● Röstningen är stängd"}</div>
      </button>`;
    }).join("") + `<button class="class-card new" id="new-class-btn">➕ Skapa ny klass</button>`;
    g.querySelectorAll(".class-card[data-id]").forEach(b => b.addEventListener("click", () => { location.hash = "#/klass/" + b.dataset.id + "/dela"; }));
    $("new-class-btn").addEventListener("click", () => openModal("m-new"));
    if (!S.classes.length) openModal("m-new");
  }

  // ---------- Modaler ----------
  function openModal(id) { $(id).classList.add("open"); const f = $(id).querySelector("input:not([type=hidden]):not([type=file])"); if (f) setTimeout(() => f.focus(), 50); }
  function closeModal(id) { $(id).classList.remove("open"); }
  document.querySelectorAll(".modal-overlay").forEach(o => {
    o.addEventListener("click", e => { if (e.target === o) closeModal(o.id); });
    o.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(o.id)));
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal-overlay.open").forEach(o => closeModal(o.id)); });

  $("new-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, st = $("new-status");
    const row = {
      name: f.name.value.trim(), school: f.school.value.trim() || null, trip_title: f.trip_title.value.trim() || null,
      student_count: parseInt(f.student_count.value) || 25, adult_count: parseInt(f.adult_count.value) || 0,
      settings: KM.DEFAULT_SETTINGS
    };
    st.className = "status"; st.textContent = "Skapar…";
    const { data, error } = await sb.from("km_classes").insert(row).select().single();
    if (error) { st.className = "status err"; st.textContent = "Kunde inte skapa: " + error.message; return; }
    st.textContent = "";
    f.reset();
    closeModal("m-new");
    location.hash = "#/klass/" + data.id + "/resmal";
  });

  // =====================================================================
  // En klass
  // =====================================================================
  async function loadClass(id) {
    const [c, d, v, s] = await Promise.all([
      sb.from("km_classes").select("*").eq("id", id).maybeSingle(),
      sb.from("km_destinations").select("*").eq("class_id", id).order("sort_order").order("created_at"),
      sb.from("km_votes").select("*").eq("class_id", id).order("created_at", { ascending: false }),
      sb.from("km_sales").select("*").eq("class_id", id).order("sort_order").order("created_at")
    ]);
    for (const r of [c, d, v, s]) if (r.error) throw r.error;
    if (!c.data) return false;
    S.cls = c.data; S.dests = d.data; S.votes = v.data; S.sales = s.data;
    return true;
  }

  async function openClass(id, tab) {
    const same = S.cls && S.cls.id === id;
    if (!same) {
      show("loading");
      try {
        if (!(await loadClass(id))) { toast("Klassen hittades inte.", true); location.hash = "#/"; return; }
      } catch (e) { toast("Kunde inte ladda klassen: " + e.message, true); location.hash = "#/"; return; }
    }
    S.tab = tab;
    hero(S.cls.name, [S.cls.school, "Kod: " + S.cls.code].filter(Boolean).join(" · "), true);
    show("view-class");
    document.querySelectorAll("#class-tabs .subtab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    const act = document.querySelector("#class-tabs .subtab.active");
    if (act) act.scrollIntoView({ block: "nearest", inline: "center" });
    renderTab();
  }
  document.querySelectorAll("#class-tabs .subtab").forEach(b => b.addEventListener("click", () => { location.hash = "#/klass/" + S.cls.id + "/" + b.dataset.tab; }));

  async function reloadClass() { await loadClass(S.cls.id); renderTab(); }

  function renderTab() {
    const fn = { dela: tabShare, resmal: tabDests, resultat: tabResults, kostnader: tabCosts, insamling: tabSales, installningar: tabSettings }[S.tab] || tabShare;
    fn($("class-content"));
  }

  function markDirty() { S.dirty = true; const d = $("dirty-ind"); if (d) d.classList.remove("hidden"); }

  async function updateClass(patch) {
    const { data, error } = await sb.from("km_classes").update(patch).eq("id", S.cls.id).select().single();
    if (error) throw error;
    S.cls = data;
    return data;
  }

  function voteSummary() {
    const map = new Map();
    S.votes.forEach(v => {
      const d = v.destination_id && S.dests.find(x => x.id === v.destination_id);
      const label = d ? d.name : (v.custom_text || "(borttaget resmål)");
      const key = d ? d.id : "c:" + label.toLowerCase();
      const cur = map.get(key) || { label, count: 0, custom: !d };
      cur.count++; map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  // ---------------------------------------------------------------------
  // Flik: Dela
  // ---------------------------------------------------------------------
  function displayLink(code) {
    const host = location.hostname.startsWith("xn--") && cfg.DISPLAY_HOST ? cfg.DISPLAY_HOST : location.host;
    return "https://" + host + "/k/" + code;
  }

  function qrCanvas(text, size) {
    const qr = qrcode(0, "M");
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), margin = 2, cell = Math.max(2, Math.floor(size / (n + margin * 2)));
    const px = cell * (n + margin * 2);
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); g.fillStyle = "#1E1B4B";
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect((col + margin) * cell, (r + margin) * cell, cell, cell);
    return c;
  }

  function tabShare(el) {
    const c = S.cls, link = classLink(c.code), shown = displayLink(c.code);
    const total = S.votes.length, lead = voteSummary()[0];
    el.innerHTML = `
      <div class="card">
        <div class="stats">
          <div class="stat"><div class="n">${total} / ${c.student_count}</div><div class="l">har röstat</div></div>
          <div class="stat"><div class="n">${S.dests.length}</div><div class="l">resmål</div></div>
          <div class="stat"><div class="n" style="font-size:1.15rem;line-height:1.6">${lead ? esc(lead.label) : "–"}</div><div class="l">leder just nu</div></div>
          <div class="stat"><div class="n" style="font-size:1.15rem;line-height:1.6;color:${c.voting_open ? "var(--green-dark)" : "var(--red)"}">${c.voting_open ? "Öppen" : "Stängd"}</div><div class="l">röstning</div></div>
        </div>
        <div class="row" style="margin-top:1rem">
          <button class="btn ${c.voting_open ? "danger" : ""}" id="toggle-open">${c.voting_open ? "🔒 Stäng röstningen" : "🔓 Öppna röstningen"}</button>
          <a class="btn light" href="${esc(link)}" target="_blank" rel="noopener">👀 Visa elevsidan</a>
        </div>
      </div>
      ${S.dests.length === 0 ? `<div class="card" style="border:2px solid var(--orange)"><strong>Tips:</strong> Lägg till resmål innan du delar länken. <a href="#/klass/${esc(c.id)}/resmal">Gå till Resmål →</a></div>` : ""}
      <div class="card">
        <h2 class="section-label">📣 Dela med klassen</h2>
        <div class="grid2" style="align-items:center">
          <div>
            <div class="small muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Klasskod</div>
            <div class="code-big" id="share-code">${esc(c.code)}</div>
            <p class="small muted" style="margin:.4rem 0 1rem">Eleverna går in på <strong>${esc(displayLink("").replace(/\/k\/$/, "").replace(/^https:\/\//, ""))}</strong> och skriver koden – eller skannar QR-koden.</p>
            <div class="link-box"><input class="input" readonly value="${esc(shown)}" id="share-link"><button class="btn" id="copy-link">Kopiera</button></div>
            <div class="row" style="margin-top:.75rem">
              <button class="btn light sm" id="share-native">📤 Dela…</button>
              <button class="btn light sm" id="dl-qr">⬇️ Ladda ner QR</button>
              <button class="btn light sm" id="print-poster">🖨️ Skriv ut affisch</button>
            </div>
          </div>
          <div class="center"><div class="qr-box" id="qr-box"></div></div>
        </div>
      </div>
      <div class="card">
        <h3 class="section-label" style="font-size:1.1rem">✉️ Färdigt meddelande till föräldrar</h3>
        <textarea class="input" id="parent-msg" style="min-height:150px">Hej!

Nu får ${c.name} vara med och bestämma vart klassresan ska gå. Barnen röstar själva på sitt favoritresmål här:
${shown}
(klasskod: ${c.code})

Varje elev röstar en gång med sitt namn. Ni får gärna titta på alternativen tillsammans hemma!

Hälsningar</textarea>
        <button class="btn light sm" id="copy-msg" style="margin-top:8px">Kopiera meddelandet</button>
      </div>`;

    const canvas = qrCanvas(link, 480);
    canvas.setAttribute("aria-label", "QR-kod till " + shown);
    $("qr-box").appendChild(canvas);

    const copy = async (text, msg) => {
      try { await navigator.clipboard.writeText(text); toast(msg); }
      catch (e) { toast("Kunde inte kopiera – markera och kopiera manuellt.", true); }
    };
    $("copy-link").onclick = () => copy(shown, "Länken är kopierad ✓");
    $("copy-msg").onclick = () => copy($("parent-msg").value, "Meddelandet är kopierat ✓");
    $("share-native").onclick = async () => {
      if (navigator.share) { try { await navigator.share({ title: "Rösta på klassresan", text: "Rösta på klassresan! Kod: " + c.code, url: shown }); } catch (e) { } }
      else copy(shown, "Länken är kopierad ✓");
    };
    $("dl-qr").onclick = () => {
      const a = document.createElement("a");
      a.href = qrCanvas(link, 1000).toDataURL("image/png");
      a.download = "klassmalet-" + c.code + ".png";
      a.click();
    };
    $("print-poster").onclick = () => printPoster(link, shown);
    $("toggle-open").onclick = async () => {
      try { await updateClass({ voting_open: !c.voting_open }); toast(S.cls.voting_open ? "Röstningen är öppen" : "Röstningen är stängd"); renderTab(); }
      catch (e) { toast("Kunde inte spara: " + e.message, true); }
    };
  }

  function printPoster(link, shown) {
    const c = S.cls;
    const img = qrCanvas(link, 1000).toDataURL("image/png");
    const w = window.open("", "_blank");
    if (!w) { toast("Tillåt popup-fönster för att skriva ut.", true); return; }
    w.document.write(`<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>Rösta – ${esc(c.name)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@600;800&display=swap" rel="stylesheet">
      <style>body{font-family:Nunito,sans-serif;text-align:center;color:#1E1B4B;padding:40px}h1{font-family:'Fredoka One';font-size:52px;margin:10px 0;color:#6C4FF6}
      .code{font-family:'Fredoka One';font-size:64px;letter-spacing:.15em}img{width:340px;height:340px;image-rendering:pixelated}p{font-size:22px}</style></head>
      <body><p style="font-size:44px;margin:0">🎢 🦁 💦 🎡</p><h1>Vart ska vi åka?</h1><p><strong>${esc(c.name)}</strong>${c.school ? " · " + esc(c.school) : ""}</p>
      <img src="${img}" alt="QR"><p>Skanna QR-koden eller gå in på</p><p style="font-size:28px;font-weight:800">${esc(shown.replace(/^https:\/\//, "").replace(/\/k\/.*/, ""))}</p>
      <p>och skriv koden</p><div class="code">${esc(c.code)}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
    w.document.close();
  }

  // ---------------------------------------------------------------------
  // Flik: Resmål
  // ---------------------------------------------------------------------
  function tabDests(el) {
    const list = S.dests;
    el.innerHTML = `
      <div class="card">
        <div class="spread" style="margin-bottom:.5rem">
          <h2 class="section-label" style="margin:0">🗺️ Resmål (${list.length})</h2>
          <div class="row">
            <button class="btn light" id="open-tpl">✨ Välj från förslag</button>
            <button class="btn" id="add-dest">➕ Eget resmål</button>
          </div>
        </div>
        <p class="small muted" style="margin-bottom:.75rem">Det här är alternativen eleverna kan rösta på. Ordningen här är ordningen eleverna ser.</p>
        <div id="dest-list">${list.length ? list.map((d, i) => `
          <div class="list-row">
            ${safeUrl(d.image_url) ? `<img class="thumb" src="${esc(safeUrl(d.image_url))}" alt="">` : `<div class="thumb">${emojiFor(d.name)}</div>`}
            <div class="grow"><div class="ellipsis" style="font-weight:800">${esc(d.name)}</div><div class="small muted ellipsis">${esc(d.subtitle || d.location || "")}</div></div>
            <button class="icon-btn" data-up="${i}" title="Flytta upp" ${i === 0 ? "disabled style='opacity:.25'" : ""}>⬆️</button>
            <button class="icon-btn" data-down="${i}" title="Flytta ner" ${i === list.length - 1 ? "disabled style='opacity:.25'" : ""}>⬇️</button>
            <button class="btn light sm" data-edit="${esc(d.id)}">Ändra</button>
            <button class="icon-btn" data-del="${esc(d.id)}" title="Ta bort">🗑️</button>
          </div>`).join("") : `<div class="empty-state">Inga resmål ännu.<br><br><button class="btn" id="open-tpl2">✨ Börja med våra förslag</button></div>`}
        </div>
      </div>`;
    $("open-tpl").onclick = openTemplates;
    if ($("open-tpl2")) $("open-tpl2").onclick = openTemplates;
    $("add-dest").onclick = () => openDestEditor(null);
    el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openDestEditor(S.dests.find(d => d.id === b.dataset.edit)));
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const d = S.dests.find(x => x.id === b.dataset.del);
      const n = S.votes.filter(v => v.destination_id === d.id).length;
      if (!confirm(`Ta bort "${d.name}"?` + (n ? `\n\n${n} elev(er) har röstat på det här resmålet. Deras röster finns kvar men blir ogiltiga.` : ""))) return;
      const { error } = await sb.from("km_destinations").delete().eq("id", d.id);
      if (error) return toast("Kunde inte ta bort: " + error.message, true);
      toast("Borttaget"); reloadClass();
    });
    const move = async (i, j) => {
      const a = S.dests[i], b = S.dests[j];
      const order = S.dests.slice(); order[i] = b; order[j] = a;
      const res = await Promise.all(order.map((d, k) => d.sort_order === k ? { error: null } : sb.from("km_destinations").update({ sort_order: k }).eq("id", d.id)));
      const err = res.find(r => r.error);
      if (err) toast("Kunde inte flytta: " + err.error.message, true);
      reloadClass();
    };
    el.querySelectorAll("[data-up]").forEach(b => b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1));
    el.querySelectorAll("[data-down]").forEach(b => b.onclick = () => move(+b.dataset.down, +b.dataset.down + 1));
    if (!list.length && !S._tplShown) { S._tplShown = true; openTemplates(); }
  }

  // ---------- Resmålseditor ----------
  let editing = null;
  function setPreview(url) {
    const p = $("dest-img-preview"), u = safeUrl(url);
    p.innerHTML = u ? `<img src="${esc(u)}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:12px">` : "🖼️";
  }
  function openDestEditor(d) {
    editing = d;
    const f = $("dest-form");
    f.reset();
    $("dest-form-title").textContent = d ? "Ändra resmål" : "Nytt resmål";
    $("dest-status").textContent = "";
    const v = d || { overnight: true };
    ["name", "location", "subtitle", "description", "image_url", "video_url", "website_url"].forEach(k => f[k].value = v[k] || "");
    f.tags.value = (v.tags || []).join(", ");
    f.overnight.checked = !!v.overnight;
    ["cost_entrance", "cost_extra", "cost_accommodation"].forEach(k => f[k].value = v[k] ? Number(v[k]) : "");
    f.cost_transport.value = v.cost_transport == null ? "" : Number(v.cost_transport);
    f.includes_food.checked = !!v.includes_food;
    setPreview(v.image_url);
    openModal("m-dest");
  }
  $("dest-form").image_url.addEventListener("input", e => setPreview(e.target.value));
  $("dest-img-clear").onclick = () => { $("dest-form").image_url.value = ""; setPreview(""); };

  async function resizeImage(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, "image/jpeg", 0.82));
    } finally { URL.revokeObjectURL(url); }
  }

  $("dest-img-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const st = $("dest-status");
    if (!file.type.startsWith("image/")) { st.className = "status err"; st.textContent = "Välj en bildfil."; return; }
    st.className = "status"; st.textContent = "Laddar upp bild…";
    try {
      const blob = await resizeImage(file, 1200);
      const path = `${S.user.id}/${S.cls.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from(cfg.IMAGE_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      const { data } = sb.storage.from(cfg.IMAGE_BUCKET).getPublicUrl(path);
      $("dest-form").image_url.value = data.publicUrl;
      setPreview(data.publicUrl);
      st.className = "status ok"; st.textContent = "Bilden är uppladdad ✓";
    } catch (err) {
      st.className = "status err"; st.textContent = "Kunde inte ladda upp bilden: " + (err.message || err);
    }
  });

  $("dest-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, st = $("dest-status");
    const urlFields = ["image_url", "video_url", "website_url"];
    for (const k of urlFields) {
      const v = f[k].value.trim();
      if (v && !safeUrl(v)) { st.className = "status err"; st.textContent = "Länkar måste börja med https://"; f[k].focus(); return; }
    }
    if (f.video_url.value.trim() && !KM.videoEmbed(f.video_url.value)) {
      st.className = "status err"; st.textContent = "Videon måste vara en YouTube- eller Vimeo-länk."; f.video_url.focus(); return;
    }
    const row = {
      name: f.name.value.trim(), location: f.location.value.trim() || null, subtitle: f.subtitle.value.trim() || null,
      description: f.description.value.trim() || null, image_url: f.image_url.value.trim() || null,
      video_url: f.video_url.value.trim() || null, website_url: f.website_url.value.trim() || null,
      tags: f.tags.value.split(",").map(t => t.trim()).filter(Boolean).slice(0, 8),
      overnight: f.overnight.checked,
      cost_entrance: num(f.cost_entrance.value), cost_extra: num(f.cost_extra.value), cost_accommodation: num(f.cost_accommodation.value),
      cost_transport: f.cost_transport.value === "" ? null : num(f.cost_transport.value),
      includes_food: f.includes_food.checked
    };
    st.className = "status"; st.textContent = "Sparar…";
    let error;
    if (editing) ({ error } = await sb.from("km_destinations").update(row).eq("id", editing.id));
    else ({ error } = await sb.from("km_destinations").insert(Object.assign(row, { class_id: S.cls.id, sort_order: nextOrder() })));
    if (error) { st.className = "status err"; st.textContent = "Kunde inte spara: " + error.message; return; }
    closeModal("m-dest");
    toast("Sparat ✓");
    reloadClass();
  });

  function nextOrder() { return S.dests.reduce((m, d) => Math.max(m, d.sort_order), -1) + 1; }

  // ---------- Förslag ----------
  const tplOn = new Set();
  function openTemplates() {
    tplOn.clear();
    const existing = new Set(S.dests.map(d => d.name.toLowerCase()));
    $("tpl-grid").innerHTML = TPL.destinations.map(t => {
      const ex = existing.has(t.name.toLowerCase());
      return `<button type="button" class="tpl${ex ? " exists" : ""}" data-key="${t.key}" ${ex ? "disabled" : ""}>
        <img src="${esc(t.image_url)}" alt="" loading="lazy"><div class="p">${esc(t.name)}<small>${ex ? "Redan tillagd" : esc(t.location)}</small></div></button>`;
    }).join("");
    $("tpl-grid").querySelectorAll(".tpl:not(.exists)").forEach(b => b.onclick = () => {
      const k = b.dataset.key;
      if (tplOn.has(k)) tplOn.delete(k); else tplOn.add(k);
      b.classList.toggle("on", tplOn.has(k));
      $("tpl-add").disabled = !tplOn.size;
      $("tpl-add").textContent = tplOn.size ? `Lägg till ${tplOn.size} resmål` : "Lägg till";
    });
    $("tpl-add").disabled = true; $("tpl-add").textContent = "Lägg till"; $("tpl-status").textContent = "";
    openModal("m-tpl");
  }
  $("tpl-add").onclick = async () => {
    let order = nextOrder();
    const rows = TPL.destinations.filter(t => tplOn.has(t.key)).map(t => ({
      class_id: S.cls.id, name: t.name, location: t.location, subtitle: t.subtitle, description: t.description,
      image_url: t.image_url, video_url: t.video_url || null, website_url: t.website_url, tags: t.tags, overnight: true,
      cost_entrance: t.cost_entrance || 0, cost_extra: t.cost_extra || 0, cost_accommodation: t.cost_accommodation || 0,
      includes_food: !!t.includes_food, sort_order: order++
    }));
    $("tpl-add").disabled = true;
    $("tpl-status").className = "status"; $("tpl-status").textContent = "Lägger till…";
    const { error } = await sb.from("km_destinations").insert(rows);
    if (error) { $("tpl-status").className = "status err"; $("tpl-status").textContent = "Fel: " + error.message; $("tpl-add").disabled = false; return; }
    closeModal("m-tpl");
    toast(rows.length + " resmål tillagda ✓");
    reloadClass();
  };

  // ---------------------------------------------------------------------
  // Flik: Resultat
  // ---------------------------------------------------------------------
  function tabResults(el) {
    const c = S.cls, sum = voteSummary(), total = S.votes.length;
    const fmt = d => new Date(d).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `
      <div class="card">
        <div class="spread" style="margin-bottom:1rem">
          <h2 class="section-label" style="margin:0">📊 Röstresultat</h2>
          <div class="row"><span class="small muted">${total} av ${c.student_count} har röstat</span>
          <button class="btn light sm" id="refresh-votes">↻ Uppdatera</button></div>
        </div>
        ${total ? sum.map(r => {
          const pct = Math.round(r.count / total * 100);
          return `<div class="result-row"><div class="result-meta"><span class="result-name">${r.custom ? "✏️ " : ""}${esc(r.label)}</span>
            <span class="result-pct">${r.count} röst${r.count !== 1 ? "er" : ""} · ${pct}%</span></div>
            <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
        }).join("") : '<div class="empty-state">Inga röster ännu.</div>'}
        <label class="check" style="margin-top:1rem"><input type="checkbox" id="pub-results" ${c.show_results ? "checked" : ""}> Visa resultatet för eleverna<small>Annars ser bara du resultatet</small></label>
      </div>
      <div class="card">
        <div class="spread" style="margin-bottom:.5rem">
          <h3 class="section-label" style="margin:0;font-size:1.15rem">🧑‍🎓 Vem har röstat</h3>
          ${total ? '<button class="btn danger sm" id="reset-votes">Nollställ alla röster</button>' : ""}
        </div>
        <p class="small muted" style="margin-bottom:.5rem">Om någon röstat fel kan du ta bort rösten så kan eleven rösta igen.</p>
        ${S.votes.map(v => {
          const d = v.destination_id && S.dests.find(x => x.id === v.destination_id);
          return `<div class="list-row"><div class="grow"><strong>${esc(v.voter_name)}</strong>
            <div class="small muted">${d ? esc(d.name) : "✏️ " + esc(v.custom_text || "(borttaget resmål)")} · ${fmt(v.created_at)}</div></div>
            <button class="icon-btn" data-delvote="${esc(v.id)}" title="Ta bort röst">🗑️</button></div>`;
        }).join("") || '<div class="empty-state">–</div>'}
      </div>`;
    $("refresh-votes").onclick = async () => { await reloadClass(); toast("Uppdaterat"); };
    $("pub-results").onchange = async e => {
      try { await updateClass({ show_results: e.target.checked }); toast(e.target.checked ? "Eleverna ser nu resultatet" : "Resultatet är dolt för eleverna"); }
      catch (err) { toast("Kunde inte spara: " + err.message, true); e.target.checked = !e.target.checked; }
    };
    el.querySelectorAll("[data-delvote]").forEach(b => b.onclick = async () => {
      const v = S.votes.find(x => x.id === b.dataset.delvote);
      if (!confirm(`Ta bort ${v.voter_name}s röst?`)) return;
      const { error } = await sb.from("km_votes").delete().eq("id", v.id);
      if (error) return toast("Kunde inte ta bort: " + error.message, true);
      reloadClass();
    });
    if ($("reset-votes")) $("reset-votes").onclick = async () => {
      if (!confirm(`Ta bort ALLA ${total} röster? Det går inte att ångra.`)) return;
      const { error } = await sb.from("km_votes").delete().eq("class_id", c.id);
      if (error) return toast("Kunde inte nollställa: " + error.message, true);
      toast("Alla röster är borttagna"); reloadClass();
    };
  }

  // ---------------------------------------------------------------------
  // Flik: Kostnader
  // ---------------------------------------------------------------------
  function raised() { return num(S.cls.saved_amount) + S.sales.reduce((a, s) => a + num(s.unit_price) * num(s.quantity), 0); }

  function tabCosts(el) {
    const c = S.cls;
    const st = settingsOf(c.settings);
    // Arbetskopior som sparas med knappen
    const work = {
      settings: JSON.parse(JSON.stringify(st)),
      dests: S.dests.map(d => ({ id: d.id, name: d.name, cost_entrance: d.cost_entrance, cost_extra: d.cost_extra, cost_accommodation: d.cost_accommodation, cost_transport: d.cost_transport, includes_food: d.includes_food }))
    };
    const people = c.student_count + c.adult_count;
    el.innerHTML = `
      <div class="card">
        <h2 class="section-label">👥 Deltagare</h2>
        <p>Kostnaderna räknas för <strong>${people} deltagare</strong> (${c.student_count} elever + ${c.adult_count} vuxna). <a href="#/klass/${esc(c.id)}/installningar">Ändra antal</a></p>
      </div>
      <div class="card">
        <h2 class="section-label">🍽️ Kostnader som är lika för alla resmål</h2>
        <p class="small muted" style="margin-bottom:.9rem">Per person för hela resan. Markera "mat" på det som räknas bort när ett resmål har mat i paketet.</p>
        <div id="fixed-list"></div>
        <button class="btn light sm" id="add-fixed">➕ Lägg till kostnad</button>
        <div class="grid2" style="margin-top:1.25rem">
          <label class="field"><span>🚌 Resa totalt för hela gruppen (standard)</span><input class="input num" type="number" min="0" step="100" id="def-transport" value="${num(work.settings.default_transport)}"></label>
          <label class="field"><span>🎯 Insamlingsmål</span><select class="input" id="goal-dest"><option value="">– Inget valt –</option>${S.dests.map(d => `<option value="${esc(d.id)}" ${work.settings.goal_destination_id === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
        </div>
        <p class="small muted">Resekostnaden kan ändras per resmål nedan. Insamlingsmålet visas för eleverna under Insamling.</p>
      </div>
      <h2 class="section-label">🎟️ Per resmål <span class="small muted" style="font-family:'Nunito',system-ui,sans-serif;font-size:.85rem">Insamlat: ${kr(raised())}</span></h2>
      ${S.dests.length ? "" : '<div class="card empty-state">Lägg till resmål först.</div>'}
      <div class="cost-grid" id="cost-grid"></div>
      <div class="sticky-save">
        <span class="status" id="cost-status"></span>
        <button class="btn" id="save-costs">💾 Spara kostnader<span class="dirty-dot hidden" id="dirty-ind"></span></button>
      </div>`;

    function renderFixed() {
      $("fixed-list").innerHTML = work.settings.fixed_costs.map((f, i) => `
        <div class="fixed-row">
          <input class="input" data-fi="${i}" data-k="label" value="${esc(f.label)}" maxlength="40" placeholder="T.ex. Lunch">
          <input class="input num" type="number" min="0" data-fi="${i}" data-k="amount" value="${num(f.amount)}" aria-label="Belopp per person">
          <label class="check food" style="margin:0;font-size:.85rem"><input type="checkbox" data-fi="${i}" data-k="food" ${f.food ? "checked" : ""}> mat</label>
          <button class="icon-btn" data-fdel="${i}" title="Ta bort">✕</button>
        </div>`).join("") + `<div class="small" style="text-align:right;font-weight:800;margin:.25rem 0 .75rem">Summa: ${kr(work.settings.fixed_costs.reduce((a, f) => a + num(f.amount), 0))} / person</div>`;
      $("fixed-list").querySelectorAll("[data-fi]").forEach(inp => inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
        const f = work.settings.fixed_costs[+inp.dataset.fi];
        f[inp.dataset.k] = inp.type === "checkbox" ? inp.checked : inp.dataset.k === "amount" ? num(inp.value) : inp.value;
        markDirty(); renderCards();
        if (inp.dataset.k === "amount") $("fixed-list").querySelector("div.small").textContent = "Summa: " + kr(work.settings.fixed_costs.reduce((a, x) => a + num(x.amount), 0)) + " / person";
      }));
      $("fixed-list").querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => { work.settings.fixed_costs.splice(+b.dataset.fdel, 1); markDirty(); renderFixed(); renderCards(); });
    }

    function cardTotals(d) {
      const r = calcDest(c, work.settings, d);
      return `<div class="cost-total"><span style="font-weight:800">Per person</span><span class="v">${kr(r.perPerson)}</span></div>
        <div class="small muted" style="text-align:right">Hela gruppen: ${kr(r.total)}</div>${fundBar(raised(), r.total)}`;
    }

    function renderCards() {
      const grid = $("cost-grid");
      if (!grid.children.length) {
        grid.innerHTML = work.dests.map((d, i) => `
          <div class="cost-card"><div class="cost-head">${emojiFor(d.name)} ${esc(d.name)}</div><div class="cost-body">
            <div class="cost-row"><span class="lbl">🎟️ Inträde/paket per pers</span><input class="input" type="number" min="0" data-di="${i}" data-k="cost_entrance" value="${num(d.cost_entrance)}"></div>
            <div class="cost-row"><span class="lbl">🎭 Övrigt per pers</span><input class="input" type="number" min="0" data-di="${i}" data-k="cost_extra" value="${num(d.cost_extra)}"></div>
            <div class="cost-row"><span class="lbl">🛏️ Boende per pers</span><input class="input" type="number" min="0" data-di="${i}" data-k="cost_accommodation" value="${num(d.cost_accommodation)}"></div>
            <div class="cost-row"><span class="lbl">🚌 Resa totalt</span><input class="input" type="number" min="0" step="100" data-di="${i}" data-k="cost_transport" value="${d.cost_transport == null ? "" : num(d.cost_transport)}" placeholder="${num(work.settings.default_transport)}"></div>
            <label class="check small" style="margin:.2rem 0 .5rem"><input type="checkbox" data-di="${i}" data-k="includes_food" ${d.includes_food ? "checked" : ""}> Mat ingår i priset</label>
            <div data-tot="${i}"></div>
          </div></div>`).join("");
        grid.querySelectorAll("[data-di]").forEach(inp => inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
          const d = work.dests[+inp.dataset.di], k = inp.dataset.k;
          if (inp.type === "checkbox") d[k] = inp.checked;
          else if (k === "cost_transport") d[k] = inp.value === "" ? null : num(inp.value);
          else d[k] = num(inp.value);
          markDirty(); renderCards();
        }));
      }
      work.dests.forEach((d, i) => { const t = grid.querySelector(`[data-tot="${i}"]`); if (t) t.innerHTML = cardTotals(d); });
      grid.querySelectorAll('[data-k="cost_transport"]').forEach(inp => inp.placeholder = num(work.settings.default_transport));
    }

    $("add-fixed").onclick = () => { work.settings.fixed_costs.push({ label: "", amount: 0, food: false }); markDirty(); renderFixed(); };
    $("def-transport").oninput = e => { work.settings.default_transport = num(e.target.value); markDirty(); renderCards(); };
    $("goal-dest").onchange = e => { work.settings.goal_destination_id = e.target.value || null; markDirty(); };
    renderFixed(); renderCards();

    $("save-costs").onclick = async () => {
      const stEl = $("cost-status");
      stEl.className = "status"; stEl.textContent = "Sparar…";
      $("save-costs").disabled = true;
      try {
        work.settings.fixed_costs = work.settings.fixed_costs.filter(f => f.label.trim() || num(f.amount));
        await updateClass({ settings: work.settings });
        const res = await Promise.all(work.dests.map(w => sb.from("km_destinations").update({
          cost_entrance: num(w.cost_entrance), cost_extra: num(w.cost_extra), cost_accommodation: num(w.cost_accommodation),
          cost_transport: w.cost_transport == null ? null : num(w.cost_transport), includes_food: !!w.includes_food
        }).eq("id", w.id)));
        const err = res.find(r => r.error);
        if (err) throw err.error;
        S.dirty = false;
        await loadClass(S.cls.id);
        toast("Kostnaderna är sparade ✓");
        renderTab();
      } catch (e) {
        stEl.className = "status err"; stEl.textContent = "Kunde inte spara: " + e.message;
        $("save-costs").disabled = false;
      }
    };
  }

  // ---------------------------------------------------------------------
  // Flik: Insamling
  // ---------------------------------------------------------------------
  function tabSales(el) {
    const c = S.cls;
    const work = { saved: num(c.saved_amount), rows: S.sales.map(s => Object.assign({}, s)), removed: [] };
    const st = settingsOf(c.settings);
    const goal = st.goal_destination_id && S.dests.find(d => d.id === st.goal_destination_id);
    const total = () => work.saved + work.rows.reduce((a, r) => a + num(r.unit_price) * num(r.quantity), 0);

    el.innerHTML = `
      <div class="card center">
        <div class="small muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Insamlat totalt</div>
        <div class="big-amount" id="sales-total">${kr(total())}</div>
        <div id="sales-goal" style="max-width:520px;margin:0 auto;text-align:left"></div>
        ${goal ? "" : `<p class="small muted" style="margin-top:.5rem">Välj ett insamlingsmål under <a href="#/klass/${esc(c.id)}/kostnader">Kostnader</a> för att se hur långt det är kvar.</p>`}
      </div>
      <div class="card">
        <h2 class="section-label">🏦 Klasskassa</h2>
        <label class="field" style="max-width:260px"><span>Pengar klassen redan har (kr)</span><input class="input num" type="number" min="0" step="100" id="saved-amount" value="${work.saved}"></label>
      </div>
      <div class="card">
        <h2 class="section-label">🛍️ Försäljning & aktiviteter</h2>
        <p class="small muted" style="margin-bottom:.75rem">Fyll i vad klassen tjänar per såld sak och hur många som sålts. Uppdatera antal efter hand.</p>
        <div class="sale-row sale-head"><span></span><span>Vad</span><span class="c-price">Kr / st</span><span class="c-qty">Antal</span><span class="c-sum" style="text-align:right">Summa</span><span></span></div>
        <div id="sale-rows"></div>
        <div class="row" style="margin-top:.9rem"><button class="btn light sm" id="add-sale">➕ Egen rad</button></div>
        <div style="margin-top:1rem"><div class="small muted" style="font-weight:700;margin-bottom:6px">Snabbval:</div><div class="chips" id="sale-chips"></div></div>
      </div>
      <div class="card">
        <label class="check" style="margin:0"><input type="checkbox" id="pub-fund" ${c.show_fundraising ? "checked" : ""}> Visa insamlingen för eleverna</label>
      </div>
      <div class="sticky-save">
        <span class="status" id="sales-status"></span>
        <button class="btn" id="save-sales">💾 Spara insamling<span class="dirty-dot hidden" id="dirty-ind"></span></button>
      </div>`;

    function refreshTotals() {
      $("sales-total").textContent = kr(total());
      if (goal) {
        const r = calcDest(c, st, goal);
        $("sales-goal").innerHTML = `<p class="small muted center" style="margin-top:.5rem">Mål: <strong>${esc(goal.name)}</strong> – ${kr(r.total)}</p>` + fundBar(total(), r.total);
      }
      work.rows.forEach((r, i) => { const s = document.querySelector(`[data-sum="${i}"]`); if (s) s.textContent = kr(num(r.unit_price) * num(r.quantity)); });
    }

    function renderRows() {
      $("sale-rows").innerHTML = work.rows.map((r, i) => `
        <div class="sale-row">
          <input class="input center c-emoji" data-si="${i}" data-k="emoji" value="${esc(r.emoji || "")}" maxlength="8" aria-label="Ikon">
          <input class="input c-label" data-si="${i}" data-k="label" value="${esc(r.label)}" maxlength="60" placeholder="T.ex. Kakförsäljning" aria-label="Vad">
          <label class="c-price"><span class="mob">Kr per st</span><input class="input num" type="number" min="0" data-si="${i}" data-k="unit_price" value="${num(r.unit_price)}" aria-label="Kronor per styck"></label>
          <label class="c-qty"><span class="mob">Antal sålda</span><input class="input num" type="number" min="0" data-si="${i}" data-k="quantity" value="${num(r.quantity)}" aria-label="Antal"></label>
          <strong class="c-sum" style="text-align:right" data-sum="${i}">${kr(num(r.unit_price) * num(r.quantity))}</strong>
          <button class="icon-btn c-del" data-sdel="${i}" title="Ta bort">✕</button>
        </div>`).join("") || '<div class="empty-state">Inga rader ännu – välj ett snabbval nedan.</div>';
      $("sale-rows").querySelectorAll("[data-si]").forEach(inp => inp.addEventListener("input", () => {
        const r = work.rows[+inp.dataset.si], k = inp.dataset.k;
        r[k] = (k === "unit_price" || k === "quantity") ? num(inp.value) : inp.value;
        markDirty(); refreshTotals();
      }));
      $("sale-rows").querySelectorAll("[data-sdel]").forEach(b => b.onclick = () => {
        const r = work.rows.splice(+b.dataset.sdel, 1)[0];
        if (r.id) work.removed.push(r.id);
        markDirty(); renderRows(); refreshTotals();
      });
    }

    $("sale-chips").innerHTML = TPL.sales.map((t, i) => `<button class="tag" type="button" data-tpl="${i}">${t.emoji} ${esc(t.label)}</button>`).join("");
    $("sale-chips").querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => {
      const t = TPL.sales[+b.dataset.tpl];
      work.rows.push({ emoji: t.emoji, label: t.label, unit_price: t.unit_price, quantity: 0 });
      markDirty(); renderRows();
      const last = $("sale-rows").querySelector(`[data-si="${work.rows.length - 1}"][data-k="quantity"]`);
      if (last) last.focus();
    });
    $("add-sale").onclick = () => { work.rows.push({ emoji: "🛍️", label: "", unit_price: 0, quantity: 0 }); markDirty(); renderRows(); };
    $("saved-amount").oninput = e => { work.saved = num(e.target.value); markDirty(); refreshTotals(); };
    $("pub-fund").onchange = async e => {
      try { await updateClass({ show_fundraising: e.target.checked }); toast("Sparat ✓"); }
      catch (err) { toast("Kunde inte spara: " + err.message, true); e.target.checked = !e.target.checked; }
    };
    renderRows(); refreshTotals();

    $("save-sales").onclick = async () => {
      const stEl = $("sales-status");
      const bad = work.rows.find(r => !String(r.label).trim());
      if (bad) { stEl.className = "status err"; stEl.textContent = "Alla rader behöver ett namn."; return; }
      stEl.className = "status"; stEl.textContent = "Sparar…";
      $("save-sales").disabled = true;
      try {
        await updateClass({ saved_amount: work.saved });
        const ops = [];
        if (work.removed.length) ops.push(sb.from("km_sales").delete().in("id", work.removed));
        work.rows.forEach((r, i) => {
          const row = { label: String(r.label).trim(), emoji: (r.emoji || "").trim() || null, unit_price: num(r.unit_price), quantity: num(r.quantity), sort_order: i };
          ops.push(r.id ? sb.from("km_sales").update(row).eq("id", r.id) : sb.from("km_sales").insert(Object.assign(row, { class_id: c.id })));
        });
        const res = await Promise.all(ops);
        const err = res.find(r => r.error);
        if (err) throw err.error;
        S.dirty = false;
        await loadClass(c.id);
        toast("Insamlingen är sparad ✓");
        renderTab();
      } catch (e) {
        stEl.className = "status err"; stEl.textContent = "Kunde inte spara: " + e.message;
        $("save-sales").disabled = false;
      }
    };
  }

  // ---------------------------------------------------------------------
  // Flik: Inställningar
  // ---------------------------------------------------------------------
  function tabSettings(el) {
    const c = S.cls;
    el.innerHTML = `
      <form class="card" id="settings-form">
        <h2 class="section-label">🏫 Klassen</h2>
        <div class="grid2">
          <label class="field"><span>Klass *</span><input class="input" name="name" required maxlength="80" value="${esc(c.name)}"></label>
          <label class="field"><span>Skola</span><input class="input" name="school" maxlength="120" value="${esc(c.school || "")}"></label>
        </div>
        <label class="field"><span>Rubrik för eleverna</span><input class="input" name="trip_title" maxlength="120" value="${esc(c.trip_title || "")}" placeholder="Vart ska vi åka på klassresa?"></label>
        <div class="grid2">
          <label class="field"><span>Antal elever</span><input class="input" name="student_count" type="number" min="1" max="200" required value="${c.student_count}"></label>
          <label class="field"><span>Medföljande vuxna</span><input class="input" name="adult_count" type="number" min="0" max="100" value="${c.adult_count}"></label>
        </div>
        <h2 class="section-label" style="margin-top:.75rem">👀 Vad eleverna ser</h2>
        <label class="check"><input type="checkbox" name="voting_open" ${c.voting_open ? "checked" : ""}> Röstningen är öppen</label>
        <label class="check"><input type="checkbox" name="allow_custom" ${c.allow_custom ? "checked" : ""}> Elever får skriva egna förslag</label>
        <label class="check"><input type="checkbox" name="show_results" ${c.show_results ? "checked" : ""}> Visa röstresultatet för eleverna</label>
        <label class="check"><input type="checkbox" name="show_costs" ${c.show_costs ? "checked" : ""}> Visa kostnader för eleverna</label>
        <label class="check"><input type="checkbox" name="show_fundraising" ${c.show_fundraising ? "checked" : ""}> Visa insamlingen för eleverna</label>
        <button class="btn" type="submit" style="margin-top:.5rem">💾 Spara</button>
        <div class="status" id="settings-status"></div>
      </form>
      <div class="card">
        <h2 class="section-label">🔑 Klasskod</h2>
        <p>Nuvarande kod: <strong style="letter-spacing:.1em">${esc(c.code)}</strong></p>
        <p class="small muted" style="margin:.4rem 0 .9rem">Om koden spridits till fel personer kan du byta den. Den gamla länken och QR-koden slutar då fungera.</p>
        <button class="btn light" id="new-code">Byt kod</button>
      </div>
      <div class="card" style="border:1.5px solid #FECACA">
        <h2 class="section-label" style="color:#DC2626">⚠️ Ta bort klassen</h2>
        <p class="small muted" style="margin-bottom:.9rem">Tar bort klassen med alla resmål, röster och insamling. Går inte att ångra.</p>
        <button class="btn danger" id="del-class">Ta bort ${esc(c.name)}</button>
      </div>`;

    const form = $("settings-form");
    form.addEventListener("input", markDirty);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const st = $("settings-status");
      st.className = "status"; st.textContent = "Sparar…";
      try {
        await updateClass({
          name: form.name.value.trim(), school: form.school.value.trim() || null, trip_title: form.trip_title.value.trim() || null,
          student_count: parseInt(form.student_count.value) || 1, adult_count: parseInt(form.adult_count.value) || 0,
          voting_open: form.voting_open.checked, allow_custom: form.allow_custom.checked, show_results: form.show_results.checked,
          show_costs: form.show_costs.checked, show_fundraising: form.show_fundraising.checked
        });
        S.dirty = false;
        hero(S.cls.name, [S.cls.school, "Kod: " + S.cls.code].filter(Boolean).join(" · "), true);
        st.className = "status ok"; st.textContent = "Sparat ✓";
      } catch (err) { st.className = "status err"; st.textContent = "Kunde inte spara: " + err.message; }
    });
    $("new-code").onclick = async () => {
      if (!confirm("Byta klasskod? Gamla länkar och QR-koder slutar fungera.")) return;
      const { data, error } = await sb.rpc("km_regenerate_code", { p_class_id: c.id });
      if (error) return toast("Kunde inte byta kod: " + error.message, true);
      S.cls.code = data;
      toast("Ny kod: " + data);
      hero(S.cls.name, [S.cls.school, "Kod: " + data].filter(Boolean).join(" · "), true);
      renderTab();
    };
    $("del-class").onclick = async () => {
      const ans = prompt(`Skriv klassens namn (${c.name}) för att bekräfta borttagning:`);
      if (ans == null) return;
      if (ans.trim() !== c.name) return toast("Namnet stämde inte – inget togs bort.", true);
      const { error } = await sb.from("km_classes").delete().eq("id", c.id);
      if (error) return toast("Kunde inte ta bort: " + error.message, true);
      S.cls = null; S.dirty = false;
      toast("Klassen är borttagen");
      location.hash = "#/";
    };
  }

  // =====================================================================
  // Start
  // =====================================================================
  (async function init() {
    const { data } = await sb.auth.getSession();
    setUser(data.session ? data.session.user : null);
    route();
  })();
})();
