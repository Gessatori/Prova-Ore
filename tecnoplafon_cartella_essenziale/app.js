
const $ = id => document.getElementById(id);
const cfg = window.TECNOPLAFON_CONFIG || {};
let db = null, session = null, cache = {collab:[], cantieri:[], lavorazioni:[], sotto:[]};

function initDb(){
  if(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('INSERISCI')){
    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  try{ session = JSON.parse(localStorage.getItem('tp_session') || 'null'); }catch(e){ session=null; }
}
function msg(el, text, type='success'){ if(!el) return; el.innerHTML = `<div class="${type}">${escapeHtml(text)}</div>`; }
function fmt(v){ return (v===null||v===undefined||v==='') ? '-' : Number(v).toLocaleString('it-CH',{minimumFractionDigits:0,maximumFractionDigits:2}); }

// Ore corrette: usare centesimi di ora (.50 = mezz'ora).
// Se qualcuno scrive il vecchio formato tipo 8.30, 8,30 o 8.3,
// il gestionale lo converte in 8.50 prima di salvare o sommare.
function oreToDecimal(v){
  if(v===null || v===undefined || v==='') return 0;
  const raw = String(v).trim().replace(',', '.');
  if(!raw) return 0;
  const neg = raw.startsWith('-');
  const clean = raw.replace('-', '');
  const parts = clean.split('.');
  let n = Number(raw);
  if(parts.length === 2){
    const h = Number(parts[0] || 0);
    const decTxt = parts[1];
    // 8.3 deve significare 8.30 minuti, quindi 8.50 decimale
    const min = decTxt.length === 1 ? Number(decTxt) * 10 : Number(decTxt);
    if([15,30,45].includes(min)){
      n = h + (min / 60);
      if(neg) n = -n;
    }
  } else if(Number.isFinite(n)) {
    const h = Math.trunc(Math.abs(n));
    const frac = Math.round((Math.abs(n) - h) * 100);
    if([15,30,45].includes(frac)){
      n = h + (frac / 60);
      if(v < 0) n = -n;
    }
  }
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function fmtOre(v){
  if(v===null || v===undefined || v==='') return '-';
  return oreToDecimal(v).toFixed(2);
}
function normalizzaCampoOre(id){
  const x = $(id);
  if(x && x.value !== '') x.value = fmtOre(x.value);
}
function installOreAutoNormalize(){
  ['oreTot','admOreTot','reqOre','regOre','regMaxOre','regMeseOre','regMeseOreGiorno','regOreLunGio','regOreVenerdi','regOrePrefestivo','festivoOre','periodoOreLunGio','periodoOreVenerdi','periodoOrePrefestivo','manualOre','manualMaxOre','vacSaldoIniziale','vacOreAnnue'].forEach(id=>{
    const x = $(id);
    if(x && !x.dataset.oreNormalize){
      x.dataset.oreNormalize = '1';
      x.addEventListener('change',()=>normalizzaCampoOre(id));
      x.addEventListener('blur',()=>normalizzaCampoOre(id));
    }
  });
}


// Inserimento ore con voce: compila i campi, ma non salva automaticamente.
// Funziona nei browser che supportano SpeechRecognition / webkitSpeechRecognition.
function tpNormText(v){
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s\.\,]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function tpNumberWordToValue(w){
  const map = {
    'zero':0,'uno':1,'una':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10,
    'undici':11,'dodici':12,'tredici':13,'quattordici':14,'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,'diciannove':19,'venti':20
  };
  return Object.prototype.hasOwnProperty.call(map,w) ? map[w] : null;
}
function tpParseOreDaVoce(text){
  const t = tpNormText(text).replace(/,/g,'.');
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:ore|ora|h)\s*(?:e\s*)?(?:mezza|mezzo|30|trenta)?/);
  if(m){
    let ore = oreToDecimal(m[1]);
    if(/(?:ore|ora|h)\s*e\s*(?:mezza|mezzo|30|trenta)/.test(t.slice(m.index))) ore = Math.trunc(ore) + 0.5;
    return Math.round(ore * 100) / 100;
  }
  m = t.match(/(zero|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti)\s*(?:ore|ora|h)\s*(?:e\s*)?(?:mezza|mezzo|30|trenta)?/);
  if(m){
    let ore = tpNumberWordToValue(m[1]) || 0;
    if(/(?:ore|ora|h)\s*e\s*(?:mezza|mezzo|30|trenta)/.test(t.slice(m.index))) ore += 0.5;
    return Math.round(ore * 100) / 100;
  }
  m = t.match(/(?:mezza giornata|mezzo giorno)/);
  if(m) return 4;
  m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? oreToDecimal(m[1]) : 0;
}
function tpBestMatchFromList(text, rows, labelFn){
  const nt = tpNormText(text);
  let best = null;
  let bestScore = 0;
  (rows || []).forEach(r=>{
    const lab = tpNormText(labelFn(r));
    if(!lab) return;
    const words = lab.split(' ').filter(w=>w.length >= 3);
    let score = 0;
    if(nt.includes(lab)) score += 100;
    words.forEach(w=>{ if(nt.includes(w)) score += Math.min(20, w.length * 2); });
    if(String(r.codice || '') && nt.includes(tpNormText(r.codice))) score += 30;
    if(score > bestScore){ bestScore = score; best = r; }
  });
  return bestScore > 0 ? best : null;
}
function tpSetSelectValue(id, value){
  const el = $(id);
  if(!el || value===null || value===undefined || value==='') return false;
  el.value = String(value);
  el.dispatchEvent(new Event('change'));
  return true;
}
function tpEstraiNotaVoce(text){
  const m = String(text || '').match(/(?:nota|note|descrizione|descrittivo)\s+(.+)$/i);
  return m ? m[1].trim() : '';
}
function tpCompilaOreDaVoce(text, prefisso){
  const isAdmin = prefisso === 'adm';
  const ids = isAdmin ? {
    cantiere:'admOreCantiere', lav:'admOreLav', sotto:'admOreSotto', ore:'admOreTot', note:'admOreNote', msg:'admOreMsg'
  } : {
    cantiere:'oreCantiere', lav:'oreLav', sotto:'oreSotto', ore:'oreTot', note:'oreNote', msg:'oreMsg'
  };

  const cantiere = tpBestMatchFromList(text, (cache.cantieri||[]).filter(c=>c.stato==='attivo'), c=>`${c.codice||''} ${c.nome||''} ${c.localita||''}`);
  const lav = tpBestMatchFromList(text, (cache.lavorazioni||[]).filter(l=>l.stato==='attivo'), l=>l.nome||'');
  const sottoList = lav ? (cache.sotto||[]).filter(s=>String(s.lavorazione_id)===String(lav.id) && s.stato==='attivo') : (cache.sotto||[]).filter(s=>s.stato==='attivo');
  const sotto = tpBestMatchFromList(text, sottoList, s=>s.nome||'');
  const ore = tpParseOreDaVoce(text);
  const nota = tpEstraiNotaVoce(text);

  if(cantiere) tpSetSelectValue(ids.cantiere, cantiere.id);
  if(lav) tpSetSelectValue(ids.lav, lav.id);
  // dopo il cambio lavorazione il select sotto-lavorazione viene ricaricato
  setTimeout(()=>{ if(sotto) tpSetSelectValue(ids.sotto, sotto.id); }, 80);
  if(ore > 0 && $(ids.ore)) $(ids.ore).value = fmtOre(ore);
  if(nota && $(ids.note)) $(ids.note).value = nota;

  const parti = [];
  parti.push(cantiere ? `cantiere: ${cantiere.nome || cantiere.codice}` : 'cantiere non riconosciuto');
  parti.push(lav ? `lavorazione: ${lav.nome}` : 'lavorazione non riconosciuta');
  parti.push(sotto ? `sotto-lavorazione: ${sotto.nome}` : 'sotto-lavorazione non riconosciuta');
  parti.push(ore > 0 ? `ore: ${fmtOre(ore)}` : 'ore non riconosciute');
  if(nota) parti.push(`note: ${nota}`);
  msg($(ids.msg), `Voce caricata. Controlla prima di salvare: ${parti.join(' · ')}` , (cantiere && lav && sotto && ore > 0) ? 'success' : 'error');
}
function tpStartVoiceOre(prefisso){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const msgId = prefisso === 'adm' ? 'admOreMsg' : 'oreMsg';
  if(!SR){
    msg($(msgId), 'Questo browser non supporta la voce. Prova con Chrome o Safari aggiornato.', 'error');
    return;
  }
  const rec = new SR();
  rec.lang = 'it-IT';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onstart = ()=>msg($(msgId), 'Sto ascoltando... parla adesso.');
  rec.onerror = e=>msg($(msgId), 'Voce non riuscita: ' + (e.error || 'errore'), 'error');
  rec.onresult = e=>{
    const text = e.results?.[0]?.[0]?.transcript || '';
    tpCompilaOreDaVoce(text, prefisso);
  };
  rec.start();
}
function installVoiceOreButtons(){
  const addBtn = (targetId, btnId, prefisso) => {
    const target = $(targetId);
    if(!target || $(btnId)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = btnId;
    btn.className = 'secondary';
    btn.textContent = 'Inserisci con voce';
    btn.onclick = () => tpStartVoiceOre(prefisso);
    target.insertAdjacentElement('afterend', btn);
  };
  addBtn('oreNote', 'btnVoceOreCollaboratore', 'worker');
  addBtn('admOreNote', 'btnVoceOreAdmin', 'adm');
}
window.tpStartVoiceOre = tpStartVoiceOre;
window.installVoiceOreButtons = installVoiceOreButtons;


// Richiesta materiale collaboratore + sezione admin dedicata.
// Salva su tabella Supabase richieste_materiale: niente email, notifica interna con numerino admin.
function installMaterialeWorkerUI(){
  if($('materialeBox') || !session || session.role !== 'worker') return;
  const appBox = $('appBox');
  if(!appBox) return;
  const card = document.createElement('section');
  card.id = 'materialeBox';
  card.className = 'card';
  card.innerHTML = `
    <h2>Richiesta materiale</h2>
    <p class="muted">Scrivi o detta il materiale che serve. La richiesta resta nel gestionale e l'admin la vede con il numerino delle richieste aperte.</p>
    <label>Cantiere</label>
    <select id="matCantiere"></select>
    <label>Materiale / descrizione</label>
    <textarea id="matDescrizione" rows="4" placeholder="Esempio: 20 pannelli, 2 sacchi colla, 3 scotch..."></textarea>
    <div class="row">
      <button type="button" class="secondary" onclick="tpStartVoiceMateriale()">Richiesta materiale con voce</button>
      <button type="button" onclick="salvaRichiestaMaterialeWorker()">Invia richiesta materiale</button>
    </div>
    <div id="matMsg"></div>
    <div id="matStorico" class="table-wrap"></div>`;
  const right = Array.from(appBox.querySelectorAll('.card')).find(x => (x.textContent || '').includes('Richiesta vacanza'));
  if(right) right.insertAdjacentElement('afterend', card); else appBox.appendChild(card);
  fillSelectWithBlankSafe($('matCantiere'), (cache.cantieri||[]).filter(c=>c.stato==='attivo'), r=>`${r.codice||''} ${r.nome||''}`, 'Scegli cantiere...');
  caricaMaterialeWorker();
  setTimeout(()=>enhanceSingleSelectButtons('matCantiere'), 0);
}
function tpCompilaMaterialeDaVoce(text){
  const cantiere = tpBestMatchFromList(text, (cache.cantieri||[]).filter(c=>c.stato==='attivo'), c=>`${c.codice||''} ${c.nome||''} ${c.localita||''}`);
  if(cantiere) tpSetSelectValue('matCantiere', cantiere.id);
  let desc = String(text || '').trim();
  desc = desc.replace(/^(richiesta\s+)?materiale\s*(per|a|cantiere)?\s*/i, '').trim();
  if(cantiere){
    const nome = tpNormText(`${cantiere.codice||''} ${cantiere.nome||''} ${cantiere.localita||''}`);
    // Non togliamo troppo: lasciamo la frase completa se non siamo sicuri.
  }
  if($('matDescrizione')) $('matDescrizione').value = desc || String(text || '').trim();
  msg($('matMsg'), `Voce caricata. Controlla prima di inviare${cantiere ? ': cantiere ' + (cantiere.nome || cantiere.codice) : '. Cantiere non riconosciuto.'}`, cantiere ? 'success' : 'error');
}
function tpStartVoiceMateriale(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ msg($('matMsg'), 'Questo browser non supporta la voce. Prova con Chrome o Safari aggiornato.', 'error'); return; }
  const rec = new SR();
  rec.lang = 'it-IT';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onstart = ()=>msg($('matMsg'), 'Sto ascoltando la richiesta materiale... parla adesso.');
  rec.onerror = e=>msg($('matMsg'), 'Voce non riuscita: ' + (e.error || 'errore'), 'error');
  rec.onresult = e=>{
    const text = e.results?.[0]?.[0]?.transcript || '';
    tpCompilaMaterialeDaVoce(text);
  };
  rec.start();
}
async function salvaRichiestaMaterialeWorker(){
  try{
    if(!requireDb()) return;
    const cantiereId = $('matCantiere')?.value || null;
    const materiale = ($('matDescrizione')?.value || '').trim();
    if(!materiale){ msg($('matMsg'), 'Scrivi o detta il materiale richiesto.', 'error'); return; }
    const row = {
      collaboratore_id: session.user.id,
      cantiere_id: cantiereId,
      materiale,
      stato: 'in_attesa',
      created_at: new Date().toISOString()
    };
    const saved = await q(db.from('richieste_materiale').insert(row).select('id').single());
    const cantiereTxt = ($('matCantiere')?.selectedOptions?.[0]?.textContent || '-').trim();
    const mail = await inviaNotificaEmailAdmin('materiale', {
      numero: saved?.id,
      collaboratore: `${session?.user?.cognome || ''} ${session?.user?.nome || ''}`.trim(),
      cantiere: cantiereTxt,
      materiale,
      data: todayISO()
    });
    msg($('matMsg'), mail.ok ? "Richiesta materiale salvata. Email automatica inviata all'admin." : "Richiesta materiale salvata nel gestionale. Email automatica non configurata o non inviata.");
    if($('matDescrizione')) $('matDescrizione').value = '';
    await caricaMaterialeWorker();
  }catch(e){
    msg($('matMsg'), e.message + ' - Se manca la tabella, esegui setup_richieste_materiale.sql in Supabase.', 'error');
  }
}
async function caricaMaterialeWorker(){
  const box = $('matStorico');
  if(!box || !session?.user?.id) return;
  try{
    const rows = await q(db.from('richieste_materiale').select('*,cantieri(codice,nome)').eq('collaboratore_id', session.user.id).order('created_at',{ascending:false}).limit(10));
    box.innerHTML = rows.length ? `<h3>Ultime richieste materiale</h3><table><tr><th>Data</th><th>Cantiere</th><th>Materiale</th><th>Stato</th></tr>${rows.map(r=>`<tr><td>${String(r.created_at||'').slice(0,10)}</td><td>${escapeHtml(`${r.cantieri?.codice||''} ${r.cantieri?.nome||''}`.trim() || '-')}</td><td>${escapeHtml(r.materiale||'')}</td><td>${badgeStatoMateriale(r.stato)}</td></tr>`).join('')}</table>` : '<p class="muted">Nessuna richiesta materiale.</p>';
  }catch(e){
    box.innerHTML = `<div class="error">Richieste materiale non disponibili. Esegui setup_richieste_materiale_fix.sql.</div>`;
  }
}
function badgeStatoMateriale(s){
  const cls = s==='evasa' ? 'green' : s==='annullata' ? 'red' : 'yellow';
  return `<span class="badge ${cls}">${escapeHtml(s || 'in_attesa')}</span>`;
}
async function aggiornaBadgeMaterialeAdmin(){
  const badge = $('materialeBadge');
  if(!badge || !db || session?.role !== 'admin') return;
  try{
    const { count, error } = await db.from('richieste_materiale').select('id', { count:'exact', head:true }).eq('stato','in_attesa');
    if(error) throw error;
    const n = Number(count || 0);
    badge.textContent = String(n);
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
  }catch(e){
    badge.style.display = 'none';
  }
}
window.aggiornaBadgeMaterialeAdmin = aggiornaBadgeMaterialeAdmin;
async function caricaMaterialeAdmin(){
  const box = $('adminMaterialeBox');
  if(!box) return;
  try{
    const rows = await q(db.from('richieste_materiale').select('*,collaboratori(nome,cognome),cantieri(codice,nome)').order('created_at',{ascending:false}).limit(200));
    box.innerHTML = rows.length ? `<table><tr><th>Data</th><th>Collaboratore</th><th>Cantiere</th><th>Materiale / descrizione</th><th>Stato</th><th>Azioni</th></tr>${rows.map(r=>`<tr><td>${String(r.created_at||'').slice(0,16).replace('T',' ')}</td><td>${escapeHtml(`${r.collaboratori?.cognome||''} ${r.collaboratori?.nome||''}`.trim())}</td><td>${escapeHtml(`${r.cantieri?.codice||''} ${r.cantieri?.nome||''}`.trim() || '-')}</td><td>${escapeHtml(r.materiale||'')}</td><td>${badgeStatoMateriale(r.stato)}</td><td><button onclick="setRichiestaMateriale('${r.id}','evasa')">Evasa</button> <button class="secondary" onclick="setRichiestaMateriale('${r.id}','in_attesa')">In attesa</button> <button class="ghost" onclick="setRichiestaMateriale('${r.id}','annullata')">Annulla</button></td></tr>`).join('')}</table>` : '<p class="muted">Nessuna richiesta materiale.</p>';
    msg($('adminMaterialeMsg'), 'Richieste materiale caricate.');
    await aggiornaBadgeMaterialeAdmin();
  }catch(e){
    box.innerHTML = `<div class="error">${escapeHtml(e.message)}<br>Esegui setup_richieste_materiale_fix.sql in Supabase.</div>`;
  }
}
async function setRichiestaMateriale(id, stato){
  try{
    await q(db.from('richieste_materiale').update({stato, updated_at:new Date().toISOString()}).eq('id', id));
    await caricaMaterialeAdmin();
    await aggiornaBadgeMaterialeAdmin();
  }catch(e){ msg($('adminMaterialeMsg'), e.message, 'error'); }
}
window.installMaterialeWorkerUI = installMaterialeWorkerUI;
window.tpStartVoiceMateriale = tpStartVoiceMateriale;
window.salvaRichiestaMaterialeWorker = salvaRichiestaMaterialeWorker;
window.caricaMaterialeAdmin = caricaMaterialeAdmin;
window.setRichiestaMateriale = setRichiestaMateriale;



