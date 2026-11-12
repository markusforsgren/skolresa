// Klassmålet – elevsidan
(function () {
  const { sb, esc, safeUrl, videoEmbed, kr, calcDest, fundBar, emojiFor, codeFromUrl, storageGet, storageSet } = KM;
  const $ = id => document.getElementById(id);

  const code = codeFromUrl();
  let data = null;          // svaret från km_get_class
  let selected = null;      // { id } eller { custom: "text" }
  let modalDestId = null;
  const votedKey = "km_voted_" + code;

  // ---------- Kodformulär ----------
  $("no-class").addEventListener("submit", e => {
    e.preventDefault();
    const c = $("code-input").value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (c.length >= 4) location.href = "/k/" + c;
  });

  function showNoClass(title, msg) {
    $("loading").classList.add("hidden");
    $("no-class").classList.remove("hidden");
    $("no-class-title").textContent = title;
    $("no-class-msg").textContent = msg || "";
    $("hero-title").textContent = "Rösta på klassresan";
  }

  if (!code) { showNoClass("🔎 Skriv in klasskoden", "Koden har du fått av din lärare eller en förälder."); return; }

  async function load() {
    const { data: d, error } = await sb.rpc("km_get_class", { p_code: code });
    if (error) throw error;
    return d;
  }

  // ---------- Tabs ----------
  function buildTabs() {
    const tabs = [["vote", "🗳️ Rösta"]];
    if (data.class.show_costs && data.destinations.length) tabs.push(["cost", "💰 Kostnader"]);
    if (data.class.show_fundraising) tabs.push(["fund", "🛍️ Insamling"]);
    const nav = $("tab-nav");
    if (tabs.length < 2) { nav.classList.add("hidden"); return; }
    nav.classList.remove("hidden");
    nav.innerHTML = tabs.map(([k, l], i) => `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${k}">${l}</button>`).join("");
    nav.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  }
  function switchTab(k) {
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.toggle("active", p.id === "tab-" + k));
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === k));
  }

  // ---------- Header ----------
  function renderHeader() {
    const c = data.class;
    const badge = [c.school, c.name].filter(Boolean).join(" · ");
    $("hero-badge").classList.remove("hidden");
    $("hero-badge-text").textContent = badge;
    $("hero-title").textContent = c.trip_title || "Vart ska vi åka på klassresa?";
    document.title = (c.trip_title || "Klassresan") + " – " + c.name + " | Klassmålet";
  }

  function renderBanner() {
    const total = data.vote_count || 0;
    const n = data.class.student_count || 1;
    $("vote-count-text").textContent = total + " av " + n + " har röstat";
    $("progress-bar").style.width = Math.min(100, Math.round(total / n * 100)) + "%";
  }

  // ---------- Resmål ----------
  function cardImg(d) {
    const src = safeUrl(d.image_url);
    return src
      ? `<img class="card-img" src="${esc(src)}" alt="" loading="lazy">`
      : `<div class="card-ph">${emojiFor(d.name)}</div>`;
  }

  let tripFilter = "all";
  function renderFilter() {
    const box = $("trip-filter");
    const hasDay = data.destinations.some(d => !d.overnight), hasNight = data.destinations.some(d => d.overnight);
    if (!(hasDay && hasNight)) { box.innerHTML = ""; tripFilter = "all"; return; }
    const opts = [["all", "Alla"], ["day", "☀️ Dagsturer"], ["night", "🌙 Med övernattning"]];
    box.innerHTML = opts.map(([k, l]) => `<button type="button" class="tag${tripFilter === k ? " selected" : ""}" data-f="${k}">${l}</button>`).join("");
    box.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { tripFilter = b.dataset.f; renderFilter(); renderDests(); });
  }

  function renderDests() {
    const grid = $("dest-grid");
    const list = data.destinations.filter(d => tripFilter === "all" || (tripFilter === "day" ? !d.overnight : d.overnight));
    $("no-dests").classList.toggle("hidden", list.length > 0 || data.class.allow_custom);
    grid.innerHTML = list.map(d => `
      <div class="dest-card${selected && selected.id === d.id ? " selected" : ""}" data-id="${esc(d.id)}" role="button" tabindex="0" aria-label="Välj ${esc(d.name)}">
        <div class="selected-check">✓</div>
        ${cardImg(d)}
        <div class="dest-card-body">
          <div class="dest-card-name">${esc(d.name)}</div>
          <div class="dest-card-sub">${esc(d.subtitle || d.location || "")}</div>
        </div>
        <div class="dest-card-footer">
          ${KM.tripBadge(d)}
          <button class="info-btn" type="button" data-info="${esc(d.id)}">Läs mer →</button>
        </div>
      </div>`).join("");
    grid.querySelectorAll(".dest-card").forEach(el => {
      el.addEventListener("click", () => pick({ id: el.dataset.id }));
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick({ id: el.dataset.id }); } });
    });
    grid.querySelectorAll("[data-info]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openModal(b.dataset.info); }));
  }

  function pick(sel) {
    selected = sel;
    document.querySelectorAll(".dest-card").forEach(c => c.classList.toggle("selected", !!sel.id && c.dataset.id === sel.id));
    renderCustomChosen();
    updateVoteBtn();
  }

  function selectedLabel() {
    if (!selected) return "";
    if (selected.custom) return selected.custom;
    const d = data.destinations.find(x => x.id === selected.id);
    return d ? d.name : "";
  }

  // ---------- Eget förslag ----------
  function addCustom() {
    const v = $("custom-input").value.trim();
    if (!v) return;
    $("custom-input").value = "";
    pick({ custom: v.slice(0, 60) });
  }
  $("custom-btn").addEventListener("click", addCustom);
  $("custom-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } });

  function renderCustomChosen() {
    const box = $("custom-chosen");
    if (selected && selected.custom) {
      box.innerHTML = `<span class="tag selected">✏️ ${esc(selected.custom)} <button class="icon-btn" style="color:#fff;padding:0 2px" type="button" aria-label="Ta bort" id="custom-x">✕</button></span>`;
      $("custom-x").addEventListener("click", () => { selected = null; renderCustomChosen(); updateVoteBtn(); });
    } else box.innerHTML = "";
  }

  // ---------- Röst ----------
  function updateVoteBtn() {
    const name = $("name-input").value.trim();
    $("vote-btn").disabled = !selected || !name;
    $("choice-text").innerHTML = selected ? "Du har valt: <strong>" + esc(selectedLabel()) + "</strong>" : "Välj ett resmål ovan.";
  }
  $("name-input").addEventListener("input", updateVoteBtn);

  const ERRORS = {
    name_taken: "Det namnet har redan röstat. Skriv även efternamnets första bokstav, t.ex. \"Lisa K\".",
    closed: "Röstningen är stängd.",
    invalid_name: "Skriv ditt namn.",
    invalid_choice: "Välj ett resmål först.",
    custom_not_allowed: "Egna förslag är inte tillåtna i den här klassen.",
    not_found: "Klassen finns inte längre.",
    full: "Max antal röster är nått. Prata med din lärare."
  };

  $("vote-btn").addEventListener("click", async () => {
    const name = $("name-input").value.trim();
    if (!selected || !name) return;
    const btn = $("vote-btn"), msg = $("status-msg");
    btn.disabled = true;
    msg.className = "status"; msg.textContent = "Sparar din röst…";
    const label = selectedLabel();
    const { data: res, error } = await sb.rpc("km_cast_vote", {
      p_code: code, p_name: name,
      p_destination_id: selected.id || null,
      p_custom: selected.custom || null
    });
    if (error || res !== "ok") {
      msg.className = "status err";
      msg.textContent = error ? "Något gick fel – kontrollera nätet och försök igen." : (ERRORS[res] || "Något gick fel.");
      btn.disabled = false;
      if (res === "closed") refresh();
      return;
    }
    storageSet(votedKey, JSON.stringify({ name, label }));
    data.vote_count = (data.vote_count || 0) + 1;
    renderBanner();
    showVoted(name, label);
    refresh();
  });

  function showVoted(name, label) {
    $("vote-section").classList.add("hidden");
    $("voted-screen").classList.remove("hidden");
    $("voted-msg").textContent = label ? `Du röstade på: ${label} 🎯` : `Du har redan röstat, ${name} 👍`;
  }

  function renderVoteState() {
    const c = data.class;
    let voted = null;
    try { voted = JSON.parse(storageGet(votedKey) || "null"); } catch (e) { }
    $("custom-box").classList.toggle("hidden", !c.allow_custom);
    if (voted) { showVoted(voted.name, voted.label); $("closed-box").classList.add("hidden"); }
    else if (!c.voting_open) {
      $("vote-section").classList.add("hidden");
      $("closed-box").classList.remove("hidden");
    } else {
      $("vote-section").classList.remove("hidden");
      $("closed-box").classList.add("hidden");
    }
  }

  function renderResults() {
    const card = $("results-card");
    if (!data.class.show_results || !data.results) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const total = data.results.reduce((a, r) => a + r.count, 0);
    $("results-total").textContent = total + " röster";
    $("results-list").innerHTML = total === 0 ? '<div class="empty-state">Inga röster ännu.</div>' :
      data.results.map(r => {
        const pct = Math.round(r.count / total * 100);
        return `<div class="result-row"><div class="result-meta"><span class="result-name">${esc(r.label)}</span>
          <span class="result-pct">${r.count} röst${r.count !== 1 ? "er" : ""} · ${pct}%</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
      }).join("");
  }

  // ---------- Modal ----------
  function openModal(id) {
    const d = data.destinations.find(x => x.id === id);
    if (!d) return;
    modalDestId = id;
    const vid = videoEmbed(d.video_url), img = safeUrl(d.image_url);
    $("modal-media").innerHTML = vid
      ? `<iframe src="${esc(vid)}" title="Video" allowfullscreen allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"></iframe>`
      : img ? `<img src="${esc(img)}" alt="">` : `<div class="card-ph" style="height:140px;border-radius:24px 24px 0 0;font-size:4rem">${emojiFor(d.name)}</div>`;
    $("modal-title").textContent = d.name;
    $("modal-location").textContent = d.location ? "📍 " + d.location : "";
    $("modal-desc").textContent = d.description || d.subtitle || "";
    $("modal-tags").innerHTML = (d.tags || []).map(t => `<span class="pill">${esc(t)}</span>`).join("") + KM.tripBadge(d);
    let links = "";
    const web = safeUrl(d.website_url);
    if (web) links += `<a class="chip-link" href="${esc(web)}" target="_blank" rel="noopener">🌐 Hemsida</a>`;
    if (vid && img) links += `<a class="chip-link" href="${esc(safeUrl(d.video_url))}" target="_blank" rel="noopener">▶️ Öppna video</a>`;
    $("modal-links").innerHTML = links;
    const canVote = data.class.voting_open && !$("vote-section").classList.contains("hidden");
    $("modal-pick").classList.toggle("hidden", !canVote);
    $("modal-overlay").classList.add("open");
  }
  function closeModal() {
    $("modal-overlay").classList.remove("open");
    $("modal-media").innerHTML = ""; // stoppa video
  }
  $("modal-close").addEventListener("click", closeModal);
  $("modal-overlay").addEventListener("click", e => { if (e.target.id === "modal-overlay") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
  $("modal-pick").addEventListener("click", () => { pick({ id: modalDestId }); closeModal(); $("submit-box").scrollIntoView({ behavior: "smooth", block: "center" }); });

  // ---------- Kostnader ----------
  function raised() { return (Number(data.saved_amount) || 0) + (Number(data.sales_total) || 0); }

  function renderCosts() {
    if (!data.class.show_costs) return;
    const s = KM.settingsOf(data.settings);
    const c = data.class;
    const people = (c.student_count || 0) + (c.adult_count || 0);
    $("cost-intro").textContent = `Beräknat för ${people} deltagare (${c.student_count} elever${c.adult_count ? " + " + c.adult_count + " vuxna" : ""}). Alla belopp är uppskattningar.`;
    $("cost-raised").textContent = kr(raised());
    $("fixed-pills").innerHTML = s.fixed_costs.filter(f => KM.num(f.amount) > 0 || KM.fixedAmount(f, true) > 0)
      .map(f => { const day = KM.fixedAmount(f, true); return `<span class="pill">${esc(f.label)} ${kr(f.amount)}${day !== KM.num(f.amount) ? ` <span style="opacity:.75">(dagstur ${kr(day)})</span>` : ""}</span>`; }).join("") +
      (KM.num(s.default_transport) ? `<span class="pill">🚌 Resa ${kr(s.default_transport)} totalt</span>` : "");
    $("cost-grid").innerHTML = data.destinations.map(d => {
      const r = calcDest(c, s, d);
      const row = (l, v) => KM.num(v) ? `<div class="cost-row"><span class="lbl">${l}</span><span>${kr(v)}</span></div>` : "";
      return `<div class="cost-card"><div class="cost-head">${emojiFor(d.name)} ${esc(d.name)} <span style="font-family:Nunito,sans-serif;font-size:.75rem;opacity:.85">${KM.tripLabel(d)}</span></div><div class="cost-body">
        ${row(d.includes_food ? "🎫 Paket/inträde" : "🎟️ Inträde", d.cost_entrance)}
        ${row("🎭 Övriga aktiviteter", d.cost_extra)}
        ${row("🛏️ Boende", d.cost_accommodation)}
        ${row(d.includes_food ? "🍽️ Övrigt (mat ingår)" : "🍽️ Mat & fickpengar", r.fixed)}
        ${row(d.overnight === false && (d.days || 1) > 1 ? "🚌 Resor per person (" + d.days + " st)" : "🚌 Resa per person", r.transport / r.people)}
        <div class="cost-total"><span style="font-weight:800">Per person</span><span class="v">${kr(r.perPerson)}</span></div>
        <div class="small muted" style="text-align:right">Hela klassen: ${kr(r.total)}</div>
        ${fundBar(raised(), r.total)}
      </div></div>`;
    }).join("");
  }

  // ---------- Insamling ----------
  function renderFund() {
    if (!data.class.show_fundraising) return;
    $("fund-total").textContent = kr(raised());
    const s = KM.settingsOf(data.settings);
    const goal = s.goal_destination_id && data.destinations.find(d => d.id === s.goal_destination_id);
    if (goal && data.class.show_costs) {
      const r = calcDest(data.class, s, goal);
      $("fund-goal").innerHTML = `<p class="small muted center" style="margin-top:.5rem">Mål: <strong>${esc(goal.name)}</strong> – ${kr(r.total)}</p>` + fundBar(raised(), r.total);
    } else $("fund-goal").innerHTML = "";
    const rows = [];
    if (Number(data.saved_amount) > 0) rows.push(`<div class="list-row"><div class="thumb" style="width:42px">🏦</div><div class="grow"><strong>Klasskassa</strong></div><strong>${kr(data.saved_amount)}</strong></div>`);
    (data.sales || []).forEach(x => rows.push(`<div class="list-row"><div class="thumb" style="width:42px">${esc(x.emoji || "🛍️")}</div>
      <div class="grow"><strong>${esc(x.label)}</strong><div class="small muted">${Number(x.quantity).toLocaleString("sv-SE")} st × ${kr(x.unit_price)}</div></div>
      <strong>${kr(x.unit_price * x.quantity)}</strong></div>`));
    $("fund-list").innerHTML = rows.length ? rows.join("") : '<div class="empty-state">Inget insamlat ännu – nu kör vi! 💪</div>';
  }

  // ---------- Init ----------
  function renderAll() {
    renderHeader(); renderBanner(); renderVoteState(); renderFilter(); renderDests(); renderResults(); renderCosts(); renderFund();
  }

  async function refresh() {
    try {
      const d = await load();
      if (!d) return;
      const destsChanged = JSON.stringify(d.destinations) !== JSON.stringify(data.destinations);
      const openChanged = d.class.voting_open !== data.class.voting_open;
      data = d;
      renderBanner(); renderResults(); renderCosts(); renderFund();
      if (openChanged) renderVoteState();
      if (destsChanged) { renderFilter(); renderDests(); }
    } catch (e) { /* tyst – försöker igen nästa gång */ }
  }

  (async function init() {
    try {
      data = await load();
    } catch (e) {
      showNoClass("😕 Kunde inte ladda", "Kontrollera internetanslutningen och ladda om sidan.");
      return;
    }
    if (!data) { showNoClass("🤔 Hittade ingen klass", "Koden " + code + " finns inte. Kontrollera att du skrivit rätt."); return; }
    $("loading").classList.add("hidden");
    buildTabs();
    switchTab("vote");
    renderAll();
    setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  })();
})();