// UI collaboratore: trasforma i menu a tendina in scelte eleganti a chip.
// I select originali restano presenti e vengono aggiornati: il codice esistente continua a funzionare uguale.
const TP_WORKER_SELECT_LABELS = {
  oreCantiere: 'Scegli cantiere',
  oreLav: 'Scegli lavorazione',
  oreSotto: 'Scegli sotto-lavorazione',
  reqTipo: 'Scegli tipo richiesta',
  matCantiere: 'Scegli cantiere materiale',
  myMese: 'Scegli mese'
};
function tpShortChoiceText(txt){
  return String(txt || '').replace(/\s+/g,' ').trim();
}
function enhanceSingleSelectButtons(selectId){
  const sel = $(selectId);
  if(!sel || !document.body || document.body.dataset.page !== 'worker') return;
  sel.classList.add('tp-original-select');
  let box = $(selectId + 'Buttons');
  if(!box){
    box = document.createElement('div');
    box.id = selectId + 'Buttons';
    box.className = 'choice-buttons';
    sel.insertAdjacentElement('afterend', box);
  }
  const options = Array.from(sel.options || []);
  const realOptions = options.filter(o => String(o.value || '') !== '');
  const searchId = selectId + 'ChoiceSearch';
  const goId = selectId + 'ChoiceGo';
  const oldSearch = $(searchId);
  const searchText = oldSearch ? oldSearch.value : '';
  if(!realOptions.length){
    box.innerHTML = `<div class="choice-empty">${selectId==='oreSotto' ? 'Prima scegli la lavorazione.' : 'Nessuna scelta disponibile.'}</div>`;
    return;
  }
  const current = String(sel.value || '');
  const q = tpNormText(searchText);
  const filteredOptions = q ? realOptions.filter(o => tpNormText(o.textContent).includes(q)) : realOptions;
  const firstValue = filteredOptions[0] ? String(filteredOptions[0].value) : '';
  const searchHtml = `
    <div class="choice-search-row">
      <input id="${searchId}" class="choice-search" type="search" placeholder="Ricerca veloce..." value="${escapeHtml(searchText)}" autocomplete="off">
      <button type="button" id="${goId}" class="choice-go" ${firstValue ? '' : 'disabled'}>Vai</button>
    </div>`;
  const buttonsHtml = filteredOptions.length ? filteredOptions.map(o=>{
    const active = String(o.value) === current ? ' active' : '';
    return `<button type="button" class="choice-btn${active}" data-value="${escapeHtml(o.value)}">${escapeHtml(tpShortChoiceText(o.textContent))}</button>`;
  }).join('') : '<div class="choice-no-results">Nessun risultato trovato.</div>';
  box.innerHTML = `${searchHtml}<div class="choice-scroll">${buttonsHtml}</div>`;
  const chooseValue = (value) => {
    if(!value) return;
    sel.value = String(value);
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    enhanceSingleSelectButtons(selectId);
    if(selectId === 'oreLav') setTimeout(()=>enhanceSingleSelectButtons('oreSotto'), 0);
  };
  const search = $(searchId);
  if(search){
    search.oninput = () => {
      const pos = search.selectionStart || search.value.length;
      enhanceSingleSelectButtons(selectId);
      const fresh = $(searchId);
      if(fresh){ fresh.focus(); fresh.setSelectionRange(pos, pos); }
    };
    search.onkeydown = (ev) => {
      if(ev.key === 'Enter'){
        ev.preventDefault();
        const freshQ = tpNormText(search.value);
        const first = (freshQ ? realOptions.filter(o => tpNormText(o.textContent).includes(freshQ)) : realOptions)[0];
        if(first) chooseValue(first.value);
      }
    };
  }
  const go = $(goId);
  if(go){
    go.onclick = () => {
      const freshQ = tpNormText($(searchId)?.value || '');
      const first = (freshQ ? realOptions.filter(o => tpNormText(o.textContent).includes(freshQ)) : realOptions)[0];
      if(first) chooseValue(first.value);
    };
  }
  box.querySelectorAll('button.choice-btn').forEach(btn=>{
    btn.onclick = () => chooseValue(btn.dataset.value);
  });
}
function enhanceWorkerChoices(){
  ['oreCantiere','oreLav','oreSotto','reqTipo','matCantiere','myMese'].forEach(enhanceSingleSelectButtons);
}
window.enhanceSingleSelectButtons = enhanceSingleSelectButtons;
window.enhanceWorkerChoices = enhanceWorkerChoices;



// Home collaboratore iPhone: menu iniziale con 4 pulsanti e pagine separate.
// Non cambia salvataggi, select o struttura dati: mostra/nasconde solo le card esistenti.
function installWorkerSectionButtons(){
  if(!document.body || document.body.dataset.page !== 'worker' || $('workerHomeMenu')) return;
  const appBox = $('appBox');
  if(!appBox) return;

  const cards = Array.from(appBox.querySelectorAll('section.card'));
  const oreCard = cards.find(c => (c.textContent || '').includes('Segna ore oggi'));
  const vacCard = cards.find(c => (c.textContent || '').includes('Richiesta vacanza'));
  const richiesteCard = cards.find(c => (c.textContent || '').includes('Le mie richieste'));
  const matCard = $('materialeBox');
  const stampaCard = cards.find(c => (c.textContent || '').includes('Stampa mese personale'));

  const pages = [
    {key:'ore', title:'Segna ore oggi', sub:'Inserisci le ore lavorate', icon:'🕒', cards:[oreCard]},
    {key:'vacanze', title:'Vacanza / congedo', sub:'Richieste e storico', icon:'🌴', cards:[vacCard, richiesteCard]},
    {key:'materiale', title:'Richiesta materiale', sub:'Invia materiale necessario', icon:'📦', cards:[matCard]},
    {key:'stampa', title:'Stampa mese', sub:'Riepilogo personale', icon:'🖨️', cards:[stampaCard]}
  ].map(p => Object.assign({}, p, {cards:p.cards.filter(Boolean)})).filter(p => p.cards.length);

  pages.forEach(page => {
    page.cards.forEach(card => {
      card.classList.add('worker-page-section','hidden');
      card.dataset.workerPage = page.key;
      if(!card.querySelector('.worker-back-menu')){
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'worker-back-menu ghost';
        back.textContent = '← Torna al menu';
        back.onclick = () => showWorkerMenu();
        card.insertAdjacentElement('afterbegin', back);
      }
    });
  });

  const menu = document.createElement('section');
  menu.id = 'workerHomeMenu';
  menu.className = 'worker-home-menu card';
  menu.innerHTML = `
    <div class="worker-home-head">
      <h2>Menu collaboratore</h2>
      <p>Scegli cosa vuoi fare.</p>
    </div>
    <div class="worker-home-grid">
      ${pages.map(x => `
        <button type="button" class="worker-home-btn" data-target="${x.key}">
          <span class="worker-home-icon">${x.icon}</span>
          <span class="worker-home-text"><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.sub)}</small></span>
        </button>`).join('')}
    </div>`;

  const title = appBox.querySelector('.page-title');
  if(title) title.insertAdjacentElement('afterend', menu); else appBox.prepend(menu);

  function showWorkerMenu(){
    document.body.classList.remove('worker-page-open');
    menu.classList.remove('hidden');
    pages.forEach(page => page.cards.forEach(card => card.classList.add('hidden')));
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function showWorkerPage(key){
    document.body.classList.add('worker-page-open');
    menu.classList.add('hidden');
    pages.forEach(page => page.cards.forEach(card => card.classList.toggle('hidden', page.key !== key)));
    const first = pages.find(page => page.key === key)?.cards?.[0];
    if(first) first.scrollIntoView({behavior:'smooth', block:'start'});
  }

  menu.querySelectorAll('.worker-home-btn').forEach(btn => {
    btn.onclick = () => showWorkerPage(btn.dataset.target);
  });

  window.showWorkerMenu = showWorkerMenu;
  window.showWorkerPage = showWorkerPage;
  showWorkerMenu();
}
window.installWorkerSectionButtons = installWorkerSectionButtons;

function tpDisplayText(s){ return String(s??'').replace(/cartongesso/gi, m => (m === m.toUpperCase() ? 'COSTRUZIONE A SECCO' : 'Costruzione a secco')); }
function escapeHtml(s){ return tpDisplayText(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
async function q(promise){ const {data,error}=await promise; if(error){ console.error(error); throw error; } return data; }
function requireDb(){ if(!db){ alert('Configura prima config.js con SUPABASE_URL e SUPABASE_ANON_KEY.'); return false;} return true; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function monthName(n){ return ['','Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'][Number(n)]||n; }
function fillMonths(el){ if(!el) return; el.innerHTML = Array.from({length:12},(_,i)=>`<option value="${i+1}">${monthName(i+1)}</option>`).join(''); el.value = new Date().getMonth()+1; }

function setDateRangeForSelectedMonth(){
  const anno = Number($('adminAnno')?.value || new Date().getFullYear());
  const mese = Number($('adminMese')?.value || (new Date().getMonth()+1));
  if(!$('filtroMeseDal') || !$('filtroMeseAl')) return;
  const start = `${anno}-${String(mese).padStart(2,'0')}-01`;
  const last = new Date(anno, mese, 0).getDate();
  const end = `${anno}-${String(mese).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  if(!$('filtroMeseDal').value) $('filtroMeseDal').value = start;
  if(!$('filtroMeseAl').value) $('filtroMeseAl').value = end;
}

function fillSelect(el, rows, label, value='id'){ if(el) el.innerHTML='<option value="">Scegli...</option>'+rows.map(r=>`<option value="${r[value]}">${escapeHtml(label(r))}</option>`).join(''); }


// V16 - filtri safe: non toccano dashboard e non duplicano ID.
function normSearchSafe(v){
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function selectHasValueSafe(sel, value){
  return !!sel && [...(sel.options||[])].some(o=>String(o.value)===String(value));
}
function filterRowsSafe(rows, text, fieldsFn, onlyActive=false){
  const q = normSearchSafe(text);
  return (rows || []).filter(r=>{
    if(onlyActive && r.stato !== 'attivo') return false;
    if(!q) return true;
    return normSearchSafe(fieldsFn(r)).includes(q);
  });
}
function fillSelectWithBlankSafe(el, rows, label, blankLabel='Tutti'){
  if(!el) return;
  el.innerHTML = `<option value="">${blankLabel}</option>` + (rows||[]).map(r=>`<option value="${r.id}">${escapeHtml(label(r))}</option>`).join('');
}
function aggiornaFiltriAdminSafe(){
  // V17: filtri semplificati. Nessun filtro testo sui select, per evitare blocchi.
  fillSelect($('adminCollabMese'), cache.collab || [], r=>`${r.cognome} ${r.nome} (${r.stato})`);
  fillSelect($('admOreCollab'), (cache.collab || []).filter(c=>c.stato==='attivo'), r=>`${r.cognome} ${r.nome}`);
  fillSelect($('admOreCantiere'), (cache.cantieri || []).filter(c=>c.stato==='attivo'), r=>`${r.codice} ${r.nome} - ${fmt(r.km)} km`);
  fillSelect($('admOreLav'), (cache.lavorazioni || []).filter(l=>l.stato==='attivo'), r=>r.nome);
  fillSelect($('admOreSotto'), cache.sotto || [], r=>r.nome);
}

function aggiornaSottoLavorazioniAdminInserimento(){
  const lavEl = $('admOreLav');
  const sottoEl = $('admOreSotto');
  if(!lavEl || !sottoEl) return;
  const lavId = lavEl.value;
  fillSelect(sottoEl, (cache.sotto || []).filter(s=>String(s.lavorazione_id)===String(lavId) && s.stato==='attivo'), r=>r.nome);
}
window.aggiornaSottoLavorazioniAdminInserimento = aggiornaSottoLavorazioniAdminInserimento;

window.aggiornaFiltriAdminSafe=aggiornaFiltriAdminSafe;

let v16MeseRows = [], v16MeseRie = null, v16MeseTr = [], v16RegolaMese = null, v16MeseInfo = null;

function v16FiltraMeseRows(rows){
  const dal = $('filtroMeseDal')?.value || '';
  const al = $('filtroMeseAl')?.value || '';
  const txt = normSearchSafe($('filtroMeseTesto')?.value || '');

  return (rows||[]).filter(r=>{
    const day = String(r.giorno).padStart(2,'0');
    const mese = String(v16MeseInfo?.mese || $('adminMese')?.value || '').padStart(2,'0');
    const anno = String(v16MeseInfo?.anno || $('adminAnno')?.value || '');
    const data = `${anno}-${mese}-${day}`;
    const okDal = !dal || data >= dal;
    const okAl = !al || data <= al;
    const all = normSearchSafe(`${r.cantiere||''} ${r.lavorazione||''} ${r.sotto_lavorazione||''} ${r.note||''} ${r.fascia_trasferta||''} ${r.tipo_giorno_stampa||''}`);
    const okTxt = !txt || all.includes(txt);
    return okDal && okAl && okTxt;
  });
}
function v16RenderMeseTable(rows, tableEl){
  if(!tableEl) return;
  tableEl.innerHTML = `<table><tr><th>Giorno</th><th>Tipo</th><th>Cantiere</th><th>Km</th><th>Lavorazione</th><th>Sotto-lavorazione</th><th>Inizio</th><th>Pausa</th><th>Fine</th><th>Ore da fare</th><th>Ore fatte</th><th>Ore richiesta</th><th>AVS</th><th>Trasferta</th><th>Note</th></tr>`+
  rows.map(r=>`<tr><td>${String(r.giorno).padStart(2,'0')} ${r.giorno_settimana}</td><td>${escapeHtml(r.tipo_giorno_stampa)}</td><td>${escapeHtml(r.cantiere||'-')}</td><td>${r.km??'-'}</td><td>${escapeHtml(r.lavorazione||'-')}</td><td>${escapeHtml(r.sotto_lavorazione||'-')}</td><td>${r.ora_inizio||'-'}</td><td>${r.pausa_inizio&&r.pausa_fine?`${r.pausa_inizio}-${r.pausa_fine}`:'-'}</td><td>${r.ora_fine||'-'}</td><td>${fmtOre(r.ore_da_fare)}</td><td>${fmtOre(r.ore_fatte)}</td><td>${fmtOre(oreToDecimal(r.ore_richiesta_a_ore||0)+oreToDecimal(r.ore_vacanza_richieste||0)+oreToDecimal(r.ore_vacanza_approvate||0))}</td><td>${r.avs_testo||'-'}</td><td>${escapeHtml(r.fascia_trasferta||'-')}</td><td>${escapeHtml(r.note||'')}</td></tr>`).join('')+'</table>';
}
function filtraRiepilogoMeseVisibile(){
  if(!v16MeseInfo) return;
  const filtered = v16FiltraMeseRows(v16MeseRows);
  v16RenderMeseTable(filtered, $('adminMeseBox'));
  if($('contaFiltriMeseStampa')) $('contaFiltriMeseStampa').textContent = `Mostrate ${filtered.length} righe su ${v16MeseRows.length}.`;
  renderPrintableMonthlyReport(v16MeseInfo.collabId, v16MeseInfo.anno, v16MeseInfo.mese, filtered, v16MeseRie, v16MeseTr, v16RegolaMese);
}
window.filtraRiepilogoMeseVisibile=filtraRiepilogoMeseVisibile;


const EMAIL_RICHIESTE_DESTINATARIO = 'info@tecnoplafon.ch';
async function inviaNotificaEmailAdmin(tipo, dettagli){
  try{
    if(!db || !db.functions || !db.functions.invoke) return {ok:false, skipped:true};
    const { error } = await db.functions.invoke('notifica-admin', {
      body: { tipo, destinatario: EMAIL_RICHIESTE_DESTINATARIO, dettagli }
    });
    if(error) throw error;
    return {ok:true};
  }catch(e){
    console.warn('Email automatica admin non inviata', e);
    return {ok:false, error:e};
  }
}
function testoTipoRichiesta(tipo){
  const t = String(tipo || '').replace(/_/g,' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Richiesta';
}
function apriEmailRichiestaCollaboratore(row){
  try{
    const collaboratore = `${session?.user?.cognome || ''} ${session?.user?.nome || ''}`.trim() || 'Collaboratore';
    const tipo = testoTipoRichiesta(row.tipo);
    const ore = row.giornata_intera ? 'Giornata intera' : `${fmtOre(row.ore_richieste)} ore`;
    const descrizione = row.note || '-';
    const subject = `Richiesta ${tipo} - ${collaboratore}`;
    const body = [
      'Buongiorno,',
      '',
      'è stata inserita una nuova richiesta dal gestionale Tecnoplafon.',
      '',
      `Collaboratore: ${collaboratore}`,
      `Tipo richiesta: ${tipo}`,
      `Dal giorno: ${row.data_inizio}`,
      `Al giorno: ${row.data_fine}`,
      `Ore / giornata: ${ore}`,
      `Descrizione: ${descrizione}`,
      '',
      'Richiesta in attesa di approvazione admin.',
      '',
      'Grazie'
    ].join('\n');
    const mailto = `mailto:${EMAIL_RICHIESTE_DESTINATARIO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }catch(e){
    console.warn('Email richiesta non aperta', e);
  }
}

function logout(){ localStorage.removeItem('tp_session'); location.href='index.html'; }
window.logout=logout;

async function loadBase(){
  cache.collab = await q(db.from('collaboratori').select('*').order('cognome'));
  cache.cantieri = await q(db.from('cantieri').select('*').order('id'));
  cache.lavorazioni = await q(db.from('lavorazioni').select('*').order('nome'));
  cache.sotto = await q(db.from('sotto_lavorazioni').select('*').order('nome'));
}

async function loginCollaboratore(){
  if(!requireDb()) return;
  const pass=$('workerPass').value.trim();
  try{
    const data=await q(db.from('collaboratori').select('*').eq('password_accesso',pass).eq('stato','attivo').maybeSingle());
    if(!data){ msg($('loginMsg'),'Password non valida o collaboratore terminato.','error'); return; }
    localStorage.setItem('tp_session', JSON.stringify({role:'worker', user:data}));
    location.reload();
  }catch(e){ msg($('loginMsg'), 'Errore login: '+e.message, 'error'); }
}
async function loginAdmin(){
  if(!requireDb()) return;
  const pass=$('adminPass').value.trim();
  try{
    const data=await q(db.from('admin_utenti').select('*').eq('password_accesso',pass).eq('attivo',true).maybeSingle());
    if(!data){ msg($('adminLoginMsg'),'Password admin non valida.','error'); return; }
    localStorage.setItem('tp_session', JSON.stringify({role:'admin', user:data}));
    location.href='admin.html';
  }catch(e){ msg($('adminLoginMsg'), 'Errore login: '+e.message, 'error'); }
}
window.loginCollaboratore=loginCollaboratore; window.loginAdmin=loginAdmin; window.oreToDecimal=oreToDecimal; window.fmtOre=fmtOre;

async function initWorker(){
  fillMonths($('myMese'));
  if(!requireDb()) return;
  await loadBase();
  if(session?.role!=='worker'){ $('loginBox').classList.remove('hidden'); return; }
  $('appBox').classList.remove('hidden');
  $('workerName').textContent = `${session.user.cognome} ${session.user.nome}`;
  $('todayLabel').textContent = new Date().toLocaleDateString('it-CH');
  $('reqDa').value=todayISO(); $('reqA').value=todayISO(); $('myAnno').value=new Date().getFullYear();
  fillSelect($('oreCantiere'), cache.cantieri.filter(c=>c.stato==='attivo'), r=>`${r.codice} ${r.nome} - ${fmt(r.km)} km`);
  fillSelect($('oreLav'), cache.lavorazioni.filter(l=>l.stato==='attivo'), r=>r.nome);
  $('oreLav').addEventListener('change',()=>{ fillSelect($('oreSotto'), cache.sotto.filter(s=>s.lavorazione_id===$('oreLav').value && s.stato==='attivo'), r=>r.nome); setTimeout(()=>enhanceSingleSelectButtons('oreSotto'), 0); });
  installVoiceOreButtons();
  installMaterialeWorkerUI();
  installWorkerSectionButtons();
  enhanceWorkerChoices();
  setTimeout(enhanceWorkerChoices, 250);
  await caricaOreOggi(); await caricaRichiesteWorker(); await caricaSaldoVacanzeWorker();
}

async function caricaOreOggi(){
  const rows=await q(db.from('ore_lavoro').select('*,cantieri(codice,nome),lavorazioni(nome),sotto_lavorazioni(nome)').eq('collaboratore_id',session.user.id).eq('data',todayISO()).neq('stato','annullato'));
  $('oreOggiBox').innerHTML = rows.length ? `<h3>Ore già inserite oggi</h3><table><tr><th>Cantiere</th><th>Lavorazione</th><th>Ore</th><th>Note</th></tr>${rows.map(r=>`<tr><td>${escapeHtml(r.cantieri?.codice||'')} ${escapeHtml(r.cantieri?.nome||'')}</td><td>${escapeHtml(r.lavorazioni?.nome||'')} / ${escapeHtml(r.sotto_lavorazioni?.nome||'')}</td><td>${fmtOre(r.ore_totali)}</td><td>${escapeHtml(r.note||'')}</td></tr>`).join('')}</table>` : '<p class="muted">Nessuna ora inserita oggi.</p>';
}
async function salvaOreOggi(){
  try{
    const row={collaboratore_id:session.user.id,cantiere_id:$('oreCantiere').value,lavorazione_id:$('oreLav').value,sotto_lavorazione_id:$('oreSotto').value,data:todayISO(),ore_totali:oreToDecimal($('oreTot').value),note:$('oreNote').value,created_by:'collaboratore'};
    if(!row.cantiere_id || !row.lavorazione_id || !row.sotto_lavorazione_id || !row.ore_totali){ msg($('oreMsg'),'Compila cantiere, lavorazione, sotto-lavorazione e ore.','error'); return; }
    await q(db.from('ore_lavoro').insert(row));
    msg($('oreMsg'),'Ore salvate correttamente.');
    await caricaOreOggi();
  }catch(e){ msg($('oreMsg'), e.message, 'error'); }
}
window.salvaOreOggi=salvaOreOggi;

async function salvaRichiesta(){
  try{
    const row={collaboratore_id:session.user.id,tipo:$('reqTipo').value,data_inizio:$('reqDa').value,data_fine:$('reqA').value,giornata_intera:$('reqGiornata').checked,ore_richieste:$('reqGiornata').checked?null:oreToDecimal($('reqOre').value||0),note:$('reqNote').value,stato:'in_attesa'};
    const saved = await q(db.from('richieste_congedo').insert(row).select('id').single());
    const mail = await inviaNotificaEmailAdmin('vacanza_congedo', {
      numero: saved?.id,
      collaboratore: `${session?.user?.cognome || ''} ${session?.user?.nome || ''}`.trim(),
      tipo: testoTipoRichiesta(row.tipo),
      data_inizio: row.data_inizio,
      data_fine: row.data_fine,
      ore: row.giornata_intera ? 'Giornata intera' : `${fmtOre(row.ore_richieste)} ore`,
      descrizione: row.note || '-'
    });
    msg($('reqMsg'), mail.ok ? 'Richiesta salvata. Email automatica inviata all admin.' : 'Richiesta salvata nel gestionale. Email automatica non configurata o non inviata.');
    await caricaRichiesteWorker();
  }catch(e){ msg($('reqMsg'), e.message, 'error'); }
}
window.salvaRichiesta=salvaRichiesta;

async function caricaRichiesteWorker(){
  const rows=await q(db.from('richieste_congedo').select('*').eq('collaboratore_id',session.user.id).order('created_at',{ascending:false}));
  $('richiesteBox').innerHTML=renderRichiesteTable(rows,false);
}
function renderRichiesteTable(rows, admin){
  if(!rows.length) return '<p class="muted">Nessuna richiesta.</p>';
  return `<table><tr><th>Tipo</th><th>Da</th><th>A</th><th>Ore</th><th>Stato</th><th>Note</th>${admin?'<th>Azioni</th>':''}</tr>`+
  rows.map(r=>`<tr><td>${escapeHtml(r.tipo)}</td><td>${r.data_inizio}</td><td>${r.data_fine}</td><td>${r.giornata_intera?'giornata':fmtOre(r.ore_richieste)}</td><td>${badgeStato(r.stato)}</td><td>${escapeHtml(r.note||'')}</td>${admin?`<td><button onclick="setRichiesta('${r.id}','approvata')">Approva</button> <button class="secondary" onclick="setRichiesta('${r.id}','rifiutata')">Rifiuta</button></td>`:''}</tr>`).join('')+'</table>';
}
function badgeStato(s){ const cls=s==='approvata'?'green':s==='rifiutata'?'red':'yellow'; return `<span class="badge ${cls}">${escapeHtml(s)}</span>`; }

async function caricaMesePersonale(){
  await renderMese(session.user.id, $('myAnno').value, $('myMese').value, $('myRiepilogo'), $('myMeseBox'), null);
}
window.caricaMesePersonale=caricaMesePersonale;

async function initAdmin(){
  fillMonths($('adminMese'));
  if(!requireDb()) return;
  if(session?.role!=='admin'){ $('adminLoginBox').classList.remove('hidden'); return; }
  $('adminBox').classList.remove('hidden');
  await loadBase();
  $('dashDate').value=todayISO(); $('adminAnno').value=new Date().getFullYear(); $('admOreData').value=todayISO(); if($('regData')) $('regData').value=todayISO(); if($('regAnno')) $('regAnno').value=new Date().getFullYear(); fillMonths($('regMese')); fillMonths($('calMeseVista')); if($('regMese')) $('regMese').value=new Date().getMonth()+1;
  fillSelect($('adminCollabMese'), cache.collab, r=>`${r.cognome} ${r.nome} (${r.stato})`);
  fillSelect($('vacCollabSelect'), cache.collab, r=>`${r.cognome} ${r.nome} (${r.stato})`);
  fillSelect($('admOreCollab'), cache.collab.filter(c=>c.stato==='attivo'), r=>`${r.cognome} ${r.nome}`);
  fillSelect($('admOreCantiere'), cache.cantieri.filter(c=>c.stato==='attivo'), r=>`${r.codice} ${r.nome} - ${fmt(r.km)} km`);
  fillSelect($('admOreLav'), cache.lavorazioni.filter(l=>l.stato==='attivo'), r=>r.nome);
  fillSelect($('newSottoLav'), cache.lavorazioni.filter(l=>l.stato==='attivo'), r=>r.nome);
  $('admOreLav').addEventListener('change', aggiornaSottoLavorazioniAdminInserimento);
  if($('admOreCollab')) $('admOreCollab').addEventListener('change',()=>{ if($('admOreCollab').value) caricaOreAdminCollaboratore(); });
  if($('admOreData')) $('admOreData').addEventListener('change',()=>{ if($('admOreCollab')?.value) caricaOreAdminCollaboratore(); });
  installVoiceOreButtons();
  await aggiornaBadgeMaterialeAdmin();
  aggiornaFiltriAdminSafe(); aggiornaSottoLavorazioniAdminInserimento(); renderAnagrafiche(); renderLavorazioni(); await caricaDashboard(); if(window.caricaRegolaGiorno) await caricaRegolaGiorno(); if(window.caricaRegolaMese) await caricaRegolaMese(); if(window.caricaRegoleKm) await caricaRegoleKm();
}
function showAdminTab(tab){
  document.querySelectorAll('.admin-tab').forEach(e=>e.classList.add('hidden'));
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
  $('tab-'+tab).classList.remove('hidden');
  event?.target?.classList.add('active');
  if(tab==='richieste') caricaRichiesteAdmin();
  if(tab==='materiale') caricaMaterialeAdmin();
  if(tab!=='materiale') aggiornaBadgeMaterialeAdmin();
  if(tab==='regie') initRegieFirma();
  if(tab==='vacanze') caricaVacanzeAdmin();
  if(tab==='calendario') { initCalendarioAnnualeUI(); caricaFestivi(); caricaPeriodi(); caricaRiepilogoCalendarioAnno(); caricaCalendarioAnno(); }
}
window.showAdminTab=showAdminTab;

async function caricaDashboard(){
  const date=$('dashDate').value;
  const cal=await q(db.from('calendario_giorni').select('*').eq('data',date).maybeSingle());
  const ore=await q(db.from('ore_lavoro').select('*,cantieri(codice,nome),lavorazioni(nome),sotto_lavorazioni(nome)').eq('data',date).neq('stato','annullato'));
  const req=await q(db.from('richieste_congedo').select('*').lte('data_inizio',date).gte('data_fine',date));
  $('dayInfo').innerHTML=`<b>${date}</b> · ${escapeHtml(cal?.tipo_giorno||'non in calendario')} · ore previste ${fmt(cal?.ore_previste||0)}`;
  const active=cache.collab.filter(c=>c.stato==='attivo');
  $('collabStatusList').innerHTML=active.map(c=>{
    const hasOre=ore.some(o=>o.collaboratore_id===c.id);
    const r=req.find(x=>x.collaboratore_id===c.id);
    let color='red', text='Ore non segnate';
    if(cal && ['sabato','domenica','festivo'].includes(cal.tipo_giorno)){ color='gray'; text='Non lavorativo'; }
    if(r){ color=r.stato==='approvata'?'green':'yellow'; text=r.stato==='approvata'?'Vacanza/congedo approvato':'Richiesta in attesa'; }
    if(hasOre){ color='green'; text='Ore segnate'; }
    return `<div class="person" onclick="dettaglioCollaboratoreGiorno('${c.id}')"><span class="dot ${color}"></span><div><b>${escapeHtml(c.cognome)} ${escapeHtml(c.nome)}</b><span>${text}</span></div></div>`;
  }).join('');
}
window.caricaDashboard=caricaDashboard;

async function dettaglioCollaboratoreGiorno(id){
  const date=$('dashDate').value; const c=cache.collab.find(x=>x.id===id);
  const ore=await q(db.from('ore_lavoro').select('*,cantieri(codice,nome),lavorazioni(nome),sotto_lavorazioni(nome)').eq('data',date).eq('collaboratore_id',id).neq('stato','annullato'));
  const req=await q(db.from('richieste_congedo').select('*').eq('collaboratore_id',id).lte('data_inizio',date).gte('data_fine',date));
  $('collabDayDetail').classList.remove('hidden');
  $('collabDayDetail').innerHTML=`<h2>${escapeHtml(c.cognome)} ${escapeHtml(c.nome)} · ${date}</h2>`+
    (ore.length?`<table><tr><th>Cantiere</th><th>Lavorazione</th><th>Ore</th><th>Note</th></tr>${ore.map(o=>`<tr><td>${escapeHtml(o.cantieri?.codice||'')} ${escapeHtml(o.cantieri?.nome||'')}</td><td>${escapeHtml(o.lavorazioni?.nome||'')} / ${escapeHtml(o.sotto_lavorazioni?.nome||'')}</td><td>${fmt(o.ore_totali)}</td><td>${escapeHtml(o.note||'')}</td></tr>`).join('')}</table>`:'<p class="red">Nessuna ora inserita.</p>')+
    (req.length?`<h3>Richieste</h3>${renderRichiesteTable(req,false)}`:'');
}
window.dettaglioCollaboratoreGiorno=dettaglioCollaboratoreGiorno;

async function caricaMeseAdmin(){
  setDateRangeForSelectedMonth();
  await renderMese($('adminCollabMese').value, $('adminAnno').value, $('adminMese').value, $('adminRiepilogo'), $('adminMeseBox'), $('adminTrasferteBox'));
}
window.caricaMeseAdmin=caricaMeseAdmin;

async function renderMese(collabId, anno, mese, rieEl, tableEl, transferEl){
  const rowsRaw=await q(db.from('v_stampa_mensile_collaboratore').select('*').eq('collaboratore_id',collabId).eq('anno',anno).eq('mese',mese).order('giorno'));
  const rieRaw=await q(db.from('v_riepilogo_mensile_collaboratore').select('*').eq('collaboratore_id',collabId).eq('anno',anno).eq('mese',mese).maybeSingle());
  const tr=transferEl ? await q(db.from('v_riepilogo_trasferte_mese').select('*').eq('collaboratore_id',collabId).eq('anno',anno).eq('mese',mese)) : [];
  const regolaMese = await q(db.from('regole_mensili').select('*').eq('anno',anno).eq('mese',mese).maybeSingle());
  const startMese = `${anno}-${String(mese).padStart(2,'0')}-01`;
  const endMese = `${anno}-${String(mese).padStart(2,'0')}-${String(new Date(Number(anno), Number(mese), 0).getDate()).padStart(2,'0')}`;
  const calendarioRows = await q(db.from('calendario_giorni').select('*').gte('data',startMese).lte('data',endMese).order('data'));
  const applicato = tpApplicaRegoleMeseAllaStampa(rowsRaw, rieRaw, regolaMese, calendarioRows);
  v16MeseInfo = {collabId, anno, mese};
  const trasfertaCorretta = tpApplicaTrasfertaUnicaGiornaliera(applicato.rows, tr);
  const rows = trasfertaCorretta.rows;
  const trCorrette = trasfertaCorretta.trasferte;
  const rieBase = applicato.rie;
  const rieCorretto = tpRiepilogoGiorniUnici(rows, rieBase);
  v16MeseRows = rows; v16MeseRie = rieCorretto; v16MeseTr = trCorrette; v16RegolaMese = regolaMese;
  if(rieEl) rieEl.innerHTML = rieCorretto ? `<div class="summary">
    <div class="box"><span>Ore fatte</span><div class="big">${fmtOre(rieCorretto.totale_ore_fatte)}</div></div>
    <div class="box"><span>Ore da fare</span><div class="big">${fmtOre(rieCorretto.totale_ore_da_fare)}</div></div>
    <div class="box"><span>Carenza ore</span><div class="big orange">${fmtOre(rieCorretto.carenza_ore)}</div></div>
    <div class="box"><span>Giorni lavorati</span><div class="big">${fmt(rieCorretto.giorni_lavorati)}</div></div>
    <div class="box"><span>Giorni AVS sì</span><div class="big green">${fmt(rieCorretto.giorni_avs_si)}</div></div>
    <div class="box"><span>Giorni AVS no</span><div class="big red">${fmt(rieCorretto.giorni_avs_no)}</div></div>
    <div class="box"><span>Ore richieste</span><div class="big">${fmt(Number(rieCorretto.totale_ore_richieste_a_ore||0)+Number(rieCorretto.totale_ore_vacanza_richieste||0))}</div></div>
    <div class="box"><span>Ore approvate</span><div class="big green">${fmtOre(rieCorretto.totale_ore_vacanza_approvate)}</div></div>
  </div>` : '<p class="muted">Nessun riepilogo.</p>';
  tableEl.innerHTML = `<table><tr><th>Giorno</th><th>Tipo</th><th>Cantiere</th><th>Km</th><th>Lavorazione</th><th>Sotto-lavorazione</th><th>Inizio</th><th>Pausa</th><th>Fine</th><th>Ore da fare</th><th>Ore fatte</th><th>Ore richiesta</th><th>AVS</th><th>Trasferta</th><th>Note</th></tr>`+
  rows.map(r=>`<tr><td>${String(r.giorno).padStart(2,'0')} ${r.giorno_settimana}</td><td>${escapeHtml(r.tipo_giorno_stampa)}</td><td>${escapeHtml(r.cantiere||'-')}</td><td>${r.km??'-'}</td><td>${escapeHtml(r.lavorazione||'-')}</td><td>${escapeHtml(r.sotto_lavorazione||'-')}</td><td>${r.ora_inizio||'-'}</td><td>${r.pausa_inizio&&r.pausa_fine?`${r.pausa_inizio}-${r.pausa_fine}`:'-'}</td><td>${r.ora_fine||'-'}</td><td>${fmtOre(r.ore_da_fare)}</td><td>${fmtOre(r.ore_fatte)}</td><td>${fmtOre(oreToDecimal(r.ore_richiesta_a_ore||0)+oreToDecimal(r.ore_vacanza_richieste||0)+oreToDecimal(r.ore_vacanza_approvate||0))}</td><td>${r.avs_testo||'-'}</td><td>${escapeHtml(r.fascia_trasferta||'-')}</td><td>${escapeHtml(r.note||'')}</td></tr>`).join('')+'</table>';
  filtraRiepilogoMeseVisibile();
  if(transferEl) transferEl.innerHTML = trCorrette.length ? `<h3>Riepilogo trasferte</h3><table><tr><th>Fascia</th><th>Giorni</th><th>Importo</th><th>Totale</th></tr>${trCorrette.map(x=>`<tr><td>${escapeHtml(x.fascia_trasferta)}</td><td>${x.giorni}</td><td>CHF ${fmt(x.indennita_giornaliera_chf)}</td><td>CHF ${fmt(x.totale_chf)}</td></tr>`).join('')}</table>` : '';
  renderPrintableMonthlyReport(collabId, anno, mese, rows, rieCorretto, trCorrette, regolaMese);
}

function rowPrintClass(r){
  const tipo = String(r.tipo_giorno_stampa || '').toLowerCase();
  if(tipo.includes('sabato') || tipo.includes('domenica')) return 'is-weekend';
  if(tipo.includes('festivo')) return 'is-holiday';
  if(tipo.includes('vacanza approvata')) return 'is-vac-approvata';
  if(tipo.includes('richiesta vacanza')) return 'is-vac-richiesta';
  if(tipo.includes('richiesta ore')) return 'is-richiesta-ore';
  return '';
}
function safe(v, fallback='-'){ return (v===null || v===undefined || v==='') ? fallback : escapeHtml(v); }
function timeSpan(r){ return (r.pausa_inizio && r.pausa_fine) ? `${r.pausa_inizio} - ${r.pausa_fine}` : '-'; }
function numberOrZero(v){ return Number(v || 0); }
function tpFasciaValida(f){
  const s = String(f || '').trim();
  return s && s !== '-' ? s : '';
}
function tpImportoTrasfertaPerFascia(fascia, trasferte){
  const f = String(fascia || '');
  const row = (trasferte || []).find(x => String(x.fascia_trasferta || '') === f);
  if(!row) return 0;
  const diretto = numberOrZero(row.indennita_giornaliera_chf);
  if(diretto > 0) return diretto;
  const giorni = numberOrZero(row.giorni);
  const totale = numberOrZero(row.totale_chf);
  return giorni > 0 ? Math.round((totale / giorni) * 100) / 100 : 0;
}

// FIX trasferte: una sola trasferta al giorno per collaboratore.
// Se nello stesso giorno ci sono piu cantieri, vince il cantiere con piu ore fatte.
// La trasferta resta visibile solo su una riga del cantiere vincente e il riepilogo conta 1 giorno.
function tpApplicaTrasfertaUnicaGiornaliera(rows, trasferteOriginali){
  const righe = (rows || []).map((r, idx) => Object.assign({}, r, {_tpIdxTrasferta: idx}));
  const giorni = new Map();

  righe.forEach(r => {
    const key = tpGiornoKeyRiepilogo(r);
    const ore = oreToDecimal(r.ore_fatte || 0);
    const fascia = tpFasciaValida(r.fascia_trasferta);
    if(!key || key.includes('undefined') || ore <= 0 || !fascia) return;
    if(!giorni.has(key)) giorni.set(key, []);
    giorni.get(key).push(r);
  });

  const indiciVincitori = new Set();
  giorni.forEach(lista => {
    const perCantiere = new Map();
    lista.forEach(r => {
      const cantiereKey = String(r.cantiere_id || r.cantiere || '').trim() || ('riga-' + r._tpIdxTrasferta);
      const curr = perCantiere.get(cantiereKey) || {ore:0, righe:[]};
      curr.ore += oreToDecimal(r.ore_fatte || 0);
      curr.righe.push(r);
      perCantiere.set(cantiereKey, curr);
    });

    let vincitore = null;
    perCantiere.forEach(v => {
      if(!vincitore || v.ore > vincitore.ore) vincitore = v;
    });
    if(!vincitore || !vincitore.righe.length) return;

    let rigaVincente = vincitore.righe[0];
    vincitore.righe.forEach(r => {
      if(oreToDecimal(r.ore_fatte || 0) > oreToDecimal(rigaVincente.ore_fatte || 0)) rigaVincente = r;
    });
    indiciVincitori.add(rigaVincente._tpIdxTrasferta);
  });

  const rowsCorrette = righe.map(r => {
    const out = Object.assign({}, r);
    delete out._tpIdxTrasferta;
    if(!indiciVincitori.has(r._tpIdxTrasferta)){
      out.fascia_trasferta = '';
      if(Object.prototype.hasOwnProperty.call(out, 'indennita_giornaliera_chf')) out.indennita_giornaliera_chf = 0;
      if(Object.prototype.hasOwnProperty.call(out, 'totale_trasferta_chf')) out.totale_trasferta_chf = 0;
    }
    return out;
  });

  const riepilogo = new Map();
  rowsCorrette.forEach(r => {
    const fascia = tpFasciaValida(r.fascia_trasferta);
    const ore = oreToDecimal(r.ore_fatte || 0);
    if(!fascia || ore <= 0) return;
    const curr = riepilogo.get(fascia) || {
      fascia_trasferta: fascia,
      giorni: 0,
      indennita_giornaliera_chf: tpImportoTrasfertaPerFascia(fascia, trasferteOriginali),
      totale_chf: 0
    };
    curr.giorni += 1;
    curr.totale_chf = Math.round((curr.giorni * numberOrZero(curr.indennita_giornaliera_chf)) * 100) / 100;
    riepilogo.set(fascia, curr);
  });

  return {rows: rowsCorrette, trasferte: Array.from(riepilogo.values())};
}


// FIX split giornata: se la stessa data e divisa su piu cantieri/lavorazioni,
// nella stampa collaboratore deve contare come 1 solo giorno lavorato.
function tpGiornoKeyRiepilogo(r){
  if(r && r.data) return String(r.data).slice(0,10);
  const a = String(r?.anno || v16MeseInfo?.anno || '');
  const m = String(r?.mese || v16MeseInfo?.mese || '').padStart(2,'0');
  const g = String(r?.giorno || '').padStart(2,'0');
  return `${a}-${m}-${g}`;
}
function tpRiepilogoGiorniUnici(rows, rie){
  if(!rie) return rie;
  const out = Object.assign({}, rie);
  const lavorati = new Set();
  const avsSi = new Set();
  const avsNo = new Set();
  const trasferta = new Set();
  (rows || []).forEach(r=>{
    const key = tpGiornoKeyRiepilogo(r);
    if(!key || key.includes('undefined')) return;
    const oreFatte = oreToDecimal(r.ore_fatte || 0);
    if(oreFatte > 0) lavorati.add(key);
    const avs = String(r.avs_testo || '').toLowerCase();
    if(oreFatte > 0 && avs.includes('si')) avsSi.add(key);
    if(oreFatte > 0 && avs.includes('sì')) avsSi.add(key);
    if(oreFatte > 0 && avs.includes('no')) avsNo.add(key);
    if(oreFatte > 0 && r.fascia_trasferta) trasferta.add(key);
  });
  out.giorni_lavorati = lavorati.size;
  out.giorni_avs_si = avsSi.size;
  out.giorni_avs_no = avsNo.size;
  if(trasferta.size) out.giorni_trasferta = trasferta.size;
  return out;
}

function tpApplicaRegoleMeseAllaStampa(rows, rie, regolaMese, calendarioRows){
  const calMap = new Map((calendarioRows || []).map(g => [String(g.data || '').slice(0,10), g]));
  const rowsOut = (rows || []).map(r => {
    const key = tpGiornoKeyRiepilogo(r);
    const cal = calMap.get(key);
    if(!cal) return r;
    return Object.assign({}, r, {
      ore_da_fare: cal.ore_previste,
      ora_inizio: r.ora_inizio || cal.ora_inizio,
      pausa_inizio: r.pausa_inizio || cal.pausa_inizio,
      pausa_fine: r.pausa_fine || cal.pausa_fine,
      ora_fine: r.ora_fine || cal.ora_fine,
      tipo_giorno_stampa: r.tipo_giorno_stampa || cal.tipo_giorno
    });
  });
  const rieOut = rie ? Object.assign({}, rie) : rie;
  if(rieOut && regolaMese && regolaMese.ore_previste_mese !== null && regolaMese.ore_previste_mese !== undefined && String(regolaMese.ore_previste_mese) !== ''){
    const ufficiale = oreToDecimal(regolaMese.ore_previste_mese);
    rieOut.totale_ore_da_fare = ufficiale;
    const fatte = oreToDecimal(rieOut.totale_ore_fatte || 0);
    const approvate = oreToDecimal(rieOut.totale_ore_vacanza_approvate || 0);
    const richiesteOre = oreToDecimal(rieOut.totale_ore_richieste_a_ore || 0);
    rieOut.carenza_ore = Math.max(0, Math.round((ufficiale - fatte - approvate - richiesteOre) * 100) / 100);
  }
  return {rows: rowsOut, rie: rieOut};
}

function renderPrintRuleText(regolaMese){
  if(!regolaMese) return '<li>Nessuna regola mensile disponibile.</li>';
  const avs = regolaMese.avs_regola_km_attiva
    ? `AVS ${regolaMese.avs_entro_km ? 'sì' : 'no'} entro ${fmt(regolaMese.avs_km_limite)} km; AVS ${regolaMese.avs_fuori_km ? 'sì' : 'no'} oltre ${fmt(regolaMese.avs_km_limite)} km.`
    : 'Regola AVS su km non attiva.';
  const ore = `Ore previste mese: ${fmt(regolaMese.ore_previste_mese)} · Ore previste giorno: ${fmt(regolaMese.ore_previste_giorno)} · Giorni lavorativi: ${fmt(regolaMese.giorni_lavorativi)}.`;
  const nota = regolaMese.note ? `<li>${escapeHtml(regolaMese.note)}</li>` : '';
  return `<li>${avs}</li><li>${ore}</li>${nota}`;
}
function renderPrintableMonthlyReport(collabId, anno, mese, rows, rie, trasferte, regolaMese){
  const target = $('adminPrintReport');
  if(!target) return;
  const rieCorretto = tpRiepilogoGiorniUnici(rows, rie);
  const collab = (cache.collab || []).find(c => String(c.id) === String(collabId)) || {};
  const nomeCompleto = `${collab.cognome || ''} ${collab.nome || ''}`.trim() || 'Collaboratore';
  const reparto = collab.reparto || 'Gesso / Costruzione a secco';
  const richiestaOreTot = oreToDecimal(rieCorretto?.totale_ore_richieste_a_ore) + oreToDecimal(rieCorretto?.totale_ore_vacanza_richieste);
  const mapTrasferte = new Map((trasferte || []).map(x => [x.fascia_trasferta, x]));
  const fasceOrd = ['Percorso stradale 0 - 30 km','Percorso stradale 31 - 40 km','Percorso stradale 41 - 60 km','Percorso stradale oltre 60 km'];
  const trasferteRows = fasceOrd.map(f => mapTrasferte.get(f) || {fascia_trasferta:f,giorni:0,totale_chf:0});
  const totaleTrasf = trasferteRows.reduce((s,x)=>s + numberOrZero(x.totale_chf), 0);
  const meseLabel = `${monthName(mese)} ${anno}`;
  const logoUrl = 'https://tecnoplafon.ch/wp-content/uploads/2019/08/TECNOPLAFON-logo_v01.png';
  target.classList.remove('hidden');
  target.innerHTML = `
    <style>
      .tp-monthly-print{background:#fff;color:#10213f;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,Arial,sans-serif;}
      .tp-monthly-print .tp-sheet{border:1px solid #d9e3f0;border-radius:18px;padding:16px 16px 12px;background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%);box-shadow:0 8px 20px rgba(8,43,99,.05);}
      .tp-monthly-print .tp-top{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:center;padding-bottom:10px;border-bottom:4px solid #082b63;}
      .tp-monthly-print .tp-brand{display:flex;align-items:center;gap:14px;min-width:0;}
      .tp-monthly-print .tp-logo-box{display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #d6dfec;border-radius:14px;padding:10px 14px;min-height:74px;min-width:255px;}
      .tp-monthly-print .tp-logo-box img{max-width:250px;width:100%;height:auto;display:block;}
      .tp-monthly-print .tp-brand-text{min-width:0;}
      .tp-monthly-print .tp-brand-title{font-size:14px;font-weight:900;color:#082b63;letter-spacing:.02em;}
      .tp-monthly-print .tp-brand-sub{font-size:10px;color:#6b7280;letter-spacing:.24em;text-transform:uppercase;margin-top:3px;}
      .tp-monthly-print .tp-doc-title{text-align:center;}
      .tp-monthly-print .tp-doc-title h1{margin:0;font-size:24px;line-height:1.02;color:#082b63;letter-spacing:-.03em;}
      .tp-monthly-print .tp-doc-title p{margin:2px 0 0;font-size:14px;font-weight:700;color:#475569;}
      .tp-monthly-print .tp-company{display:flex;justify-content:flex-end;}
      .tp-monthly-print .tp-company-card{background:#f7faff;border:1px solid #d9e3f0;border-radius:14px;padding:10px 12px;text-align:right;font-size:11px;line-height:1.45;color:#082b63;min-width:200px;}
      .tp-monthly-print .tp-company-card b{display:block;font-size:13px;margin-bottom:2px;}
      .tp-monthly-print .tp-meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:12px 0 10px;}
      .tp-monthly-print .tp-meta-card{background:#f8fbff;border:1px solid #dce5f0;border-radius:13px;padding:10px 12px;}
      .tp-monthly-print .tp-meta-card span{display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
      .tp-monthly-print .tp-meta-card b{display:block;font-size:18px;line-height:1.1;color:#082b63;}
      .tp-monthly-print .tp-hours-table{width:100%;border-collapse:collapse;border-spacing:0;font-size:11px;table-layout:fixed;}
      .tp-monthly-print .tp-hours-table th{background:#082b63;color:#fff;padding:7px 6px;border:1px solid #d6dfec;font-size:10px;line-height:1.05;text-transform:uppercase;letter-spacing:.03em;}
      .tp-monthly-print .tp-hours-table td{padding:6px;border:1px solid #d6dfec;vertical-align:top;line-height:1.12;}
      .tp-monthly-print .tp-hours-table th:nth-child(1), .tp-monthly-print .tp-hours-table td:nth-child(1){width:11%;}
      .tp-monthly-print .tp-hours-table th:nth-child(2), .tp-monthly-print .tp-hours-table td:nth-child(2){width:8%;}
      .tp-monthly-print .tp-hours-table th:nth-child(3), .tp-monthly-print .tp-hours-table td:nth-child(3){width:14%;}
      .tp-monthly-print .tp-hours-table th:nth-child(4), .tp-monthly-print .tp-hours-table td:nth-child(4){width:6%;}
      .tp-monthly-print .tp-hours-table th:nth-child(5), .tp-monthly-print .tp-hours-table td:nth-child(5){width:12%;}
      .tp-monthly-print .tp-hours-table th:nth-child(6), .tp-monthly-print .tp-hours-table td:nth-child(6){width:12%;}
      .tp-monthly-print .tp-hours-table th:nth-child(7), .tp-monthly-print .tp-hours-table td:nth-child(7),
      .tp-monthly-print .tp-hours-table th:nth-child(8), .tp-monthly-print .tp-hours-table td:nth-child(8),
      .tp-monthly-print .tp-hours-table th:nth-child(9), .tp-monthly-print .tp-hours-table td:nth-child(9),
      .tp-monthly-print .tp-hours-table th:nth-child(10), .tp-monthly-print .tp-hours-table td:nth-child(10),
      .tp-monthly-print .tp-hours-table th:nth-child(11), .tp-monthly-print .tp-hours-table td:nth-child(11),
      .tp-monthly-print .tp-hours-table th:nth-child(12), .tp-monthly-print .tp-hours-table td:nth-child(12),
      .tp-monthly-print .tp-hours-table th:nth-child(13), .tp-monthly-print .tp-hours-table td:nth-child(13){width:6.2%;}
      .tp-monthly-print .tp-hours-table tbody tr:nth-child(even) td{background:#fbfdff;}
      .tp-monthly-print .tp-hours-table tbody tr.is-weekend td{background:#fff3f3;color:#a61b29;font-weight:700;}
      .tp-monthly-print .tp-hours-table tbody tr.is-holiday td{background:#eefaf1;color:#166534;font-weight:700;}
      .tp-monthly-print .tp-hours-table tbody tr.is-vac-richiesta td,.tp-monthly-print .tp-hours-table tbody tr.is-vac-approvata td{background:#eef8ff;color:#0f4c81;font-weight:700;}
      .tp-monthly-print .tp-num{text-align:right;white-space:nowrap;}
      .tp-monthly-print .tp-bottom{display:grid;grid-template-columns:1.2fr .92fr .88fr;gap:10px;margin-top:12px;}
      .tp-monthly-print .tp-panel{border:1px solid #dce5f0;border-radius:14px;overflow:hidden;background:#fff;}
      .tp-monthly-print .tp-panel-title{background:#082b63;color:#fff;padding:8px 10px;font-size:11px;font-weight:900;text-align:center;letter-spacing:.06em;}
      .tp-monthly-print .tp-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);}
      .tp-monthly-print .tp-summary-item{padding:10px 8px;border-right:1px solid #e3eaf4;border-bottom:1px solid #e3eaf4;text-align:center;}
      .tp-monthly-print .tp-summary-item:nth-child(4n){border-right:0;}
      .tp-monthly-print .tp-summary-item span{display:block;font-size:10px;color:#64748b;line-height:1.15;min-height:24px;}
      .tp-monthly-print .tp-summary-item b{display:block;margin-top:4px;font-size:18px;color:#082b63;}
      .tp-monthly-print .tp-small-table{width:100%;border-collapse:collapse;font-size:11px;}
      .tp-monthly-print .tp-small-table th,.tp-monthly-print .tp-small-table td{border:1px solid #dce5f0;padding:7px 8px;}
      .tp-monthly-print .tp-small-table th{background:#f4f8fd;color:#082b63;font-size:10px;text-transform:uppercase;letter-spacing:.03em;}
      .tp-monthly-print .tp-small-table tr.total td{background:#eef4fb;font-weight:900;}
      .tp-monthly-print .tp-rules{margin:8px 14px 12px;padding-left:16px;font-size:11px;line-height:1.35;}
      .tp-monthly-print .tp-signatures{display:grid;grid-template-columns:2fr 1fr 2fr 1fr;gap:14px;margin-top:12px;font-size:11px;color:#082b63;font-weight:700;}
      .tp-monthly-print .tp-signatures span{display:block;height:24px;border-bottom:1.6px solid #8aa0bf;margin-top:10px;}
      @media print{
        .tp-monthly-print .tp-sheet{box-shadow:none;border:0;padding:0;}
      }
    </style>
    <div class="print-sheet tp-monthly-print">
      <div class="tp-sheet">
        <div class="tp-top">
          <div class="tp-brand">
            <div class="tp-logo-box"><img src="${logoUrl}" alt="Logo Tecnoplafon"></div>
            <div class="tp-brand-text">
              <div class="tp-brand-title">Tecnoplafon SA</div>
              <div class="tp-brand-sub">Soluzioni in costruzione a secco</div>
            </div>
          </div>
          <div class="tp-company">
            <div>
              <div class="tp-doc-title">
                <h1>Stampa mensile collaboratore</h1>
                <p>${escapeHtml(meseLabel)}</p>
              </div>
              <div class="tp-company-card" style="margin-top:10px;">
                <b>Tecnoplafon SA</b>
                <div>Via Industrie 10</div>
                <div>6930 Bedano</div>
                <div>+41 91 850 20 20</div>
                <div>www.tecnoplafon.ch</div>
              </div>
            </div>
          </div>
        </div>

        <div class="tp-meta">
          <div class="tp-meta-card"><span>Collaboratore</span><b>${escapeHtml(nomeCompleto)}</b></div>
          <div class="tp-meta-card"><span>Mese</span><b>${escapeHtml(meseLabel)}</b></div>
          <div class="tp-meta-card"><span>Reparto</span><b>${escapeHtml(reparto)}</b></div>
        </div>

        <table class="print-calendar-table tp-hours-table">
          <thead>
            <tr>
              <th>Giorno</th><th>Tipo</th><th>Cantiere</th><th>Km</th><th>Lavorazione</th><th>Sotto-lavorazione</th><th>Inizio</th><th>Pausa</th><th>Fine</th><th>Da fare</th><th>Fatte</th><th>Richiesta</th><th>AVS</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r=>{
              const richiestaTxt = numberOrZero(r.ore_richiesta_a_ore) > 0
                ? `${fmtOre(r.ore_richiesta_a_ore)} h`
                : numberOrZero(r.ore_vacanza_richieste) > 0
                  ? `${fmtOre(r.ore_vacanza_richieste)} h vac.`
                  : numberOrZero(r.ore_vacanza_approvate) > 0
                    ? `${fmtOre(r.ore_vacanza_approvate)} h vac.`
                    : '-';
              return `<tr class="${rowPrintClass(r)}">
                <td>${String(r.giorno).padStart(2,'0')} ${escapeHtml(r.giorno_settimana||'')}</td>
                <td>${safe(r.tipo_giorno_stampa)}</td>
                <td>${safe(r.cantiere)}</td>
                <td class="tp-num">${r.km==null ? '-' : fmt(r.km)+' km'}</td>
                <td>${safe(r.lavorazione)}</td>
                <td>${safe(r.sotto_lavorazione)}</td>
                <td>${safe(r.ora_inizio)}</td>
                <td>${timeSpan(r)}</td>
                <td>${safe(r.ora_fine)}</td>
                <td class="tp-num">${fmtOre(r.ore_da_fare)}</td>
                <td class="tp-num">${fmtOre(r.ore_fatte)}</td>
                <td>${richiestaTxt}</td>
                <td>${safe(r.avs_testo)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>

        <div class="tp-bottom">
          <div class="tp-panel">
            <div class="tp-panel-title">Riepilogo mensile</div>
            <div class="tp-summary-grid">
              <div class="tp-summary-item"><span>Totale ore fatte</span><b>${fmt(rieCorretto?.totale_ore_fatte)}</b></div>
              <div class="tp-summary-item"><span>Totale ore da fare</span><b>${fmt(rieCorretto?.totale_ore_da_fare)}</b></div>
              <div class="tp-summary-item"><span>Carenza ore</span><b class="orange">${fmt(rieCorretto?.carenza_ore)}</b></div>
              <div class="tp-summary-item"><span>Giorni lavorati</span><b>${fmt(rieCorretto?.giorni_lavorati)}</b></div>
              <div class="tp-summary-item"><span>Giorni AVS sì</span><b class="green">${fmt(rieCorretto?.giorni_avs_si)}</b></div>
              <div class="tp-summary-item"><span>Giorni AVS no</span><b class="red">${fmt(rieCorretto?.giorni_avs_no)}</b></div>
              <div class="tp-summary-item"><span>Ore richieste</span><b>${fmt(richiestaOreTot)}</b></div>
              <div class="tp-summary-item"><span>Ore approvate</span><b class="green">${fmt(rieCorretto?.totale_ore_vacanza_approvate)}</b></div>
            </div>
          </div>
          <div class="tp-panel">
            <div class="tp-panel-title">Riepilogo trasferte</div>
            <table class="print-small-table tp-small-table">
              <tr><th>Fascia km</th><th>Giorni</th><th>Totale</th></tr>
              ${trasferteRows.map(x=>`<tr><td>${escapeHtml((x.fascia_trasferta||'').replace('Percorso stradale ',''))}</td><td class="tp-num">${fmt(x.giorni)}</td><td class="tp-num">CHF ${fmt(x.totale_chf)}</td></tr>`).join('')}
              <tr class="total"><td>TOTALE COMPLESSIVO</td><td class="tp-num">${fmt((rieCorretto?.giorni_trasferta)||0)}</td><td class="tp-num">CHF ${fmt(totaleTrasf)}</td></tr>
            </table>
          </div>
          <div class="tp-panel">
            <div class="tp-panel-title">Regole mese</div>
            <ul class="print-rules-list tp-rules">${renderPrintRuleText(regolaMese)}</ul>
          </div>
        </div>

        <div class="tp-signatures print-signatures">
          <div>Firma collaboratore <span></span></div>
          <div>Data <span></span></div>
          <div>Firma admin / ditta <span></span></div>
          <div>Data <span></span></div>
        </div>
      </div>
    </div>`;
}

// Sincronizzazione automatica Supporto Cantieri quando l'admin inserisce/modifica/annulla ore.
// Correzione mirata: aggiorna la tabella supporto_cantieri_state dopo ogni correzione admin,
// cosi la Gestione Cantieri non mantiene la vecchia lavorazione/vecchie ore.
function tpSupportoNormTipo(v){
  const s = String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  // IMPORTANTE: controllare prima "costruzione a secco/cartongesso".
  // Se dal gestionale arriva "costruzione a gesso" o una scritta simile,
  // deve andare in COSTRUZIONE A SECCO e non nella categoria Gesso.
  if(
    s.includes('costruzione a secco') ||
    s.includes('costruzioni a secco') ||
    s.includes('costruzione secco') ||
    s.includes('costruzione a gesso') ||
    s.includes('costruzioni a gesso') ||
    s.includes('cartongesso') ||
    s.includes('lastr') ||
    s.includes('parete') ||
    s.includes('controsoffitto') ||
    s.includes('soffitto')
  ) return 'cartongesso';

  if(s.includes('intonaco')) return 'intonaco';
  if(s.includes('gesso') || s.includes('rasatura') || s.includes('stabilitura')) return 'gesso';
  if(s.includes('isol') || s.includes('cappotto') || s.includes('lana') || s.includes('eps')) return 'isolazione';
  if(s.includes('pitt') || s.includes('imbianc') || s.includes('vernice') || s.includes('colore')) return 'pittura';
  if(s.includes('artigiani') || s.includes('subappalto') || s.includes('elettric') || s.includes('idraul')) return 'artigiani';
  if(s.includes('dividere') || s.includes('ripartire')) return 'dividere';
  return 'altro';
}
function tpSupportoNomeCantiere(r){
  const c = r && r.cantieri ? r.cantieri : {};
  return String(`${c.codice || ''} ${c.nome || ''}`.trim() || r?.cantiere || '').trim();
}
function tpSupportoNomeOperaio(r){
  const c = r && r.collaboratori ? r.collaboratori : {};
  return String(`${c.cognome || ''} ${c.nome || ''}`.trim() || r?.operaio || '').trim();
}
function tpSupportoDefaultState(){
  return {ore:[], materiali:[], preventivi:{}, costiOra:{}, cantiereAttivo:'', cantieriManuali:[], totaliGenerali:{}, cantieriTerminati:{}};
}
async function tpSincronizzaSupportoCantieriDaGestionale(){
  if(!db) return;
  try{
    const rows = await q(db.from('ore_lavoro')
      .select('id,data,ore_totali,note,stato,cantieri(codice,nome),collaboratori(nome,cognome),lavorazioni(nome)')
      .neq('stato','annullato')
      .order('data',{ascending:true})
      .limit(5000));

    let rec = null;
    try{
      rec = await q(db.from('supporto_cantieri_state').select('stato').eq('id','tecnoplafon_main').maybeSingle());
    }catch(e){
      console.warn('Supporto cantieri non disponibile:', e);
      return;
    }

    const stato = (rec && rec.stato && typeof rec.stato === 'object') ? rec.stato : tpSupportoDefaultState();
    if(!Array.isArray(stato.ore)) stato.ore = [];
    if(!Array.isArray(stato.materiali)) stato.materiali = [];
    if(!Array.isArray(stato.cantieriManuali)) stato.cantieriManuali = [];
    if(!stato.preventivi || typeof stato.preventivi !== 'object') stato.preventivi = {};
    if(!stato.costiOra || typeof stato.costiOra !== 'object') stato.costiOra = {};
    if(!stato.totaliGenerali || typeof stato.totaliGenerali !== 'object') stato.totaliGenerali = {};
    if(!stato.cantieriTerminati || typeof stato.cantieriTerminati !== 'object') stato.cantieriTerminati = {};

    const nuoveOre = [];
    rows.forEach(r=>{
      const cantiere = tpSupportoNomeCantiere(r);
      const operaio = tpSupportoNomeOperaio(r);
      const ore = oreToDecimal(r.ore_totali || 0);
      const tipo = tpSupportoNormTipo(r.lavorazioni && r.lavorazioni.nome ? r.lavorazioni.nome : 'altro');
      if(cantiere && operaio && ore > 0){
        if(!stato.cantieriManuali.includes(cantiere)) stato.cantieriManuali.push(cantiere);
        nuoveOre.push({
          data: r.data || todayISO(),
          cantiere,
          operaio,
          tipo,
          ore,
          origine: 'gestionale_ore',
          id_ore_lavoro: r.id || ''
        });
      }
    });

    stato.ore = stato.ore.filter(x => x.origine !== 'gestionale_ore');
    stato.ore.push(...nuoveOre);
    if(!stato.cantiereAttivo && stato.cantieriManuali.length) stato.cantiereAttivo = stato.cantieriManuali[0];

    await q(db.from('supporto_cantieri_state').upsert({
      id:'tecnoplafon_main',
      stato,
      updated_at:new Date().toISOString()
    }, {onConflict:'id'}));
  }catch(e){
    console.warn('Sincronizzazione Supporto Cantieri non riuscita:', e);
  }
}
window.tpSincronizzaSupportoCantieriDaGestionale = tpSincronizzaSupportoCantieriDaGestionale;


// Modalita semplice admin: nessun pulsante split separato.
// Il pulsante principale "Salva ore come admin" aggiunge una nuova riga se cambia
// cantiere/lavorazione/sotto-lavorazione, oppure aggiorna la riga esistente
// se trova la stessa combinazione. Le righe gia presenti si modificano dalla lista sotto.
function installAdminSplitOreButton(){ return; }
window.installAdminSplitOreButton = installAdminSplitOreButton;

async function adminSalvaOre(){
  try{
    const row={
      collaboratore_id:$('admOreCollab').value,
      cantiere_id:$('admOreCantiere').value,
      lavorazione_id:$('admOreLav').value,
      sotto_lavorazione_id:$('admOreSotto').value,
      data:$('admOreData').value,
      ore_totali:oreToDecimal($('admOreTot').value),
      note:$('admOreNote').value,
      created_by:'admin'
    };
    if(!row.collaboratore_id || !row.cantiere_id || !row.lavorazione_id || !row.sotto_lavorazione_id || !row.data || !row.ore_totali){
      msg($('admOreMsg'),'Compila collaboratore, data, cantiere, lavorazione, sotto-lavorazione e ore.', 'error');
      return;
    }

    // Comportamento unico, senza pulsante split:
    // - se esiste gia una riga con stesso collaboratore + data + cantiere + lavorazione + sotto-lavorazione,
    //   aggiorna quella riga senza sommare;
    // - se non esiste quella combinazione, aggiunge una nuova riga per dividere la giornata
    //   su un altro cantiere o un'altra lavorazione.
    // Le modifiche puntuali alle righe gia presenti si fanno nella lista sotto con il pulsante "Salva".
    const same = await q(db.from('ore_lavoro')
      .select('id,created_at')
      .eq('collaboratore_id', row.collaboratore_id)
      .eq('data', row.data)
      .eq('cantiere_id', row.cantiere_id)
      .eq('lavorazione_id', row.lavorazione_id)
      .eq('sotto_lavorazione_id', row.sotto_lavorazione_id)
      .neq('stato','annullato')
      .order('created_at', {ascending:true}));

    if(same.length){
      const primaryId = same[0].id;
      const duplicateIds = same.slice(1).map(r=>r.id).filter(Boolean);
      await q(db.from('ore_lavoro').update({
        ore_totali: row.ore_totali,
        note: row.note,
        created_by: row.created_by,
        updated_at: new Date().toISOString()
      }).eq('id', primaryId));
      if(duplicateIds.length){
        await q(db.from('ore_lavoro').update({
          stato:'annullato',
          updated_at:new Date().toISOString()
        }).in('id', duplicateIds));
      }
      await tpSincronizzaSupportoCantieriDaGestionale();
      msg($('admOreMsg'),'Riga esistente aggiornata senza sommare ore e sincronizzata nei cantieri.');
    } else {
      await q(db.from('ore_lavoro').insert(row));
      await tpSincronizzaSupportoCantieriDaGestionale();
      msg($('admOreMsg'),'Nuova lavorazione/cantiere aggiunta alla giornata e sincronizzata nei cantieri.');
    }

    if($('admOreTot')) $('admOreTot').value='';
    if($('admOreNote')) $('admOreNote').value='';
    await caricaDashboard();
    await caricaOreAdminCollaboratore();
  }catch(e){ msg($('admOreMsg'),e.message,'error');}
}
window.adminSalvaOre=adminSalvaOre;

function optionsCantieriAdmin(selected){
  return '<option value="">Scegli...</option>' + (cache.cantieri||[])
    .filter(c=>c.stato==='attivo')
    .map(c=>`<option value="${c.id}" ${String(c.id)===String(selected)?'selected':''}>${escapeHtml(c.codice||'')} ${escapeHtml(c.nome||'')}</option>`)
    .join('');
}
function optionsLavorazioniAdmin(selected){
  return '<option value="">Scegli...</option>' + (cache.lavorazioni||[])
    .filter(l=>l.stato==='attivo')
    .map(l=>`<option value="${l.id}" ${String(l.id)===String(selected)?'selected':''}>${escapeHtml(l.nome||'')}</option>`)
    .join('');
}
function optionsSottoAdmin(lavorazioneId, selected){
  return '<option value="">Scegli...</option>' + (cache.sotto||[])
    .filter(s=>String(s.lavorazione_id)===String(lavorazioneId) && s.stato==='attivo')
    .map(s=>`<option value="${s.id}" ${String(s.id)===String(selected)?'selected':''}>${escapeHtml(s.nome||'')}</option>`)
    .join('');
}
function aggiornaSottoRigaOreAdmin(id){
  const lavId = $(`admOreLavEdit_${id}`)?.value || '';
  const sotto = $(`admOreSottoEdit_${id}`);
  if(sotto) sotto.innerHTML = optionsSottoAdmin(lavId, '');
}
window.aggiornaSottoRigaOreAdmin=aggiornaSottoRigaOreAdmin;

async function caricaOreAdminCollaboratore(){
  const box = $('admOreLista');
  if(!box) return;
  try{
    const collabId = $('admOreCollab')?.value;
    const data = $('admOreData')?.value;
    if(!collabId){ box.innerHTML = '<p class="muted">Scegli prima un collaboratore.</p>'; return; }
    if(!data){ box.innerHTML = '<p class="muted">Scegli prima una data.</p>'; return; }

    const rows = await q(db.from('ore_lavoro')
      .select('*,cantieri(codice,nome),lavorazioni(nome),sotto_lavorazioni(nome)')
      .eq('collaboratore_id', collabId)
      .eq('data', data)
      .neq('stato','annullato')
      .order('created_at', {ascending:true}));

    const collab = (cache.collab||[]).find(c=>String(c.id)===String(collabId));
    const nome = collab ? `${collab.cognome} ${collab.nome}` : 'Collaboratore';
    const totale = rows.reduce((s,r)=>s+oreToDecimal(r.ore_totali||0),0);

    if(!rows.length){
      box.innerHTML = `<p class="muted">Nessuna ora inserita per <b>${escapeHtml(nome)}</b> il ${escapeHtml(data)}.</p>`;
      return;
    }

    box.innerHTML = `
      <div class="summary">
        <div class="box"><span>Collaboratore</span><div class="big">${escapeHtml(nome)}</div></div>
        <div class="box"><span>Data</span><div class="big">${escapeHtml(data)}</div></div>
        <div class="box"><span>Totale ore</span><div class="big green">${fmtOre(totale)}</div></div>
        <div class="box"><span>Righe</span><div class="big">${fmt(rows.length)}</div></div>
      </div>
      <table>
        <tr>
          <th>Cantiere / Regia</th><th>Lavorazione</th><th>Sotto-lavorazione</th><th>Ore</th><th>Note</th><th>Azioni</th>
        </tr>
        ${rows.map(r=>`<tr>
          <td><select id="admOreCanEdit_${r.id}">${optionsCantieriAdmin(r.cantiere_id)}</select></td>
          <td><select id="admOreLavEdit_${r.id}" onchange="aggiornaSottoRigaOreAdmin('${r.id}')">${optionsLavorazioniAdmin(r.lavorazione_id)}</select></td>
          <td><select id="admOreSottoEdit_${r.id}">${optionsSottoAdmin(r.lavorazione_id, r.sotto_lavorazione_id)}</select></td>
          <td><input id="admOreEdit_${r.id}" type="number" step="0.25" value="${fmtOre(r.ore_totali)}" style="max-width:110px"></td>
          <td><textarea id="admOreNote_${r.id}" rows="2" placeholder="Note">${escapeHtml(r.note||'')}</textarea></td>
          <td>
            <button onclick="salvaRigaOreAdmin('${r.id}')">Salva</button>
            <button class="secondary" onclick="annullaRigaOreAdmin('${r.id}')">Annulla</button>
          </td>
        </tr>`).join('')}
      </table>`;
  }catch(e){
    box.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}
window.caricaOreAdminCollaboratore=caricaOreAdminCollaboratore;

async function salvaRigaOreAdmin(id){
  try{
    const ore = oreToDecimal($(`admOreEdit_${id}`)?.value || 0);
    const note = $(`admOreNote_${id}`)?.value || '';
    const cantiere_id = $(`admOreCanEdit_${id}`)?.value || null;
    const lavorazione_id = $(`admOreLavEdit_${id}`)?.value || null;
    const sotto_lavorazione_id = $(`admOreSottoEdit_${id}`)?.value || null;
    if(!cantiere_id || !lavorazione_id || !sotto_lavorazione_id || !ore){
      msg($('admOreMsg'),'Compila cantiere/regia, lavorazione, sotto-lavorazione e ore.', 'error');
      return;
    }
    await q(db.from('ore_lavoro').update({cantiere_id, lavorazione_id, sotto_lavorazione_id, ore_totali:ore, note, updated_at:new Date().toISOString()}).eq('id', id));
    await tpSincronizzaSupportoCantieriDaGestionale();
    msg($('admOreMsg'),'Riga ore aggiornata e sincronizzata nei cantieri.');
    await caricaDashboard();
    await caricaOreAdminCollaboratore();
  }catch(e){ msg($('admOreMsg'), e.message, 'error'); }
}
window.salvaRigaOreAdmin=salvaRigaOreAdmin;

async function annullaRigaOreAdmin(id){
  if(!confirm('Vuoi annullare questa riga ore?')) return;
  try{
    await q(db.from('ore_lavoro').update({stato:'annullato', updated_at:new Date().toISOString()}).eq('id', id));
    await tpSincronizzaSupportoCantieriDaGestionale();
    msg($('admOreMsg'),'Riga ore annullata e sincronizzata nei cantieri.');
    await caricaDashboard();
    await caricaOreAdminCollaboratore();
  }catch(e){ msg($('admOreMsg'), e.message, 'error'); }
}
window.annullaRigaOreAdmin=annullaRigaOreAdmin;

async function caricaRichiesteAdmin(){
  const rows=await q(db.from('richieste_congedo').select('*,collaboratori(nome,cognome)').order('created_at',{ascending:false}));
  $('adminRichiesteBox').innerHTML = rows.length ? `<table><tr><th>Collaboratore</th><th>Tipo</th><th>Da</th><th>A</th><th>Ore</th><th>Stato</th><th>Note</th><th>Azioni</th></tr>`+
    rows.map(r=>`<tr><td>${escapeHtml(r.collaboratori?.cognome||'')} ${escapeHtml(r.collaboratori?.nome||'')}</td><td>${escapeHtml(r.tipo)}</td><td>${r.data_inizio}</td><td>${r.data_fine}</td><td>${r.giornata_intera?'giornata':fmtOre(r.ore_richieste)}</td><td>${badgeStato(r.stato)}</td><td>${escapeHtml(r.note||'')}</td><td><button onclick="setRichiesta('${r.id}','approvata')">Approva</button> <button class="secondary" onclick="setRichiesta('${r.id}','rifiutata')">Rifiuta</button></td></tr>`).join('')+'</table>' : '<p>Nessuna richiesta.</p>';
}
window.caricaRichiesteAdmin=caricaRichiesteAdmin;
async function setRichiesta(id, stato){
  await q(db.from('richieste_congedo').update({stato, data_risposta:new Date().toISOString(), approvato_da:session.user.nome}).eq('id',id));
  await caricaRichiesteAdmin(); await caricaDashboard();
}
window.setRichiesta=setRichiesta;

function renderAnagrafiche(){
  const statoBadge = stato => {
    const s = String(stato || 'attivo');
    const cls = s === 'attivo' ? 'green' : 'red';
    return `<span class="badge ${cls}">${escapeHtml(s)}</span>`;
  };

  $('collabTable').innerHTML=`<table><tr><th>Collaboratore</th><th>Password</th><th>Stato</th><th>Azioni</th></tr>${cache.collab.map(c=>{
    const attivo = c.stato === 'attivo';
    return `<tr><td>${escapeHtml(c.cognome)} ${escapeHtml(c.nome)}</td><td>${escapeHtml(c.password_accesso||'')}</td><td>${statoBadge(c.stato)}</td><td><button class="${attivo ? 'secondary' : ''}" onclick="setCollaboratoreStato('${c.id}','${attivo ? 'terminato' : 'attivo'}')">${attivo ? 'Disattiva' : 'Attiva'}</button></td></tr>`;
  }).join('')}</table>`;

  $('cantieriTable').innerHTML=`<table><tr><th>ID</th><th>Cantiere</th><th>Località</th><th>Km</th><th>Stato</th><th>Azioni</th></tr>${cache.cantieri.map(c=>{
    const attivo = c.stato === 'attivo';
    return `<tr><td>${c.codice}</td><td>${escapeHtml(c.nome)}</td><td>${escapeHtml(c.localita||'')}</td><td>${fmt(c.km)}</td><td>${statoBadge(c.stato)}</td><td><button class="${attivo ? 'secondary' : ''}" onclick="setCantiereStato('${c.id}','${attivo ? 'terminato' : 'attivo'}')">${attivo ? 'Disattiva' : 'Attiva'}</button></td></tr>`;
  }).join('')}</table>`;
}

async function setCollaboratoreStato(id, stato){
  try{
    await q(db.from('collaboratori').update({stato}).eq('id', id));
    await loadBase();
    renderAnagrafiche();
    aggiornaFiltriAdminSafe();
    await caricaDashboard();
  }catch(e){
    msg($('newColMsg'), e.message, 'error');
  }
}

async function setCantiereStato(id, stato){
  try{
    await q(db.from('cantieri').update({stato}).eq('id', id));
    await loadBase();
    renderAnagrafiche();
    aggiornaFiltriAdminSafe();
    await caricaDashboard();
  }catch(e){
    msg($('newCanMsg'), e.message, 'error');
  }
}

window.setCollaboratoreStato = setCollaboratoreStato;
window.setCantiereStato = setCantiereStato;
async function creaCollaboratore(){
  try{ await q(db.from('collaboratori').insert({nome:$('newColNome').value,cognome:$('newColCognome').value,password_accesso:$('newColPass').value,stato:$('newColStato').value})); msg($('newColMsg'),'Collaboratore creato.'); await loadBase(); renderAnagrafiche(); }catch(e){ msg($('newColMsg'),e.message,'error');}
}
async function creaCantiere(){
  try{ await q(db.from('cantieri').insert({nome:$('newCanNome').value,localita:$('newCanLocalita').value,cliente:$('newCanCliente').value,km:Number($('newCanKm').value||0),stato:$('newCanStato').value})); msg($('newCanMsg'),'Cantiere creato.'); await loadBase(); renderAnagrafiche(); await caricaDashboard(); }catch(e){ msg($('newCanMsg'),e.message,'error');}
}
window.creaCollaboratore=creaCollaboratore; window.creaCantiere=creaCantiere;

function renderLavorazioni(){
  const grouped=cache.lavorazioni.map(l=>({l,s:cache.sotto.filter(s=>s.lavorazione_id===l.id)}));
  $('lavTable').innerHTML=`<table><tr><th>Lavorazione</th><th>Stato</th><th>Sotto-lavorazioni</th></tr>${grouped.map(g=>`<tr><td>${escapeHtml(g.l.nome)}</td><td>${g.l.stato}</td><td>${g.s.map(s=>escapeHtml(s.nome)).join(', ')}</td></tr>`).join('')}</table>`;
}
async function creaLavorazione(){ try{ await q(db.from('lavorazioni').insert({nome:$('newLavNome').value,stato:'attivo'})); msg($('newLavMsg'),'Lavorazione creata.'); await loadBase(); renderLavorazioni(); fillSelect($('newSottoLav'), cache.lavorazioni.filter(l=>l.stato==='attivo'), r=>r.nome); }catch(e){ msg($('newLavMsg'),e.message,'error');}}
async function creaSottoLavorazione(){ try{ await q(db.from('sotto_lavorazioni').insert({lavorazione_id:$('newSottoLav').value,nome:$('newSottoNome').value,stato:'attivo'})); msg($('newSottoMsg'),'Sotto-lavorazione creata.'); await loadBase(); renderLavorazioni(); }catch(e){ msg($('newSottoMsg'),e.message,'error');}}
window.creaLavorazione=creaLavorazione; window.creaSottoLavorazione=creaSottoLavorazione;


async function caricaRegolaGiorno(){
  try{
    const data = $('regData').value;
    if(!data) return;
    const r = await q(db.from('calendario_giorni').select('*').eq('data',data).maybeSingle());
    if(!r){ msg($('regMsg'),'Giorno non trovato nel calendario. Crea prima il calendario anno.','error'); return; }
    $('regTipo').value = r.tipo_giorno || 'lavorativo';
    $('regNomeFestivo').value = r.nome_festivo || '';
    $('regInizio').value = (r.ora_inizio || '').slice(0,5);
    $('regPausaInizio').value = (r.pausa_inizio || '').slice(0,5);
    $('regPausaFine').value = (r.pausa_fine || '').slice(0,5);
    $('regFine').value = (r.ora_fine || '').slice(0,5);
    $('regOre').value = r.ore_previste ?? 0;
    $('regConsenti').checked = !!r.consenti_inserimento_ore;
    $('regMaxOre').value = r.max_ore_inseribili ?? 0;
    $('regNote').value = r.note || '';
    msg($('regMsg'),'Regola giorno caricata.');
  }catch(e){ msg($('regMsg'),e.message,'error'); }
}
window.caricaRegolaGiorno=caricaRegolaGiorno;

function nullIfEmpty(v){ return v==='' ? null : v; }
function timeOrNull(id){ const v = String(getVal(id,'') || '').trim(); return v ? v : null; }
function timeOrDefault(id, fallback){ const v = String(getVal(id,'') || '').trim(); return v || fallback; }

function el(id){ return document.getElementById(id); }
function getVal(id, fallback=''){
  const x = el(id);
  return x ? x.value : fallback;
}
function setVal(id, value){
  const x = el(id);
  if(x) x.value = value ?? '';
}
function getChecked(id){
  const x = el(id);
  return !!(x && x.checked);
}
function setChecked(id, value){
  const x = el(id);
  if(x) x.checked = !!value;
}
function requireRegoleHtml(){
  // Compatibilita: se admin.html e ancora quello vecchio, creiamo i campi mancanti nascosti.
  // Cosi l'admin puo salvare e applicare le ore mensili senza dover cambiare altri file.
  const defaults = {
    regOreLunGio: getVal('regMeseOreGiorno','8.00') || '8.00',
    regOreVenerdi: getVal('regMeseOreGiorno','8.00') || '8.00',
    regOrePrefestivo: getVal('regMeseOreGiorno','8.00') || '8.00',
    regOraInizioDefault: getVal('regInizio','07:30') || '07:30',
    regPausaInizioDefault: getVal('regPausaInizio','12:00') || '12:00',
    regPausaFineDefault: getVal('regPausaFine','13:00') || '13:00'
  };
  const host = el('tab-regole') || document.body;
  Object.keys(defaults).forEach(id => {
    if(!el(id)){
      const input = document.createElement('input');
      input.type = 'hidden';
      input.id = id;
      input.value = defaults[id];
      host.appendChild(input);
    }
  });
  return true;
}


async function salvaRegolaGiorno(){
  try{
    const data = $('regData').value;
    const anno = Number(data.slice(0,4));
    const mese = Number(data.slice(5,7));
    const row = {
      data,
      anno,
      mese,
      tipo_giorno: $('regTipo').value,
      nome_festivo: nullIfEmpty($('regNomeFestivo').value),
      ora_inizio: nullIfEmpty($('regInizio').value),
      pausa_inizio: nullIfEmpty($('regPausaInizio').value),
      pausa_fine: nullIfEmpty($('regPausaFine').value),
      ora_fine: nullIfEmpty($('regFine').value),
      ore_previste: oreToDecimal($('regOre').value || 0),
      consenti_inserimento_ore: $('regConsenti').checked,
      max_ore_inseribili: oreToDecimal($('regMaxOre').value || 0),
      note: $('regNote').value,
      automatico: false,
      updated_at: new Date().toISOString()
    };
    await q(db.from('calendario_giorni').upsert(row,{onConflict:'data'}));
    msg($('regMsg'),'Regola giorno salvata.');
    await caricaDashboard();
  }catch(e){ msg($('regMsg'),e.message,'error'); }
}
window.salvaRegolaGiorno=salvaRegolaGiorno;

function impostaGiornoLavorativo(){
  $('regTipo').value='lavorativo';
  $('regNomeFestivo').value='';
  $('regInizio').value='07:30';
  $('regPausaInizio').value='12:00';
  $('regPausaFine').value='13:00';
  $('regFine').value='17:00';
  $('regOre').value='8.00';
  $('regConsenti').checked=false;
  $('regMaxOre').value='8.00';
}
window.impostaGiornoLavorativo=impostaGiornoLavorativo;

function impostaGiornoNonLavorativo(){
  $('regTipo').value='giorno_speciale';
  $('regInizio').value='';
  $('regPausaInizio').value='';
  $('regPausaFine').value='';
  $('regFine').value='';
  $('regOre').value='0.00';
  $('regConsenti').checked=false;
  $('regMaxOre').value='0.00';
}
window.impostaGiornoNonLavorativo=impostaGiornoNonLavorativo;

async function caricaRegolaMese(){
  try{
    requireRegoleHtml();
    const anno = Number(getVal('regAnno', new Date().getFullYear()));
    const mese = Number(getVal('regMese', new Date().getMonth()+1));
    const r = await q(db.from('regole_mensili').select('*').eq('anno',anno).eq('mese',mese).maybeSingle());
    if(!r){ msg($('regMeseMsg'),'Regola mese non trovata. Puoi salvarla per crearla.','error'); return; }

    setVal('regMeseGiorni', r.giorni_lavorativi ?? '');
    setVal('regMeseOre', r.ore_previste_mese ?? '');
    setVal('regMeseOreGiorno', r.ore_previste_giorno ?? '');

    setVal('regOrarioTipo', r.orario_tipo || 'normale');
    setVal('regOreLunGio', r.ore_lun_gio ?? '');
    setVal('regOreVenerdi', r.ore_venerdi ?? '');
    setVal('regOrePrefestivo', r.ore_prefestivo ?? '');

    setVal('regOraInizioDefault', (r.ora_inizio_default || '07:30').slice(0,5));
    setVal('regPausaInizioDefault', (r.pausa_inizio_default || '12:00').slice(0,5));
    setVal('regPausaFineDefault', (r.pausa_fine_default || '13:00').slice(0,5));

    setVal('regAvsKm', r.avs_km_limite ?? 10);
    setVal('regAvsPerc', r.avs_percentuale ?? 10.60);
    setChecked('regAvsKmAttiva', !!r.avs_regola_km_attiva);
    setChecked('regAvsEntro', !!r.avs_entro_km);
    setChecked('regAvsFuori', !!r.avs_fuori_km);
    setVal('regMeseNote', r.note || '');

    msg($('regMeseMsg'),'Regola mese caricata.');
  }catch(e){ msg($('regMeseMsg'),e.message,'error'); }
}
window.caricaRegolaMese=caricaRegolaMese;

async function salvaRegolaMese(){
  try{
    if(!requireRegoleHtml()) return;
    const tipo = getVal('regOrarioTipo','normale') || 'normale';
    const row = {
      anno: Number(getVal('regAnno', new Date().getFullYear())),
      mese: Number(getVal('regMese', new Date().getMonth()+1)),
      giorni_lavorativi: Number(getVal('regMeseGiorni',0) || 0),
      ore_previste_mese: oreToDecimal(getVal('regMeseOre',0) || 0),
      ore_previste_giorno: oreToDecimal(getVal('regMeseOreGiorno',0) || 0),
      orario_tipo: tipo,
      orario_estivo_attivo: tipo === 'estivo',
      orario_normale_attivo: tipo === 'normale',
      ore_lun_gio: oreToDecimal(getVal('regOreLunGio',0) || 0),
      ore_venerdi: oreToDecimal(getVal('regOreVenerdi',0) || 0),
      ore_prefestivo: oreToDecimal(getVal('regOrePrefestivo',0) || 0),
      ora_inizio_default: getVal('regOraInizioDefault','07:30') || '07:30',
      pausa_inizio_default: getVal('regPausaInizioDefault','12:00') || '12:00',
      pausa_fine_default: getVal('regPausaFineDefault','13:00') || '13:00',
      avs_km_limite: Number(getVal('regAvsKm',10) || 10),
      avs_percentuale: Number(getVal('regAvsPerc',10.60) || 10.60),
      avs_regola_km_attiva: getChecked('regAvsKmAttiva'),
      avs_entro_km: getChecked('regAvsEntro'),
      avs_fuori_km: getChecked('regAvsFuori'),
      note: getVal('regMeseNote',''),
      updated_at: new Date().toISOString()
    };
    await q(db.from('regole_mensili').upsert(row,{onConflict:'anno,mese'}));
    if(!window.__tpRegoleMeseSalvataggioDaApplica && typeof applicaRegoleOrarieMese === 'function'){
      window.__tpRegoleMeseSalvataggioDaSalva = true;
      try{ await applicaRegoleOrarieMese(); }
      finally{ window.__tpRegoleMeseSalvataggioDaSalva = false; }
    } else {
      msg($('regMeseMsg'),'Regole mese salvate.');
    }
  }catch(e){ msg($('regMeseMsg'),e.message,'error'); }
}
window.salvaRegolaMese=salvaRegolaMese;

function presetOrarioInverno(){
  setVal('regOrarioTipo','normale');
  setVal('regOreLunGio','8.00');
  setVal('regOreVenerdi','7.50');
  setVal('regOrePrefestivo','7.50');
  setVal('regMeseOreGiorno','8.00');
  setVal('regOraInizioDefault','07:30');
  setVal('regPausaInizioDefault','12:00');
  setVal('regPausaFineDefault','13:00');
  msg($('regMeseMsg'),'Preset inverno impostato. Premi Salva regole mese e poi Applica regola ai giorni del mese.');
}
window.presetOrarioInverno=presetOrarioInverno;

function presetOrarioEstivo(){
  setVal('regOrarioTipo','estivo');
  setVal('regOreLunGio','8.50');
  setVal('regOreVenerdi','8.00');
  setVal('regOrePrefestivo','8.00');
  setVal('regMeseOreGiorno','8.50');
  setVal('regOraInizioDefault','07:30');
  setVal('regPausaInizioDefault','12:00');
  setVal('regPausaFineDefault','13:00');
  msg($('regMeseMsg'),'Preset estivo impostato. Premi Salva regole mese e poi Applica regola ai giorni del mese.');
}
window.presetOrarioEstivo=presetOrarioEstivo;

function addMinutesToTime(hhmm, minutes){
  const [h,m] = String(hhmm || '07:30').split(':').map(Number);
  const d = new Date(2000,0,1,h||0,m||0,0);
  d.setMinutes(d.getMinutes() + Math.round(minutes));
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function calcFineByOre(oraInizio, pausaInizio, pausaFine, ore){
  const pausaMin = (() => {
    if(!pausaInizio || !pausaFine) return 0;
    const [h1,m1]=pausaInizio.split(':').map(Number);
    const [h2,m2]=pausaFine.split(':').map(Number);
    return (h2*60+m2) - (h1*60+m1);
  })();
  return addMinutesToTime(oraInizio, Number(ore || 0)*60 + pausaMin);
}
function isPrefestivoInfrasettimanale(day, allDays){
  const d = new Date(day.data + 'T00:00:00');
  const next = new Date(d);
  next.setDate(d.getDate()+1);
  const nextIso = next.toISOString().slice(0,10);
  const tomorrow = allDays.find(x=>x.data===nextIso);
  if(!tomorrow || tomorrow.tipo_giorno !== 'festivo') return false;
  const dow = next.getDay(); // 0 domenica, 1 lunedì...
  return dow >= 1 && dow <= 5;
}
async function applicaRegoleOrarieMese(){
  try{
    if(!requireRegoleHtml()) return;
    if(!window.__tpRegoleMeseSalvataggioDaSalva){
      window.__tpRegoleMeseSalvataggioDaApplica = true;
      try{ await salvaRegolaMese(); }
      finally{ window.__tpRegoleMeseSalvataggioDaApplica = false; }
    }
    const anno = Number(getVal('regAnno', new Date().getFullYear()));
    const mese = Number(getVal('regMese', new Date().getMonth()+1));
    const oreLunGio = oreToDecimal(getVal('regOreLunGio',0) || 0);
    const oreVen = oreToDecimal(getVal('regOreVenerdi',0) || 0);
    const orePref = oreToDecimal(getVal('regOrePrefestivo',0) || 0);
    const oraInizio = getVal('regOraInizioDefault','07:30') || '07:30';
    const pausaInizio = getVal('regPausaInizioDefault','12:00') || '12:00';
    const pausaFine = getVal('regPausaFineDefault','13:00') || '13:00';

    const allDays = await q(db.from('calendario_giorni').select('*').gte('data',`${anno}-${String(mese).padStart(2,'0')}-01`).lte('data',`${anno}-${String(mese).padStart(2,'0')}-31`).order('data'));
    let updates = [];

    for(const day of allDays){
      const jsDate = new Date(day.data + 'T00:00:00');
      const dow = jsDate.getDay(); // 0 dom, 5 ven, 6 sab
      let ore = 0;
      let tipo = day.tipo_giorno;
      let note = day.note || '';

      // Priorità: festivo, weekend, giorno speciale, prefestivo, venerdì, lun-gio
      if(tipo === 'festivo'){
        ore = 0;
      } else if(dow === 6){
        tipo = 'sabato'; ore = 0;
      } else if(dow === 0){
        tipo = 'domenica'; ore = 0;
      } else if(tipo === 'giorno_speciale'){
        // non tocchiamo giorni speciali manuali
        continue;
      } else if(isPrefestivoInfrasettimanale(day, allDays)){
        tipo = 'lavorativo'; ore = orePref;
        note = (note ? note + ' / ' : '') + 'Applicata regola prefestivo';
      } else if(dow === 5){
        tipo = 'lavorativo'; ore = oreVen;
      } else {
        tipo = 'lavorativo'; ore = oreLunGio;
      }

      const row = {
        data: day.data,
        anno,
        mese,
        tipo_giorno: tipo,
        ore_previste: ore,
        max_ore_inseribili: ore,
        consenti_inserimento_ore: false,
        ora_inizio: ore > 0 ? oraInizio : null,
        pausa_inizio: ore > 0 ? pausaInizio : null,
        pausa_fine: ore > 0 ? pausaFine : null,
        ora_fine: ore > 0 ? calcFineByOre(oraInizio, pausaInizio, pausaFine, ore) : null,
        note,
        updated_at: new Date().toISOString()
      };
      updates.push(row);
    }

    for(const row of updates){
      await q(db.from('calendario_giorni').update(row).eq('data', row.data));
    }

    msg($('regMeseMsg'),`Regole applicate al calendario: ${updates.length} giorni aggiornati. I giorni speciali manuali non sono stati toccati.`);
    await caricaRegolaGiorno();
    await caricaDashboard();
  }catch(e){ msg($('regMeseMsg'),e.message,'error'); }
}
window.applicaRegoleOrarieMese=applicaRegoleOrarieMese;

async function caricaRegoleKm(){
  try{
    const rows = await q(db.from('regole_indennita_km').select('*').order('anno').order('km_da'));
    $('regKmBox').innerHTML = rows.length ? `<table><tr><th>Anno</th><th>Km da</th><th>Km a</th><th>Importo</th><th>Descrizione</th><th>Attiva</th></tr>`+
      rows.map(r=>`<tr><td>${r.anno}</td><td>${fmt(r.km_da)}</td><td>${r.km_a==null?'oltre':fmt(r.km_a)}</td><td>CHF ${fmt(r.importo_chf)}</td><td>${escapeHtml(r.materiale||'')}</td><td>${r.attiva?'sì':'no'}</td></tr>`).join('')+'</table>' : '<p>Nessuna fascia km.</p>';
  }catch(e){ $('regKmBox').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
}
window.caricaRegoleKm=caricaRegoleKm;

async function salvaRegolaKm(){
  try{
    const row = {
      anno: Number($('kmAnno').value || 2026),
      km_da: Number($('kmDa').value || 0),
      km_a: $('kmA').value==='' ? null : Number($('kmA').value),
      importo_chf: Number($('kmImporto').value || 0),
      descrizione: $('kmDesc').value,
      attiva: true,
      updated_at: new Date().toISOString()
    };
    await q(db.from('regole_indennita_km').upsert(row,{onConflict:'anno,km_da,km_a'}));
    msg($('kmMsg'),'Fascia km salvata.');
    await caricaRegoleKm();
  }catch(e){ msg($('kmMsg'),e.message,'error'); }
}
window.salvaRegolaKm=salvaRegolaKm;


async function caricaSaldoVacanzeWorker(){
  const box = $('workerSaldoVacanze');
  if(!box || !session?.user?.id) return;
  try{
    const s = await q(db.from('v_saldo_vacanze_collaboratori').select('*').eq('collaboratore_id', session.user.id).maybeSingle());
    if(!s){ box.innerHTML = 'Saldo vacanze non disponibile.'; return; }
    box.innerHTML = `<b>Saldo vacanze:</b> annue ${fmtOre(s.ore_vacanza_annue)} h · usate ${fmtOre(s.ore_vacanza_usate)} h · residue <b class="green">${fmtOre(s.ore_vacanza_residue)} h</b>`;
  }catch(e){
    box.innerHTML = `<span class="red">Saldo vacanze non disponibile. Esegui setup_vacanze_v7.sql.</span>`;
  }
}
window.caricaSaldoVacanzeWorker=caricaSaldoVacanzeWorker;

async function caricaVacanzeAdmin(){
  const box = $('vacanzeAdminBox');
  if(!box) return;
  try{
    const rows = await q(db.from('v_saldo_vacanze_collaboratori').select('*').order('cognome').order('nome'));
    if(!rows.length){
      box.innerHTML = '<p class="muted">Nessun collaboratore trovato.</p>';
      return;
    }
    box.innerHTML = `<table>
      <tr>
        <th>Collaboratore</th><th>Stato</th><th>Anno nascita</th><th>Età</th>
        <th>Ore annue</th><th>Saldo iniziale</th><th>Ore usate</th><th>Ore residue</th><th>Azioni</th>
      </tr>
      ${rows.map(r=>`<tr>
        <td>${escapeHtml(r.cognome)} ${escapeHtml(r.nome)}</td>
        <td>${escapeHtml(r.stato)}</td>
        <td>${r.anno_nascita ?? '-'}</td>
        <td>${r.eta ?? '-'}</td>
        <td>${fmtOre(r.ore_vacanza_annue)}</td>
        <td>${fmtOre(r.saldo_vacanze_iniziale)}</td>
        <td>${fmtOre(r.ore_vacanza_usate)}</td>
        <td><b class="${Number(r.ore_vacanza_residue||0) < 0 ? 'red' : 'green'}">${fmtOre(r.ore_vacanza_residue)}</b></td>
        <td><button onclick="selezionaVacanzeCollaboratore('${r.collaboratore_id}')">Modifica</button></td>
      </tr>`).join('')}
    </table>`;
    msg($('vacanzeAdminMsg'), 'Saldi vacanze caricati.');
  }catch(e){
    box.innerHTML = `<div class="error">${escapeHtml(e.message)}<br>Esegui prima setup_vacanze_v7.sql in Supabase.</div>`;
  }
}
window.caricaVacanzeAdmin=caricaVacanzeAdmin;

function selezionaVacanzeCollaboratore(id){
  const sel = $('vacCollabSelect');
  if(sel) sel.value = id;
  caricaVacanzeCollaboratoreForm();
}
window.selezionaVacanzeCollaboratore=selezionaVacanzeCollaboratore;

function caricaVacanzeCollaboratoreForm(){
  const id = $('vacCollabSelect')?.value;
  const c = cache.collab.find(x => String(x.id) === String(id));
  if(!c) return;
  if($('vacAnnoNascita')) $('vacAnnoNascita').value = c.anno_nascita ?? '';
  if($('vacSaldoIniziale')) $('vacSaldoIniziale').value = c.saldo_vacanze_iniziale ?? 0;
  if($('vacOreAnnue')) $('vacOreAnnue').value = c.ore_vacanza_annue ?? '';
  if($('vacAuto')) $('vacAuto').value = String(c.calcolo_vacanze_automatico !== false);
}
window.caricaVacanzeCollaboratoreForm=caricaVacanzeCollaboratoreForm;

async function salvaVacanzeCollaboratore(){
  try{
    const id = $('vacCollabSelect')?.value;
    if(!id){ msg($('vacFormMsg'), 'Scegli un collaboratore.', 'error'); return; }

    const annoNascitaVal = $('vacAnnoNascita')?.value;
    const oreAnnueVal = $('vacOreAnnue')?.value;
    const saldoVal = $('vacSaldoIniziale')?.value;

    const row = {
      anno_nascita: annoNascitaVal ? Number(annoNascitaVal) : null,
      saldo_vacanze_iniziale: saldoVal ? oreToDecimal(saldoVal) : 0,
      ore_vacanza_annue: oreAnnueVal ? oreToDecimal(oreAnnueVal) : null,
      calcolo_vacanze_automatico: $('vacAuto')?.value !== 'false',
      updated_at: new Date().toISOString()
    };

    await q(db.from('collaboratori').update(row).eq('id', id));
    msg($('vacFormMsg'), 'Dati vacanze salvati.');
    await loadBase();
    fillSelect($('vacCollabSelect'), cache.collab, r=>`${r.cognome} ${r.nome} (${r.stato})`);
    $('vacCollabSelect').value = id;
    await caricaVacanzeAdmin();
    caricaVacanzeCollaboratoreForm();
  }catch(e){
    msg($('vacFormMsg'), e.message + ' - Se mancano colonne, esegui setup_vacanze_v7.sql.', 'error');
  }
}
window.salvaVacanzeCollaboratore=salvaVacanzeCollaboratore;


function isoDate(d){
  return d.toISOString().slice(0,10);
}
function dateFromISO(s){
  return new Date(s + 'T00:00:00');
}
function monthEndDate(year, month){
  return new Date(year, month, 0).getDate();
}
function getCalendarYear(){
  return Number(getVal('calAnno', new Date().getFullYear()) || new Date().getFullYear());
}
function initCalendarioAnnualeUI(){
  const y = getCalendarYear();
  if(el('periodoDa') && !getVal('periodoDa')) setVal('periodoDa', `${y}-01-01`);
  if(el('periodoA') && !getVal('periodoA')) setVal('periodoA', `${y}-12-31`);
  if(el('festivoData') && !getVal('festivoData')) setVal('festivoData', `${y}-01-01`);
  if(el('manualData') && !getVal('manualData')) setVal('manualData', todayISO());
  if(el('calMeseVista') && !getVal('calMeseVista')) el('calMeseVista').value = new Date().getMonth()+1;
}
window.initCalendarioAnnualeUI=initCalendarioAnnualeUI;

async function creaCalendarioAnno(){
  try{
    const anno = getCalendarYear();
    let rows = [];
    for(let m=1; m<=12; m++){
      const last = monthEndDate(anno,m);
      for(let d=1; d<=last; d++){
        const data = `${anno}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const js = dateFromISO(data);
        const dow = js.getDay();
        const tipo = dow === 6 ? 'sabato' : dow === 0 ? 'domenica' : 'lavorativo';
        rows.push({
          data,
          anno,
          mese:m,
          tipo_giorno: tipo,
          nome_festivo: null,
          automatico: true,
          ore_previste: 0,
          ora_inizio: null,
          pausa_inizio: null,
          pausa_fine: null,
          ora_fine: null,
          consenti_inserimento_ore: false,
          max_ore_inseribili: 0,
          note: 'Creato da calendario annuale admin',
          updated_at: new Date().toISOString()
        });
      }
    }
    for(let i=0; i<rows.length; i+=100){
      await q(db.from('calendario_giorni').upsert(rows.slice(i,i+100), {onConflict:'data'}));
    }
    msg($('calMsg'), `Calendario ${anno} creato/aggiornato con ${rows.length} giorni.`);
    await caricaCalendarioAnno();
    await caricaRiepilogoCalendarioAnno();
  }catch(e){ msg($('calMsg'), e.message + ' - Se mancano colonne, esegui setup_calendario_annuale_v8.sql.', 'error'); }
}
window.creaCalendarioAnno=creaCalendarioAnno;

async function salvaFestivo(){
  try{
    const data = getVal('festivoData');
    const anno = Number(data.slice(0,4));
    const mese = Number(data.slice(5,7));
    const nome = getVal('festivoNome','Festivo');
    const ore = oreToDecimal(getVal('festivoOre',0) || 0);
    const consenti = getVal('festivoConsenti','false') === 'true';

    await q(db.from('festivi_annuali').upsert({
      data,
      anno,
      nome_festivo: nome,
      ore_previste: ore,
      consenti_inserimento_ore: consenti,
      attivo: true,
      updated_at: new Date().toISOString()
    }, {onConflict:'data'}));

    await q(db.from('calendario_giorni').upsert({
      data,
      anno,
      mese,
      tipo_giorno:'festivo',
      nome_festivo:nome,
      ore_previste:ore,
      ora_inizio:null,
      pausa_inizio:null,
      pausa_fine:null,
      ora_fine:null,
      consenti_inserimento_ore:consenti,
      max_ore_inseribili:ore,
      note:'Festivo ufficiale inserito da admin',
      automatico:false,
      updated_at:new Date().toISOString()
    }, {onConflict:'data'}));

    msg($('festivoMsg'), 'Festivo salvato e applicato al calendario.');
    await caricaFestivi();
    await caricaCalendarioAnno();
    await caricaRiepilogoCalendarioAnno();
  }catch(e){ msg($('festivoMsg'), e.message + ' - Esegui setup_calendario_annuale_v8.sql se manca la tabella.', 'error'); }
}
window.salvaFestivo=salvaFestivo;

async function caricaFestivi(){
  const box = $('festiviBox');
  if(!box) return;
  try{
    const anno = getCalendarYear();
    const rows = await q(db.from('festivi_annuali').select('*').eq('anno',anno).order('data'));
    box.innerHTML = rows.length ? `<table><tr><th>Data</th><th>Festivo</th><th>Ore</th><th>Consenti ore</th><th>Attivo</th></tr>`+
      rows.map(r=>`<tr><td>${r.data}</td><td>${escapeHtml(r.nome_festivo)}</td><td>${fmtOre(r.ore_previste)}</td><td>${r.consenti_inserimento_ore?'sì':'no'}</td><td>${r.attivo?'sì':'no'}</td></tr>`).join('')+'</table>' : '<p class="muted">Nessun festivo inserito.</p>';
  }catch(e){ box.innerHTML = `<div class="error">${escapeHtml(e.message)}<br>Esegui setup_calendario_annuale_v8.sql.</div>`; }
}
window.caricaFestivi=caricaFestivi;

function presetPeriodoInverno(){
  setVal('periodoNome','Orario inverno');
  setVal('periodoTipo','normale');
  setVal('periodoOreLunGio','8.00');
  setVal('periodoOreVenerdi','7.50');
  setVal('periodoOrePrefestivo','7.50');
  setVal('periodoInizio','07:30');
  setVal('periodoPausaInizio','12:00');
  setVal('periodoPausaFine','13:00');
  setVal('periodoFineLunGio','16:30');
  setVal('periodoFineVenerdi','16:00');
  setVal('periodoFinePrefestivo','16:00');
}
window.presetPeriodoInverno=presetPeriodoInverno;

function presetPeriodoEstivo(){
  setVal('periodoNome','Orario estivo');
  setVal('periodoTipo','estivo');
  setVal('periodoOreLunGio','8.50');
  setVal('periodoOreVenerdi','8.00');
  setVal('periodoOrePrefestivo','8.00');
  setVal('periodoInizio','07:30');
  setVal('periodoPausaInizio','12:00');
  setVal('periodoPausaFine','13:00');
  setVal('periodoFineLunGio','16:30');
  setVal('periodoFineVenerdi','16:00');
  setVal('periodoFinePrefestivo','16:00');
}
window.presetPeriodoEstivo=presetPeriodoEstivo;

async function salvaRegolaPeriodo(){
  try{
    const anno = getCalendarYear();
    const row = {
      anno,
      nome: getVal('periodoNome','Regola oraria'),
      tipo_orario: getVal('periodoTipo','normale'),
      data_da: getVal('periodoDa'),
      data_a: getVal('periodoA'),
      ore_lun_gio: oreToDecimal(getVal('periodoOreLunGio',0) || 0),
      ore_venerdi: oreToDecimal(getVal('periodoOreVenerdi',0) || 0),
      ore_prefestivo: oreToDecimal(getVal('periodoOrePrefestivo',0) || 0),
      ora_inizio: timeOrDefault('periodoInizio','07:30'),
      pausa_inizio: timeOrDefault('periodoPausaInizio','12:00'),
      pausa_fine: timeOrDefault('periodoPausaFine','13:00'),
      // I campi fine lavoro sono opzionali: se restano vuoti vanno salvati come null,
      // non come stringa vuota, altrimenti Supabase dà errore sul tipo time.
      ora_fine_lun_gio: timeOrNull('periodoFineLunGio'),
      ora_fine_venerdi: timeOrNull('periodoFineVenerdi'),
      ora_fine_prefestivo: timeOrNull('periodoFinePrefestivo'),
      attivo: true,
      updated_at: new Date().toISOString()
    };
    if(!row.data_da || !row.data_a){ msg($('periodoMsg'),'Inserisci data da e data a.', 'error'); return; }
    await q(db.from('regole_orarie_periodi').insert(row));
    msg($('periodoMsg'), 'Regola periodo salvata.');
    await caricaPeriodi();
  }catch(e){ msg($('periodoMsg'), e.message + ' - Esegui setup_calendario_annuale_v8.sql.', 'error'); }
}
window.salvaRegolaPeriodo=salvaRegolaPeriodo;

async function caricaPeriodi(){
  const box = $('periodiBox');
  if(!box) return;
  try{
    const anno = getCalendarYear();
    const rows = await q(db.from('regole_orarie_periodi').select('*').eq('anno',anno).eq('attivo',true).order('data_da'));
    box.innerHTML = rows.length ? `<table><tr><th>Nome</th><th>Tipo</th><th>Da</th><th>A</th><th>Lun-Gio</th><th>Ven</th><th>Prefestivo</th><th>Orari</th><th>Fine lavoro</th><th>Azioni</th></tr>`+
      rows.map(r=>`<tr><td>${escapeHtml(r.nome)}</td><td>${escapeHtml(r.tipo_orario)}</td><td>${r.data_da}</td><td>${r.data_a}</td><td>${fmt(r.ore_lun_gio)}</td><td>${fmt(r.ore_venerdi)}</td><td>${fmt(r.ore_prefestivo)}</td><td>${r.ora_inizio} / ${r.pausa_inizio}-${r.pausa_fine}</td><td>L-G ${r.ora_fine_lun_gio||'-'} · Ven ${r.ora_fine_venerdi||'-'} · Pre ${r.ora_fine_prefestivo||'-'}</td><td><button class="secondary" onclick="eliminaRegolaPeriodo('${r.id}')">Elimina</button></td></tr>`).join('')+'</table>' : '<p class="muted">Nessuna regola periodo.</p>';
  }catch(e){ box.innerHTML = `<div class="error">${escapeHtml(e.message)}<br>Esegui setup_calendario_annuale_v8.sql.</div>`; }
}
window.caricaPeriodi=caricaPeriodi;

async function eliminaRegolaPeriodo(id){
  if(!confirm('Vuoi eliminare questa regola oraria? Il calendario gia applicato non viene cancellato.')) return;
  try{
    await q(db.from('regole_orarie_periodi').delete().eq('id', id));
    msg($('periodoMsg'), 'Regola eliminata. Se avevi gia applicato le regole al calendario, ricrea/applica le nuove regole per aggiornare i giorni.');
    await caricaPeriodi();
  }catch(e){ msg($('periodoMsg'), e.message, 'error'); }
}
window.eliminaRegolaPeriodo=eliminaRegolaPeriodo;

async function eliminaTutteRegolePeriodoAnno(){
  const anno = getCalendarYear();
  if(!confirm("Vuoi eliminare TUTTE le regole orarie inserite per l'anno " + anno + "? Il calendario gia applicato non viene cancellato.")) return;
  try{
    await q(db.from('regole_orarie_periodi').delete().eq('anno', anno));
    msg($('periodoMsg'), "Tutte le regole orarie dell'anno " + anno + ' sono state eliminate.');
    await caricaPeriodi();
  }catch(e){ msg($('periodoMsg'), e.message, 'error'); }
}
window.eliminaTutteRegolePeriodoAnno=eliminaTutteRegolePeriodoAnno;

async function eliminaCalendarioAnno(){
  const anno = getCalendarYear();
  if(!confirm('Attenzione: vuoi eliminare tutti i giorni del calendario ' + anno + '? Le ore gia inserite dai collaboratori NON vengono cancellate.')) return;
  if(!confirm('Conferma finale: elimina calendario annuale ' + anno + '. Dopo dovrai premere Crea calendario anno.')) return;
  try{
    await q(db.from('calendario_giorni').delete().eq('anno', anno));
    msg($('calMsg'), 'Calendario ' + anno + ' eliminato. Ora puoi ricrearlo pulito.');
    await caricaCalendarioAnno();
    await caricaRiepilogoCalendarioAnno();
  }catch(e){ msg($('calMsg'), e.message, 'error'); }
}
window.eliminaCalendarioAnno=eliminaCalendarioAnno;

function periodForDate(data, periods){
  const matches = periods.filter(p => data >= p.data_da && data <= p.data_a);
  if(!matches.length) return null;
  return matches[matches.length - 1];
}
function isPrefestivoByFestivi(data, festivi){
  const d = dateFromISO(data);
  const next = new Date(d);
  next.setDate(d.getDate()+1);
  const nextIso = isoDate(next);
  const tomorrow = festivi.find(f => f.data === nextIso && f.attivo);
  if(!tomorrow) return false;
  const dow = next.getDay();
  return dow >= 1 && dow <= 5;
}
async function applicaRegoleAnnuali(){
  try{
    const anno = getCalendarYear();

    const { data, error } = await db.rpc('fn_applica_regole_orarie_annuali', { p_anno: anno });
    if(error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    const aggiornati = result?.giorni_aggiornati ?? '-';
    msg($('periodoMsg'), `Regole applicate al calendario ${anno}. Giorni aggiornati: ${aggiornati}.`);

    await caricaCalendarioAnno();
    await caricaRiepilogoCalendarioAnno();
  }catch(e){
    msg($('periodoMsg'), e.message + ' - Esegui prima setup_applica_regole_orarie_rpc_v11.sql in Supabase.', 'error');
  }
}
window.applicaRegoleAnnuali=applicaRegoleAnnuali;

async function caricaGiornoManuale(){
  try{
    const data = getVal('manualData');
    if(!data) return;
    const r = await q(db.from('calendario_giorni').select('*').eq('data',data).maybeSingle());
    if(!r){ msg($('manualMsg'),'Giorno non trovato. Crea prima il calendario anno.', 'error'); return; }
    setVal('manualTipo', r.tipo_giorno || 'lavorativo');
    setVal('manualOre', r.ore_previste ?? 0);
    setVal('manualMaxOre', r.max_ore_inseribili ?? r.ore_previste ?? 0);
    setVal('manualInizio', (r.ora_inizio || '').slice(0,5));
    setVal('manualPausaInizio', (r.pausa_inizio || '').slice(0,5));
    setVal('manualPausaFine', (r.pausa_fine || '').slice(0,5));
    setVal('manualFine', (r.ora_fine || '').slice(0,5));
    setVal('manualNote', r.note || '');
    setChecked('manualConsenti', !!r.consenti_inserimento_ore);
  }catch(e){ msg($('manualMsg'), e.message, 'error'); }
}
window.caricaGiornoManuale=caricaGiornoManuale;

async function salvaGiornoManuale(){
  try{
    const data = getVal('manualData');
    const anno = Number(data.slice(0,4));
    const mese = Number(data.slice(5,7));
    const ore = oreToDecimal(getVal('manualOre',0) || 0);
    const row = {
      data,
      anno,
      mese,
      tipo_giorno: getVal('manualTipo','giorno_speciale'),
      ore_previste: ore,
      max_ore_inseribili: oreToDecimal(getVal('manualMaxOre', ore) || ore),
      consenti_inserimento_ore: getChecked('manualConsenti'),
      ora_inizio: nullIfEmpty(getVal('manualInizio','')),
      pausa_inizio: nullIfEmpty(getVal('manualPausaInizio','')),
      pausa_fine: nullIfEmpty(getVal('manualPausaFine','')),
      ora_fine: nullIfEmpty(getVal('manualFine','')),
      note: getVal('manualNote','Giorno modificato manualmente da admin'),
      automatico: false,
      updated_at: new Date().toISOString()
    };
    await q(db.from('calendario_giorni').upsert(row,{onConflict:'data'}));
    msg($('manualMsg'),'Giorno manuale salvato. Le regole automatiche non lo sovrascrivono.');
    await caricaCalendarioAnno();
    await caricaRiepilogoCalendarioAnno();
  }catch(e){ msg($('manualMsg'), e.message, 'error'); }
}
window.salvaGiornoManuale=salvaGiornoManuale;

function calRowClass(r){
  if(r.tipo_giorno === 'sabato' || r.tipo_giorno === 'domenica') return 'cal-weekend';
  if(r.tipo_giorno === 'festivo') return 'cal-festivo';
  if(r.tipo_giorno === 'giorno_speciale' || r.tipo_giorno === 'chiusura_aziendale') return 'cal-speciale';
  return '';
}
async function caricaCalendarioAnno(){
  const box = $('calGiorniBox');
  if(!box) return;
  try{
    const anno = getCalendarYear();
    const mese = Number(getVal('calMeseVista', new Date().getMonth()+1));
    const rows = await q(db.from('calendario_giorni').select('*').eq('anno',anno).eq('mese',mese).order('data'));
    box.innerHTML = rows.length ? `<table><tr><th>Data</th><th>Tipo</th><th>Festivo</th><th>Ore</th><th>Inizio</th><th>Pausa</th><th>Fine</th><th>Max ore</th><th>Manuale</th><th>Note</th></tr>`+
      rows.map(r=>`<tr class="${calRowClass(r)}"><td>${r.data}</td><td>${escapeHtml(r.tipo_giorno)}</td><td>${escapeHtml(r.nome_festivo||'')}</td><td>${fmtOre(r.ore_previste)}</td><td>${r.ora_inizio||'-'}</td><td>${r.pausa_inizio&&r.pausa_fine?`${r.pausa_inizio}-${r.pausa_fine}`:'-'}</td><td>${r.ora_fine||'-'}</td><td>${fmtOre(r.max_ore_inseribili)}</td><td>${r.automatico===false?'sì':'no'}</td><td>${escapeHtml(r.note||'')}</td></tr>`).join('')+'</table>' : '<p class="muted">Nessun giorno. Crea prima il calendario anno.</p>';
  }catch(e){ box.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
}
window.caricaCalendarioAnno=caricaCalendarioAnno;

async function caricaRiepilogoCalendarioAnno(){
  const box = $('calRiepilogoBox');
  if(!box) return;
  try{
    const anno = getCalendarYear();
    const rows = await q(db.from('calendario_giorni').select('anno,mese,tipo_giorno,ore_previste').eq('anno',anno));
    const regole = await q(db.from('regole_mensili').select('mese,ore_previste_mese,giorni_lavorativi').eq('anno',anno));
    let byMonth = {};
    for(let m=1;m<=12;m++) byMonth[m] = {mese:m, cal:0, lav:0, fest:0, sab:0, dom:0, ufficiale:null, giorniUff:null};
    rows.forEach(r=>{
      const b = byMonth[r.mese];
      b.cal += Number(r.ore_previste||0);
      if(r.tipo_giorno==='lavorativo') b.lav++;
      if(r.tipo_giorno==='festivo') b.fest++;
      if(r.tipo_giorno==='sabato') b.sab++;
      if(r.tipo_giorno==='domenica') b.dom++;
    });
    regole.forEach(r=>{
      if(byMonth[r.mese]){
        byMonth[r.mese].ufficiale = r.ore_previste_mese;
        byMonth[r.mese].giorniUff = r.giorni_lavorativi;
      }
    });
    const list = Object.values(byMonth);
    box.innerHTML = `<table><tr><th>Mese</th><th>Totale calendario</th><th>Totale ufficiale admin</th><th>Giorni lav.</th><th>Giorni lav. ufficiali</th><th>Festivi</th><th>Sabati</th><th>Domeniche</th></tr>`+
      list.map(r=>`<tr><td>${monthName(r.mese)}</td><td>${fmt(r.cal)}</td><td><b>${r.ufficiale==null?'-':fmt(r.ufficiale)}</b></td><td>${r.lav}</td><td>${r.giorniUff==null?'-':fmt(r.giorniUff)}</td><td>${r.fest}</td><td>${r.sab}</td><td>${r.dom}</td></tr>`).join('')+'</table>';
  }catch(e){ box.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
}
window.caricaRiepilogoCalendarioAnno=caricaRiepilogoCalendarioAnno;


let ultimeRegieFirma = [];

function initRegieFirma(){
  const oggi = todayISO();
  const d = new Date();
  const primo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;

  if($('regieDataDal') && !$('regieDataDal').value) $('regieDataDal').value = primo;
  if($('regieDataAl') && !$('regieDataAl').value) $('regieDataAl').value = oggi;

  fillSelectWithBlankRegie($('regieCollaboratore'), (cache.collab||[]).filter(c=>c.stato==='attivo'), r=>`${r.cognome} ${r.nome}`, 'Tutti gli operai');
  fillSelectWithBlankRegie($('regieCantiere'), (cache.cantieri||[]).filter(c=>c.stato==='attivo'), r=>`${r.codice} ${r.nome}`, 'Tutti i cantieri');
  fillSelectWithBlankRegie($('regieLavorazione'), (cache.lavorazioni||[]).filter(l=>l.stato==='attivo'), r=>r.nome, 'Tutte le lavorazioni');
  fillSelectWithBlankRegie($('regieSottoLavorazione'), cache.sotto||[], r=>r.nome, 'Tutte le sotto-lavorazioni');
}
window.initRegieFirma=initRegieFirma;

function fillSelectWithBlankRegie(el, rows, label, blankLabel){
  if(!el) return;
  el.innerHTML = `<option value="">${blankLabel}</option>` + (rows||[]).map(r=>`<option value="${r.id}">${escapeHtml(label(r))}</option>`).join('');
}

function resetRegieFirma(){
  ['regieCollaboratore','regieCantiere','regieLavorazione','regieSottoLavorazione','regieTesto'].forEach(id=>{
    const x=$(id); if(x) x.value='';
  });
  const d = new Date();
  if($('regieDataDal')) $('regieDataDal').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  if($('regieDataAl')) $('regieDataAl').value = todayISO();
  ultimeRegieFirma = [];
  if($('regieRiepilogo')) $('regieRiepilogo').innerHTML = '';
  if($('regieRisultati')) $('regieRisultati').innerHTML = '';
  if($('regiePrintArea')) $('regiePrintArea').innerHTML = '';
  msg($('regieMsg'), 'Filtri puliti.');
}
window.resetRegieFirma=resetRegieFirma;

async function cercaRegieFirma(){
  try{
    const dal = $('regieDataDal')?.value;
    const al = $('regieDataAl')?.value;
    if(!dal || !al){
      msg($('regieMsg'), 'Inserisci data dal e data al.', 'error');
      return;
    }

    let query = db.from('v_regie_firma')
      .select('*')
      .gte('data', dal)
      .lte('data', al)
      .order('data', {ascending:true})
      .order('collaboratore', {ascending:true});

    const collab = $('regieCollaboratore')?.value;
    const cantiere = $('regieCantiere')?.value;
    const lav = $('regieLavorazione')?.value;
    const sotto = $('regieSottoLavorazione')?.value;

    if(collab) query = query.eq('collaboratore_id', collab);
    if(cantiere) query = query.eq('cantiere_id', cantiere);
    if(lav) query = query.eq('lavorazione_id', lav);
    if(sotto) query = query.eq('sotto_lavorazione_id', sotto);

    let rows = await q(query);

    const txt = normRegie($('regieTesto')?.value || '');
    if(txt){
      rows = rows.filter(r => normRegie(`${r.collaboratore||''} ${r.cantiere||''} ${r.lavorazione||''} ${r.sotto_lavorazione||''} ${r.note||''}`).includes(txt));
    }

    ultimeRegieFirma = rows;
    renderRegieFirma(rows);
    renderRegiePrint(rows);
    msg($('regieMsg'), `${rows.length} righe regie trovate.`);
  }catch(e){
    msg($('regieMsg'), e.message + ' - Se manca la vista, esegui setup_regie_firma_v18.sql in Supabase.', 'error');
  }
}
window.cercaRegieFirma=cercaRegieFirma;

function normRegie(v){
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}

function renderRegieFirma(rows){
  const ore = rows.reduce((s,r)=>s+oreToDecimal(r.ore_fatte||0),0);
  const giorni = new Set(rows.map(r=>r.data)).size;
  const operai = new Set(rows.map(r=>r.collaboratore_id)).size;
  const cantieri = new Set(rows.map(r=>r.cantiere_id).filter(Boolean)).size;

  if($('regieRiepilogo')) $('regieRiepilogo').innerHTML = `
    <div class="box"><span>Righe</span><div class="big">${fmt(rows.length)}</div></div>
    <div class="box"><span>Ore totali</span><div class="big">${fmt(ore)}</div></div>
    <div class="box"><span>Giorni</span><div class="big">${fmt(giorni)}</div></div>
    <div class="box"><span>Operai</span><div class="big">${fmt(operai)}</div></div>
    <div class="box"><span>Cantieri</span><div class="big">${fmt(cantieri)}</div></div>
  `;

  if($('regieRisultati')) $('regieRisultati').innerHTML = rows.length ? `<table>
    <tr>
      <th>Data</th><th>Operaio</th><th>Cantiere</th><th>Km</th><th>Lavorazione</th>
      <th>Sotto-lavorazione</th><th>Ore</th><th>Orario giorno</th><th>Note</th>
    </tr>
    ${rows.map(r=>`<tr>
      <td>${r.data}</td>
      <td>${escapeHtml(r.collaboratore)}</td>
      <td>${escapeHtml(r.cantiere||'-')}</td>
      <td>${r.km ?? '-'}</td>
      <td>${escapeHtml(r.lavorazione||'-')}</td>
      <td>${escapeHtml(r.sotto_lavorazione||'-')}</td>
      <td>${fmtOre(r.ore_fatte)}</td>
      <td>${r.ora_inizio||'-'} / ${r.pausa_inizio&&r.pausa_fine?`${r.pausa_inizio}-${r.pausa_fine}`:'-'} / ${r.ora_fine||'-'}</td>
      <td>${escapeHtml(r.note||'')}</td>
    </tr>`).join('')}
  </table>` : '<p class="muted">Nessuna regia trovata.</p>';
}

function groupRegieRows(rows){
  const mode = $('regieGruppo')?.value || 'giorno';
  const keyFn = mode === 'collaboratore'
    ? r => `${r.collaboratore}`
    : mode === 'cantiere'
      ? r => `${r.cantiere || 'Senza cantiere'}`
      : r => `${r.data}`;

  const groups = {};
  rows.forEach(r=>{
    const k = keyFn(r);
    if(!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  return groups;
}

function renderRegiePrint(rows){
  const box = $('regiePrintArea');
  if(!box) return;
  const dal = $('regieDataDal')?.value || '';
  const al = $('regieDataAl')?.value || '';
  const groups = groupRegieRows(rows);

  box.innerHTML = `
    <div class="regie-print-sheet">
      <div class="regie-print-header">
        <div>
          <div class="print-logo-title">Tecnoplafon SA</div>
          <div class="muted">Regie lavoro per firma</div>
        </div>
        <div class="regie-print-meta">
          <b>Periodo:</b> ${dal} - ${al}<br>
          <b>Stampato:</b> ${new Date().toLocaleDateString('it-CH')}
        </div>
      </div>

      ${Object.entries(groups).map(([title, items])=>{
        const tot = items.reduce((s,r)=>s+oreToDecimal(r.ore_fatte||0),0);
        return `<div class="regie-group">
          <h3>${escapeHtml(title)} <span>Totale ore: ${fmt(tot)}</span></h3>
          <table>
            <tr>
              <th>Data</th><th>Operaio</th><th>Cantiere</th><th>Lavorazione</th>
              <th>Sotto-lavorazione</th><th>Ore</th><th>Note</th>
            </tr>
            ${items.map(r=>`<tr>
              <td>${r.data}</td>
              <td>${escapeHtml(r.collaboratore)}</td>
              <td>${escapeHtml(r.cantiere||'-')}</td>
              <td>${escapeHtml(r.lavorazione||'-')}</td>
              <td>${escapeHtml(r.sotto_lavorazione||'-')}</td>
              <td>${fmtOre(r.ore_fatte)}</td>
              <td>${escapeHtml(r.note||'')}</td>
            </tr>`).join('')}
          </table>
          <div class="regie-signatures firma-dl-ready">
            <div class="firma-operaio">Firma operaio / responsabile<br><span></span></div>
            <div class="firma-dl-box"><b>Firma DL</b><br><small>Direzione lavori</small><span></span></div>
            <div class="firma-admin">Firma admin / ditta<br><span></span></div>
            <div class="firma-data">Data<br><span></span></div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function stampaRegieFirma(){
  if(!ultimeRegieFirma.length){
    msg($('regieMsg'), 'Prima cerca le regie da stampare.', 'error');
    return;
  }
  renderRegiePrint(ultimeRegieFirma);
  window.print();
}
window.stampaRegieFirma=stampaRegieFirma;


document.addEventListener('DOMContentLoaded', async()=>{
  initDb();
  const page=document.body.dataset.page;
  installOreAutoNormalize();
  if(page==='worker') await initWorker();
  if(page==='admin') await initAdmin();
});
