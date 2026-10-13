/* =========================================================
   Bolso em Dia — Planilha de Gastos Online & Simulador
   100% client-side • dados salvos no localStorage
   ========================================================= */
(() => {
  'use strict';

  /* ---------------------------------------------------------
     Constantes
     --------------------------------------------------------- */
  const STORAGE_KEY = 'bolsoEmDia:v1';

  const CATEGORIES = {
    moradia:       { label: 'Moradia',        icon: '🏠', color: '#1e3a8a', bucket: 'need' },
    alimentacao:   { label: 'Alimentação',    icon: '🛒', color: '#f97316', bucket: 'need' },
    transporte:    { label: 'Transporte',     icon: '🚗', color: '#0ea5e9', bucket: 'need' },
    lazer:         { label: 'Lazer',          icon: '🎉', color: '#a855f7', bucket: 'want' },
    saude:         { label: 'Saúde',          icon: '💊', color: '#ec4899', bucket: 'need' },
    dividas:       { label: 'Dívidas/Outros', icon: '💳', color: '#64748b', bucket: 'need' },
    investimentos: { label: 'Investimentos',  icon: '📈', color: '#10b981', bucket: 'future' },
  };

  const BUCKETS = {
    need:   { label: 'Necessidades', short: 'Necessidade', ideal: 50 },
    want:   { label: 'Desejos',      short: 'Desejo',      ideal: 30 },
    future: { label: 'Futuro',       short: 'Futuro',      ideal: 20 },
  };

  const CUT_TIPS = {
    moradia: 'renegocie o aluguel, reduza luz/água e revise planos de internet e TV',
    alimentacao: 'planeje o cardápio da semana, reduza o delivery e compare preços entre mercados',
    transporte: 'avalie transporte público, caronas e apps em horários de tarifa menor',
    saude: 'compare planos de saúde e prefira medicamentos genéricos',
    dividas: 'priorize quitar as dívidas com juros mais altos (cartão e cheque especial) e renegocie',
    lazer: 'defina um teto mensal para lazer, cancele assinaturas pouco usadas e busque opções gratuitas',
    investimentos: 'revise seus aportes',
  };

  const PRODUCTS = {
    poupanca: { label: 'Poupança',      color: '#94a3b8', ir: false, custody: 0 },
    cdb:      { label: 'CDB 100% CDI',  color: '#10b981', ir: true,  custody: 0 },
    tesouro:  { label: 'Tesouro Selic', color: '#1e3a8a', ir: true,  custody: 0.002, custodyExempt: 10000 },
  };

  /* Tabela regressiva do IR (renda fixa) — dias corridos */
  const IR_TABLE = [
    { maxDays: 180, rate: 0.225 },
    { maxDays: 360, rate: 0.20 },
    { maxDays: 720, rate: 0.175 },
    { maxDays: Infinity, rate: 0.15 },
  ];

  const defaultState = () => ({
    version: 1,
    renda: 0,
    despesas: [],
    reserva: { base: 'need', meses: 6, custom: 0, guardado: 0, aporte: 0 },
    meta: { nome: '', valor: 0, guardado: 0, prazo: 12 },
    sim: { aporte: 500, inicial: 0, prazo: 12, selic: 15, cdi: 14.9, tr: 0.15 },
    updatedAt: null,
  });

  /* ---------------------------------------------------------
     Formatação / parsing
     --------------------------------------------------------- */
  const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const numFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compactFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const brl = (n) => brlFmt.format(round2(Number.isFinite(n) ? n : 0)).replace(/\u00a0/g, ' ');
  const brlCompact = (n) => (Math.abs(n) < 1000 ? brl(Math.round(n)) : compactFmt.format(n).replace(/\u00a0/g, ' '));
  const pct = (n, digits = 1) => `${(Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  const csvNum = (n) => round2(n || 0).toFixed(2).replace('.', ',');

  /** Converte "1.234,56", "1234.56", "R$ 1.500" etc. em número. */
  function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value == null) return 0;
    let s = String(value).replace(/[R$\s\u00a0]/g, '');
    if (!s) return 0;
    const negative = s.startsWith('-');
    s = s.replace(/[^\d.,]/g, '');
    if (s.includes(',')) {
      const last = s.lastIndexOf(',');
      s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1).replace(/[.,]/g, '');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, ''); // "1.500" => 1500 (milhar pt-BR)
    } else if ((s.match(/\./g) || []).length > 1) {
      const last = s.lastIndexOf('.');
      s = s.slice(0, last).replace(/\./g, '') + '.' + s.slice(last + 1);
    }
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return negative ? -n : n;
  }

  const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function formatDuration(months) {
    if (months == null) return '—';
    if (months <= 0) return 'Meta atingida! 🎉';
    const y = Math.floor(months / 12);
    const m = months % 12;
    const parts = [];
    if (y) parts.push(`${y} ${y === 1 ? 'ano' : 'anos'}`);
    if (m) parts.push(`${m} ${m === 1 ? 'mês' : 'meses'}`);
    return parts.join(' e ');
  }

  function formatTerm(months) {
    if (months % 12 === 0) { const y = months / 12; return `${y} ${y === 1 ? 'ano' : 'anos'}`; }
    return formatDuration(months);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------------------------------------------------
     Cálculos (funções puras)
     --------------------------------------------------------- */
  function resolveBucket(d) {
    const cat = CATEGORIES[d.categoria];
    if (!cat) return 'need';
    if (cat.bucket === 'future') return 'future';
    if (d.tipo === 'need' || d.tipo === 'want') return d.tipo;
    return cat.bucket;
  }

  function summarize(st) {
    const renda = Math.max(0, st.renda || 0);
    const byCat = {};
    const bucketCats = { need: {}, want: {}, future: {} };
    Object.keys(CATEGORIES).forEach((k) => { byCat[k] = 0; });
    const buckets = { need: 0, want: 0, future: 0 };

    for (const d of st.despesas) {
      if (!CATEGORIES[d.categoria]) continue;
      const v = Math.max(0, d.valor || 0);
      const b = resolveBucket(d);
      byCat[d.categoria] += v;
      buckets[b] += v;
      bucketCats[b][d.categoria] = (bucketCats[b][d.categoria] || 0) + v;
    }

    const totalGastos = buckets.need + buckets.want;        // consumo
    const investido = buckets.future;                        // aportes lançados
    const totalSaidas = totalGastos + investido;
    const saldo = renda - totalSaidas;                       // sobra não alocada
    const futuro = renda - totalGastos;                      // investido + sobra
    const p = (v) => (renda > 0 ? (v / renda) * 100 : 0);

    return {
      renda, byCat, bucketCats, buckets,
      totalGastos, investido, totalSaidas, saldo, futuro,
      totalCategorias: totalSaidas,
      pctNeed: p(buckets.need),
      pctWant: p(buckets.want),
      pctFuture: p(futuro),
      pctInvestido: p(investido),
      count: st.despesas.length,
    };
  }

  function topCategory(map) {
    let best = null;
    for (const [k, v] of Object.entries(map)) if (!best || v > best.v) best = { k, v };
    return best && best.v > 0 ? { ...best, label: CATEGORIES[best.k].label } : null;
  }

  function levelFor(bucket, value) {
    if (bucket === 'need') return value <= 50 ? 'ok' : value <= 60 ? 'warn' : 'danger';
    if (bucket === 'want') return value <= 30 ? 'ok' : value <= 40 ? 'warn' : 'danger';
    return value >= 20 ? 'ok' : value >= 10 ? 'warn' : 'danger';
  }

  function diagnose(s) {
    if (s.renda <= 0) {
      return {
        level: 'empty', label: 'Aguardando dados', rows: [],
        alerts: [{ level: 'info', icon: 'ℹ️', text: 'Informe sua renda mensal líquida para receber o diagnóstico da regra 50/30/20.' }],
      };
    }
    const r = s.renda;
    const rows = [
      { key: 'need', label: 'Necessidades', value: s.buckets.need, pct: s.pctNeed, ideal: 50, idealValue: r * 0.5 },
      { key: 'want', label: 'Desejos / Estilo de vida', value: s.buckets.want, pct: s.pctWant, ideal: 30, idealValue: r * 0.3 },
      { key: 'future', label: 'Futuro (investir/guardar)', value: s.futuro, pct: s.pctFuture, ideal: 20, idealValue: r * 0.2 },
    ].map((row) => ({ ...row, level: levelFor(row.key, row.pct) }));

    const alerts = [];
    if (s.saldo < 0) {
      alerts.push({ level: 'danger', icon: '🚨', text: `Orçamento no vermelho: suas saídas superam a renda em <strong>${brl(-s.saldo)}</strong>. Corte gastos antes de assumir novos compromissos para não entrar no cheque especial ou no rotativo do cartão.` });
    }

    const [need, want, fut] = rows;
    if (need.level !== 'ok') {
      const over = need.value - need.idealValue;
      const top = topCategory(s.bucketCats.need);
      alerts.push({ level: need.level, icon: '🏠', text: `Necessidades consomem <strong>${pct(need.pct)}</strong> da renda (${brl(need.value)}). O teto recomendado é 50% (${brl(need.idealValue)}). Tente reduzir cerca de <strong>${brl(over)}</strong>${top ? ` — comece por <strong>${top.label}</strong> (${brl(top.v)}): ${CUT_TIPS[top.k]}` : ''}.` });
    }
    if (want.level !== 'ok') {
      const over = want.value - want.idealValue;
      const top = topCategory(s.bucketCats.want);
      alerts.push({ level: want.level, icon: '🎉', text: `Desejos somam <strong>${pct(want.pct)}</strong> da renda (${brl(want.value)}), acima dos 30% (${brl(want.idealValue)}). Corte <strong>${brl(over)}</strong>${top ? ` — o maior peso está em <strong>${top.label}</strong> (${brl(top.v)}): ${CUT_TIPS[top.k]}` : ''}.` });
    }
    if (fut.level !== 'ok') {
      const missing = fut.idealValue - Math.max(0, fut.value);
      alerts.push({ level: fut.level, icon: '📈', text: `Apenas <strong>${pct(Math.max(0, fut.pct))}</strong> da renda está disponível para o futuro. A meta é 20% (${brl(fut.idealValue)}/mês) — faltam <strong>${brl(missing)}</strong> por mês.` });
    }
    if (s.saldo > 0.005 && s.investido < r * 0.2) {
      alerts.push({ level: 'info', icon: '💡', text: `Você tem <strong>${brl(s.saldo)}</strong> de sobra sem destino. Programe uma transferência automática para investimentos no dia do pagamento e lance como “Investimentos / Guardar”.` });
    }
    if (s.count === 0) {
      alerts.push({ level: 'info', icon: '🧾', text: 'Adicione suas despesas para um diagnóstico completo.' });
    } else if (rows.every((x) => x.level === 'ok') && s.saldo >= 0) {
      alerts.push({ level: 'ok', icon: '✅', text: `Parabéns! Seu orçamento está dentro da regra 50/30/20. Você direciona <strong>${pct(fut.pct)}</strong> da renda para o futuro (${brl(fut.value)}/mês).` });
    }

    const dangers = rows.filter((x) => x.level === 'danger').length + (s.saldo < 0 ? 1 : 0);
    const warns = rows.filter((x) => x.level === 'warn').length;
    let level = 'ok', label = '✓ Saudável';
    if (dangers) { level = 'danger'; label = '⚠ Crítico'; }
    else if (warns) { level = 'warn'; label = '! Atenção'; }
    if (s.count === 0) { level = 'empty'; label = 'Adicione despesas'; }
    return { level, label, rows, alerts };
  }

  function calcReserva({ custo, meses, guardado, aporte }) {
    custo = Math.max(0, custo || 0);
    guardado = Math.max(0, guardado || 0);
    aporte = Math.max(0, aporte || 0);
    const meta = custo * meses;
    const falta = Math.max(0, meta - guardado);
    const progresso = meta > 0 ? Math.min(100, (guardado / meta) * 100) : 0;
    let mesesParaMeta = null;
    if (meta > 0 && falta === 0) mesesParaMeta = 0;
    else if (meta > 0 && aporte > 0) mesesParaMeta = Math.ceil(falta / aporte - 1e-9);
    return { meta, min: custo * 3, ideal: custo * 6, falta, progresso, mesesParaMeta, custo };
  }

  function calcMeta({ valor, guardado, prazo }) {
    valor = Math.max(0, valor || 0);
    guardado = Math.max(0, guardado || 0);
    prazo = Math.max(1, Math.round(prazo || 1));
    const falta = Math.max(0, valor - guardado);
    const progresso = valor > 0 ? Math.min(100, (guardado / valor) * 100) : 0;
    return { valor, guardado, prazo, falta, progresso, mensal: falta / prazo };
  }

  function irRate(days) {
    for (const row of IR_TABLE) if (days <= row.maxDays) return row.rate;
    return 0.15;
  }
  const monthsToDays = (m) => Math.round((m * 365) / 12);

  function monthlyRates({ selic, cdi, tr }) {
    const trM = Math.max(0, tr || 0) / 100;
    const selicA = Math.max(0, selic || 0);
    // Regra da poupança (Lei 12.703/2012): Selic > 8,5% a.a. => 0,5% a.m. + TR; senão 70% da Selic + TR
    const poupBase = selicA > 8.5 ? 0.005 : Math.pow(1 + (0.7 * selicA) / 100, 1 / 12) - 1;
    return {
      poupanca: (1 + poupBase) * (1 + trM) - 1,
      cdb: Math.pow(1 + Math.max(0, cdi || 0) / 100, 1 / 12) - 1,
      tesouro: Math.pow(1 + selicA / 100, 1 / 12) - 1,
    };
  }

  /**
   * Simula aportes no início de cada mês (k = 0..n-1) + valor inicial em k = 0.
   * Cada aporte é um "lote" com IR próprio (tabela regressiva pelo tempo do lote).
   * Retorna o resultado final e a série do valor líquido de resgate mês a mês.
   */
  function simulate({ aporte, inicial, meses, selic, cdi, tr }) {
    const n = Math.max(1, Math.min(600, Math.round(meses || 1)));
    aporte = Math.max(0, aporte || 0);
    inicial = Math.max(0, inicial || 0);
    const lots = [];
    if (inicial > 0) lots.push({ k: 0, a: inicial });
    if (aporte > 0) for (let k = 0; k < n; k++) lots.push({ k, a: aporte });

    const rates = monthlyRates({ selic, cdi, tr });
    const invested = [];
    for (let m = 0; m <= n; m++) invested.push(inicial + aporte * Math.min(m + 1, n) * (inicial + aporte > 0 ? 1 : 0));

    const products = {};
    for (const [key, cfg] of Object.entries(PRODUCTS)) {
      const r = rates[key];
      const custodyM = cfg.custody ? Math.pow(1 + cfg.custody, 1 / 12) - 1 : 0;
      const net = [], gross = [], irSeries = [], feeSeries = [];
      let feeCum = 0;
      for (let m = 0; m <= n; m++) {
        // taxa de custódia do mês (m-1, m] sobre o saldo antes do novo aporte
        if (custodyM && m > 0) {
          let balBefore = 0;
          for (const lot of lots) if (lot.k < m) balBefore += lot.a * Math.pow(1 + r, m - lot.k);
          feeCum += Math.max(0, balBefore - cfg.custodyExempt) * custodyM;
        }
        let g = 0, ir = 0;
        for (const lot of lots) {
          if (lot.k > m) continue;
          const held = m - lot.k;
          const v = lot.a * Math.pow(1 + r, held);
          g += v;
          if (cfg.ir && held > 0) ir += (v - lot.a) * irRate(monthsToDays(held));
        }
        gross.push(g);
        irSeries.push(ir);
        feeSeries.push(feeCum);
        net.push(g - ir - feeCum);
      }
      const investido = invested[n];
      const bruto = gross[n];
      const ir = irSeries[n];
      const taxas = feeSeries[n];
      const liquido = net[n];
      products[key] = {
        key, ...cfg, rate: r,
        investido, bruto, ir, taxas, liquido,
        rendimentoBruto: bruto - investido,
        rendimentoLiquido: liquido - investido,
        rentabilidade: investido > 0 ? ((liquido - investido) / investido) * 100 : 0,
        net, gross,
      };
    }
    const best = Object.values(products).reduce((a, b) => (b.liquido > a.liquido ? b : a));
    return { n, rates, invested, products, best: best.key };
  }

  /* ---------------------------------------------------------
     Estado + persistência
     --------------------------------------------------------- */
  let state = loadState();

  function sanitize(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
    const out = {
      ...base,
      renda: Math.max(0, num(raw.renda)),
      despesas: Array.isArray(raw.despesas)
        ? raw.despesas
          .filter((d) => d && CATEGORIES[d.categoria])
          .map((d) => ({
            id: String(d.id || uid()),
            descricao: String(d.descricao || 'Despesa').slice(0, 60),
            valor: Math.max(0, num(d.valor)),
            categoria: d.categoria,
            tipo: ['auto', 'need', 'want'].includes(d.tipo) ? d.tipo : 'auto',
          }))
        : [],
      reserva: { ...base.reserva, ...(raw.reserva || {}) },
      meta: { ...base.meta, ...(raw.meta || {}) },
      sim: { ...base.sim, ...(raw.sim || {}) },
      updatedAt: raw.updatedAt || null,
    };
    out.reserva.meses = [3, 6, 12].includes(+out.reserva.meses) ? +out.reserva.meses : 6;
    out.reserva.base = ['need', 'all', 'custom'].includes(out.reserva.base) ? out.reserva.base : 'need';
    ['custom', 'guardado', 'aporte'].forEach((k) => { out.reserva[k] = Math.max(0, num(out.reserva[k])); });
    out.meta.nome = String(out.meta.nome || '').slice(0, 40);
    ['valor', 'guardado'].forEach((k) => { out.meta[k] = Math.max(0, num(out.meta[k])); });
    out.meta.prazo = Math.min(600, Math.max(1, Math.round(num(out.meta.prazo, 12)) || 12));
    ['aporte', 'inicial', 'selic', 'cdi', 'tr'].forEach((k) => { out.sim[k] = Math.max(0, num(out.sim[k], base.sim[k])); });
    out.sim.prazo = Math.min(600, Math.max(1, Math.round(num(out.sim.prazo, 12)) || 12));
    return out;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : defaultState();
    } catch (err) {
      console.warn('Não foi possível ler os dados salvos:', err);
      return defaultState();
    }
  }

  let saveTimer = null;
  function saveState() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveStatus(`Salvo automaticamente às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      console.warn('Falha ao salvar no localStorage:', err);
      setSaveStatus('Não foi possível salvar neste navegador (modo privado?)');
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 250);
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    target[last] = value;
  }

  /* ---------------------------------------------------------
     DOM helpers
     --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  function setSaveStatus(text) {
    const el = $('#save-status');
    if (el) el.innerHTML = `<span class="dot" aria-hidden="true"></span> ${escapeHtml(text)}`;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  function confirmDialog({ title, message, ok = 'Confirmar', danger = true }) {
    const dlg = $('#dialog-confirm');
    $('#dialog-title').textContent = title;
    $('#dialog-msg').textContent = message;
    const okBtn = $('#dialog-ok');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    return new Promise((resolve) => {
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.showModal();
      $('#dialog-cancel').focus();
    });
  }

  /* ---------------------------------------------------------
     Renderização
     --------------------------------------------------------- */
  let lastSummary = null;
  let lastSim = null;

  function renderAll() {
    const s = summarize(state);
    lastSummary = s;
    renderKPIs(s);
    renderList(s);
    renderDonut(s);
    renderDiagnosis(s);
    renderReserva(s);
    renderMeta();
    renderSim();
  }

  function renderKPIs(s) {
    $('#kpi-renda').textContent = brl(s.renda);
    $('#kpi-gastos').textContent = brl(s.totalGastos);
    $('#kpi-gastos-sub').textContent = s.renda > 0
      ? `${pct((s.totalGastos / s.renda) * 100)} da renda • ${s.count} ${s.count === 1 ? 'lançamento' : 'lançamentos'}`
      : `${s.count} ${s.count === 1 ? 'lançamento' : 'lançamentos'}`;
    $('#kpi-saldo').textContent = brl(s.saldo);
    const card = $('#kpi-saldo-card');
    card.classList.toggle('is-positive', s.renda > 0 && s.saldo >= 0);
    card.classList.toggle('is-negative', s.saldo < 0);
    $('#kpi-saldo-sub').textContent = s.saldo < 0 ? 'atenção: gastando mais do que ganha' : s.investido > 0 ? `já investindo ${brl(s.investido)}` : 'após gastos e investimentos';
    $('#kpi-poupanca').textContent = pct(s.renda > 0 ? s.pctFuture : 0);
    $('#kpi-poupanca-sub').textContent = s.renda > 0 ? `${brl(s.futuro)} • meta: 20%` : 'meta: 20% da renda';
  }

  function renderList(s) {
    const ul = $('#lista-despesas');
    ul.textContent = '';
    const frag = document.createDocumentFragment();
    [...state.despesas].reverse().forEach((d) => {
      const cat = CATEGORIES[d.categoria];
      const bucket = resolveBucket(d);
      const li = document.createElement('li');
      li.className = 'expense';
      li.dataset.id = d.id;

      const icon = document.createElement('span');
      icon.className = 'expense-icon';
      icon.style.background = `${cat.color}1a`;
      icon.textContent = cat.icon;
      icon.setAttribute('aria-hidden', 'true');

      const info = document.createElement('div');
      info.className = 'expense-info';
      const desc = document.createElement('p');
      desc.className = 'expense-desc';
      desc.textContent = d.descricao;
      const meta = document.createElement('p');
      meta.className = 'expense-meta';
      const catSpan = document.createElement('span');
      catSpan.textContent = cat.label;
      const tag = document.createElement('span');
      tag.className = `tag tag-${bucket}`;
      tag.textContent = BUCKETS[bucket].short;
      meta.append(catSpan, tag);
      info.append(desc, meta);

      const value = document.createElement('span');
      value.className = 'expense-value';
      value.textContent = brl(d.valor);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.dataset.action = 'delete';
      del.setAttribute('aria-label', `Excluir ${d.descricao}`);
      del.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>';

      li.append(icon, info, value, del);
      frag.append(li);
    });
    ul.append(frag);
    $('#lista-vazia').hidden = s.count > 0;
    $('#lista-count').textContent = s.count;
    $('#lista-total').textContent = brl(s.totalSaidas);
  }

  let activeCat = null;
  function renderDonut(s) {
    const g = $('#donut-segments');
    const legend = $('#legenda');
    g.textContent = '';
    legend.textContent = '';
    const total = s.totalCategorias;
    const entries = Object.entries(s.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    $('#donut-empty').hidden = entries.length > 0;
    $('#donut-wrap').hidden = entries.length === 0;
    if (!entries.length) return;

    let offset = 0;
    const gap = entries.length > 1 ? 0.6 : 0;
    entries.forEach(([key, v]) => {
      const cat = CATEGORIES[key];
      const share = (v / total) * 100;
      const len = Math.max(0.01, share - gap);
      const c = svgEl('circle', {
        class: 'donut-seg', cx: 21, cy: 21, r: 15.9155,
        stroke: cat.color,
        'stroke-dasharray': `${len} ${100 - len}`,
        'stroke-dashoffset': String(-offset),
        tabindex: '0',
        role: 'button',
        'aria-label': `${cat.label}: ${brl(v)} (${pct(share)})`,
        'data-cat': key,
      });
      g.append(c);
      offset += share;

      const li = document.createElement('li');
      li.dataset.cat = key;
      li.innerHTML = `<span class="swatch" style="background:${cat.color}"></span><span>${cat.icon} ${cat.label}</span><span class="lg-value">${brl(v)}</span><span class="lg-pct">${pct(share)}</span>`;
      legend.append(li);
    });
    if (activeCat && !s.byCat[activeCat]) activeCat = null;
    setActiveCat(activeCat);
  }

  function setActiveCat(key) {
    activeCat = key;
    const s = lastSummary;
    const g = $('#donut-segments');
    g.classList.toggle('has-active', !!key);
    $$('.donut-seg', g).forEach((c) => c.classList.toggle('is-active', c.dataset.cat === key));
    $$('#legenda li').forEach((li) => li.classList.toggle('is-active', li.dataset.cat === key));
    if (key && s && s.byCat[key]) {
      $('#donut-center-label').textContent = CATEGORIES[key].label;
      $('#donut-center-value').textContent = brlCompact(s.byCat[key]);
      $('#donut-center-pct').textContent = `${pct((s.byCat[key] / s.totalCategorias) * 100)} do total`;
    } else if (s) {
      $('#donut-center-label').textContent = 'Total do mês';
      $('#donut-center-value').textContent = brlCompact(s.totalCategorias);
      $('#donut-center-pct').textContent = s.renda > 0 ? `${pct((s.totalCategorias / s.renda) * 100)} da renda` : '';
    }
  }

  function renderDiagnosis(s) {
    const d = diagnose(s);
    const badge = $('#diag-score');
    badge.textContent = d.label;
    badge.className = `badge ${d.level === 'empty' ? '' : `badge-${d.level}`}`;

    const rowsEl = $('#diag-rows');
    rowsEl.innerHTML = d.rows.map((row) => {
      const width = Math.max(0, Math.min(100, row.pct));
      const statusText = row.level === 'ok' ? '✓ dentro do ideal' : row.key === 'future' ? '▼ abaixo do ideal' : '▲ acima do ideal';
      return `
        <div class="diag-row">
          <div class="diag-head"><strong>${row.label}</strong><span class="diag-pct status-${row.level}">${pct(row.pct)} <small>/ ideal ${row.key === 'future' ? '≥' : '≤'} ${row.ideal}%</small></span></div>
          <div class="diag-bar" aria-hidden="true"><span class="fill-${row.level}" style="width:${width}%"></span><i style="left:${row.ideal}%" data-label="${row.ideal}%"></i></div>
          <div class="diag-foot"><span>${brl(row.value)} de ${brl(row.idealValue)} recomendados</span><span class="status-${row.level}">${statusText}</span></div>
        </div>`;
    }).join('');

    $('#diag-alertas').innerHTML = d.alerts.map((a) => `<li class="alert alert-${a.level}"><span class="alert-icon" aria-hidden="true">${a.icon}</span><span>${a.text}</span></li>`).join('');
  }

  function reservaCusto(s) {
    const base = state.reserva.base;
    if (base === 'custom') return state.reserva.custom;
    if (base === 'all') return s.totalGastos;
    return s.buckets.need;
  }

  function renderReserva(s) {
    $('#base-need-val').textContent = `${brl(s.buckets.need)}/mês`;
    $('#base-all-val').textContent = `${brl(s.totalGastos)}/mês`;
    $('#reserva-custom-wrap').hidden = state.reserva.base !== 'custom';
    const r = calcReserva({ custo: reservaCusto(s), meses: state.reserva.meses, guardado: state.reserva.guardado, aporte: state.reserva.aporte });
    $('#reserva-meta').textContent = brl(r.meta);
    $('#reserva-range').textContent = r.custo > 0
      ? `${state.reserva.meses} meses de custo de vida • faixa recomendada: ${brl(r.min)} (3 meses) a ${brl(r.ideal)} (6 meses)`
      : 'Lance seus gastos ou informe um custo de vida para calcular.';
    $('#reserva-pct').textContent = pct(r.progresso, 0);
    $('#reserva-progress').style.width = `${r.progresso}%`;
    $('#reserva-progress-wrap').setAttribute('aria-valuenow', Math.round(r.progresso));
    $('#reserva-custo').textContent = brl(r.custo);
    $('#reserva-falta').textContent = brl(r.falta);
    $('#reserva-tempo').textContent = r.meta <= 0 ? '—' : r.mesesParaMeta == null ? 'Defina um aporte' : formatDuration(r.mesesParaMeta);
    $('#reserva-aporte').placeholder = s.saldo > 0 ? `${numFmt.format(s.saldo)} (sobra)` : '0,00';
    return r;
  }

  function renderMeta() {
    const m = calcMeta(state.meta);
    const nome = state.meta.nome.trim();
    $('#meta-titulo').textContent = nome ? `Progresso: ${nome}` : 'Progresso da meta';
    $('#meta-pct').textContent = pct(m.progresso, 0);
    $('#meta-progress').style.width = `${m.progresso}%`;
    $('#meta-progress-wrap').setAttribute('aria-valuenow', Math.round(m.progresso));
    const badge = $('#meta-badge');
    const out = $('#meta-resultado');
    if (m.valor <= 0) {
      badge.textContent = 'Defina uma meta';
      badge.className = 'badge badge-soft';
      out.textContent = 'Preencha o valor da meta para ver quanto guardar por mês.';
    } else if (m.falta === 0) {
      badge.textContent = '🎉 Meta atingida';
      badge.className = 'badge badge-ok';
      out.innerHTML = `Parabéns! Você já juntou <strong>${brl(m.guardado)}</strong>${nome ? ` para <strong>${escapeHtml(nome)}</strong>` : ''}.`;
    } else {
      badge.textContent = `${pct(m.progresso, 0)} concluído`;
      badge.className = 'badge badge-soft';
      out.innerHTML = `Faltam <strong>${brl(m.falta)}</strong>${nome ? ` para <strong>${escapeHtml(nome)}</strong>` : ''}. Guarde <strong>${brl(m.mensal)} por mês</strong> durante ${formatDuration(m.prazo)} para chegar lá.`;
    }
  }

  function renderSim() {
    const sim = simulate({ ...state.sim, meses: state.sim.prazo });
    lastSim = sim;
    const totalInv = sim.invested[sim.n];
    const cards = $('#sim-cards');
    const order = ['poupanca', 'cdb', 'tesouro'];
    const headline = $('#sim-resumo');

    if (totalInv <= 0) {
      headline.textContent = 'Defina um aporte mensal ou valor inicial para simular.';
      cards.innerHTML = '';
      $('#sim-bars').innerHTML = '';
      renderChart(null);
      $('#sim-rates').textContent = '';
      return;
    }

    const best = sim.products[sim.best];
    const poup = sim.products.poupanca;
    const diff = best.liquido - poup.liquido;
    headline.innerHTML = `Investindo <strong>${brl(state.sim.aporte)}/mês</strong>${state.sim.inicial > 0 ? ` + ${brl(state.sim.inicial)} iniciais` : ''} por <strong>${formatTerm(sim.n)}</strong>, você aplica ${brl(totalInv)}. ${best.key !== 'poupanca' && diff > 0.005 ? `No <strong>${best.label}</strong> você teria <strong>${brl(diff)}</strong> a mais do que na poupança.` : `A <strong>${best.label}</strong> rende mais neste cenário.`}`;

    cards.innerHTML = order.map((k) => {
      const p = sim.products[k];
      const isBest = k === sim.best;
      return `
        <div class="sim-card${isBest ? ' is-best' : ''}">
          <div class="sim-card-head"><span class="sim-card-name"><i style="background:${p.color}"></i>${p.label}</span>${isBest ? '<span class="best-tag">Melhor</span>' : ''}</div>
          <p class="sim-card-value">${brl(p.liquido)}</p>
          <p class="sim-card-gain">+ ${brl(p.rendimentoLiquido)} em juros (${pct(p.rentabilidade, 2)})</p>
          <dl>
            <div><dt>Rend. bruto</dt><dd>${brl(p.rendimentoBruto)}</dd></div>
            <div><dt>IR</dt><dd>${p.ir ? `− ${brl(p.ir)}` : 'Isento'}</dd></div>
            <div><dt>Taxa B3</dt><dd>${p.taxas > 0.004 ? `− ${brl(p.taxas)}` : 'R$ 0,00'}</dd></div>
          </dl>
        </div>`;
    }).join('');

    const max = Math.max(...order.map((k) => sim.products[k].liquido));
    $('#sim-bars').innerHTML = order.map((k) => {
      const p = sim.products[k];
      const invW = (p.investido / max) * 100;
      const gainW = Math.max(0, (p.rendimentoLiquido / max) * 100);
      return `<div class="sim-bar-row">
        <div class="sim-bar-label"><span>${p.label}</span><span>${brl(p.investido)} investido + <strong style="color:${p.color === '#94a3b8' ? '#475569' : p.color}">${brl(p.rendimentoLiquido)}</strong> juros</span></div>
        <div class="sim-bar-track" aria-hidden="true"><span class="invested" style="width:${invW}%"></span><span style="width:${gainW}%;background:${p.color}"></span></div>
      </div>`;
    }).join('');

    const r = sim.rates;
    const pctM = (x) => (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    $('#sim-rates').textContent = `Premissas: aportes no início de cada mês e taxas constantes. Rendimento mensal — Poupança: ${pctM(r.poupanca)}% (${state.sim.selic > 8.5 ? '0,5% + TR' : '70% da Selic + TR'}); CDB 100% CDI: ${pctM(r.cdb)}%; Tesouro Selic: ${pctM(r.tesouro)}%. IR regressivo calculado por aporte (22,5% a 15%); taxa B3 de 0,20% a.a. sobre o saldo do Tesouro Selic acima de R$ 10 mil. Não considera IOF (resgates < 30 dias) nem variações futuras das taxas.`;

    renderChart(sim);
  }

  /* ----- Gráfico de linhas (SVG) ----- */
  let chartGeom = null;
  function renderChart(sim) {
    const svg = $('#sim-chart');
    const legend = $('#sim-legend');
    const tooltip = $('#sim-tooltip');
    svg.textContent = '';
    tooltip.hidden = true;
    chartGeom = null;
    if (!sim) { legend.innerHTML = ''; return; }

    const W = Math.max(280, svg.clientWidth || svg.parentElement.clientWidth || 600);
    const H = Math.max(200, svg.clientHeight || 280);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pad = { l: 64, r: 14, t: 14, b: 28 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const n = sim.n;
    const keys = ['poupanca', 'cdb', 'tesouro'];
    const maxVal = Math.max(...keys.map((k) => Math.max(...sim.products[k].net)), ...sim.invested);
    const niceMax = niceCeil(maxVal * 1.04);
    const x = (m) => pad.l + (m / n) * iw;
    const y = (v) => pad.t + ih - (v / niceMax) * ih;

    // grid + eixo Y
    const gridG = svgEl('g');
    for (let i = 0; i <= 4; i++) {
      const v = (niceMax / 4) * i;
      const yy = y(v);
      gridG.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: '#e2e7ef', 'stroke-dasharray': i === 0 ? '' : '3 4' }));
      const t = svgEl('text', { x: pad.l - 8, y: yy + 4, 'text-anchor': 'end' });
      t.textContent = brlCompact(v);
      gridG.append(t);
    }
    // eixo X
    const step = xTickStep(n);
    for (let m = 0; m <= n; m += step) {
      const t = svgEl('text', { x: x(m), y: H - 8, 'text-anchor': m === 0 ? 'start' : 'middle' });
      t.textContent = m === 0 ? 'Início' : m % 12 === 0 ? `${m / 12}a` : `${m}m`;
      gridG.append(t);
    }
    svg.append(gridG);

    const pathFor = (arr) => arr.map((v, m) => `${m ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');

    // área + linha do total investido
    svg.append(svgEl('path', { d: pathFor(sim.invested), fill: 'none', stroke: '#94a3b8', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));

    const best = sim.products[sim.best];
    const areaD = `${pathFor(best.net)}L${x(n)},${y(0)}L${x(0)},${y(0)}Z`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: 'gradBest', x1: 0, x2: 0, y1: 0, y2: 1 });
    grad.append(svgEl('stop', { offset: '0%', 'stop-color': best.color, 'stop-opacity': '0.18' }));
    grad.append(svgEl('stop', { offset: '100%', 'stop-color': best.color, 'stop-opacity': '0' }));
    defs.append(grad);
    svg.append(defs);
    svg.append(svgEl('path', { d: areaD, fill: 'url(#gradBest)' }));

    keys.forEach((k) => {
      const p = sim.products[k];
      svg.append(svgEl('path', { d: pathFor(p.net), fill: 'none', stroke: p.color, 'stroke-width': k === sim.best ? 3 : 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });

    // camada interativa
    const hoverG = svgEl('g', { visibility: 'hidden' });
    const vline = svgEl('line', { y1: pad.t, y2: pad.t + ih, stroke: '#0b1f3a', 'stroke-width': 1, 'stroke-dasharray': '3 3' });
    hoverG.append(vline);
    const dots = keys.map((k) => {
      const c = svgEl('circle', { r: 4.5, fill: '#fff', stroke: sim.products[k].color, 'stroke-width': 2.5 });
      hoverG.append(c);
      return c;
    });
    svg.append(hoverG);
    const overlay = svgEl('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent' });
    svg.append(overlay);

    chartGeom = { sim, x, y, pad, iw, n, W, hoverG, vline, dots, keys };

    legend.innerHTML = keys.map((k) => `<li><i style="background:${sim.products[k].color}"></i>${sim.products[k].label}</li>`).join('') + '<li><i class="dashed"></i>Total investido</li>';
  }

  function niceCeil(v) {
    if (v <= 0) return 100;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nf = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
    return nf * exp;
  }
  function xTickStep(n) {
    if (n <= 6) return 1;
    if (n <= 12) return 2;
    if (n <= 24) return 6;
    if (n <= 72) return 12;
    if (n <= 180) return 24;
    return 60;
  }

  function handleChartPointer(e) {
    if (!chartGeom) return;
    const svg = $('#sim-chart');
    const rect = svg.getBoundingClientRect();
    const { sim, x, y, pad, iw, n, W, hoverG, vline, dots, keys } = chartGeom;
    const scale = W / rect.width;
    const px = (e.clientX - rect.left) * scale;
    if (px < pad.l - 10 || px > pad.l + iw + 10) { hideTooltip(); return; }
    const m = Math.max(0, Math.min(n, Math.round(((px - pad.l) / iw) * n)));
    const xx = x(m);
    vline.setAttribute('x1', xx);
    vline.setAttribute('x2', xx);
    keys.forEach((k, i) => {
      dots[i].setAttribute('cx', xx);
      dots[i].setAttribute('cy', y(sim.products[k].net[m]));
    });
    hoverG.setAttribute('visibility', 'visible');

    const tip = $('#sim-tooltip');
    const label = m === 0 ? 'Início (1º aporte)' : `Após ${formatDuration(m)}`;
    tip.innerHTML = `<b>${label}</b>` + keys.map((k) => `<div><span><i style="background:${sim.products[k].color}"></i>${sim.products[k].label}</span><strong>${brl(sim.products[k].net[m])}</strong></div>`).join('') + `<div><span>Investido</span><strong>${brl(sim.invested[m])}</strong></div>`;
    tip.hidden = false;
    const wrapW = rect.width;
    const tipW = tip.offsetWidth;
    let left = xx / scale + 14;
    if (left + tipW > wrapW) left = xx / scale - tipW - 14;
    tip.style.left = `${Math.max(0, left)}px`;
  }
  function hideTooltip() {
    if (chartGeom) chartGeom.hoverG.setAttribute('visibility', 'hidden');
    $('#sim-tooltip').hidden = true;
  }

  /* ---------------------------------------------------------
     Sincronização inputs <-> estado
     --------------------------------------------------------- */
  function formatInputValue(type, v) {
    if (type === 'money') return v > 0 ? numFmt.format(v) : '';
    if (type === 'percent') return Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '';
    if (type === 'int') return v ? String(v) : '';
    return v ?? '';
  }

  function hydrateInputs() {
    $$('[data-bind]').forEach((el) => {
      el.value = formatInputValue(el.dataset.type, getPath(state, el.dataset.bind));
      el.classList.remove('is-invalid');
    });
    const setRadio = (name, value) => {
      const r = $(`input[name="${name}"][value="${value}"]`);
      if (r) r.checked = true;
    };
    setRadio('reserva-base', state.reserva.base);
    setRadio('reserva-meses', state.reserva.meses);
    const presets = ['6', '12', '36', '60', '120'];
    if (presets.includes(String(state.sim.prazo))) {
      setRadio('sim-prazo', state.sim.prazo);
      $('#sim-prazo-custom-wrap').hidden = true;
    } else {
      setRadio('sim-prazo', 'custom');
      $('#sim-prazo-custom-wrap').hidden = false;
      $('#sim-prazo-custom').value = state.sim.prazo;
    }
  }

  function readBound(el) {
    const t = el.dataset.type;
    if (t === 'money' || t === 'percent') return Math.max(0, parseMoney(el.value));
    if (t === 'int') {
      const n = Math.round(parseMoney(el.value));
      return Math.min(600, Math.max(1, n || 1));
    }
    return el.value.slice(0, 60);
  }

  function bindInputs() {
    $$('[data-bind]').forEach((el) => {
      el.addEventListener('input', () => {
        setPath(state, el.dataset.bind, readBound(el));
        renderAll();
        scheduleSave();
      });
      el.addEventListener('blur', () => {
        if (el.dataset.type === 'money' || el.dataset.type === 'percent' || el.dataset.type === 'int') {
          el.value = formatInputValue(el.dataset.type, getPath(state, el.dataset.bind));
        }
      });
    });

    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'reserva-base') { state.reserva.base = t.value; if (t.value === 'custom') setTimeout(() => $('#reserva-custom').focus(), 0); }
      else if (t.name === 'reserva-meses') state.reserva.meses = +t.value;
      else if (t.name === 'sim-prazo') {
        const custom = t.value === 'custom';
        $('#sim-prazo-custom-wrap').hidden = !custom;
        if (custom) {
          const c = $('#sim-prazo-custom');
          if (!c.value) c.value = state.sim.prazo;
          state.sim.prazo = Math.min(600, Math.max(1, Math.round(+c.value) || 24));
          c.focus();
        } else state.sim.prazo = +t.value;
      } else return;
      renderAll();
      scheduleSave();
    });

    $('#sim-prazo-custom').addEventListener('input', (e) => {
      const n = Math.round(parseMoney(e.target.value));
      if (n >= 1) {
        state.sim.prazo = Math.min(600, n);
        renderAll();
        scheduleSave();
      }
    });
  }

  /* ---------------------------------------------------------
     Despesas
     --------------------------------------------------------- */
  function bindExpenseForm() {
    const form = $('#form-despesa');
    const desc = $('#desc');
    const valor = $('#valor');
    const err = $('#despesa-erro');
    const categoria = $('#categoria');

    categoria.addEventListener('change', () => {
      const isInvest = categoria.value === 'investimentos';
      $$('input[name="tipo"]').forEach((r) => { r.disabled = isInvest; });
      if (isInvest) $('input[name="tipo"][value="auto"]').checked = true;
    });

    [desc, valor].forEach((el) => el.addEventListener('input', () => { el.classList.remove('is-invalid'); el.removeAttribute('aria-invalid'); err.textContent = ''; }));
    valor.addEventListener('blur', () => { const v = parseMoney(valor.value); if (v > 0) valor.value = numFmt.format(v); });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = desc.value.trim();
      const v = round2(parseMoney(valor.value));
      const problems = [];
      if (!d) { problems.push('a descrição'); desc.classList.add('is-invalid'); desc.setAttribute('aria-invalid', 'true'); }
      if (!(v > 0)) { problems.push('um valor maior que zero'); valor.classList.add('is-invalid'); valor.setAttribute('aria-invalid', 'true'); }
      if (problems.length) {
        err.textContent = `Informe ${problems.join(' e ')}.`;
        (d ? valor : desc).focus();
        return;
      }
      const tipo = ($('input[name="tipo"]:checked') || {}).value || 'auto';
      state.despesas.push({ id: uid(), descricao: d.slice(0, 60), valor: v, categoria: categoria.value, tipo });
      form.reset();
      $$('input[name="tipo"]').forEach((r) => { r.disabled = false; });
      err.textContent = '';
      renderAll();
      saveState();
      toast(`“${d}” adicionada: ${brl(v)}`);
      desc.focus();
    });

    $('#lista-despesas').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="delete"]');
      if (!btn) return;
      const id = btn.closest('.expense').dataset.id;
      const item = state.despesas.find((x) => x.id === id);
      state.despesas = state.despesas.filter((x) => x.id !== id);
      renderAll();
      saveState();
      if (item) toast(`“${item.descricao}” removida`);
    });
  }

  function bindDonut() {
    const g = $('#donut-segments');
    const pick = (e) => { const el = e.target.closest('[data-cat]'); if (el) setActiveCat(el.dataset.cat); };
    g.addEventListener('pointerover', pick);
    g.addEventListener('focusin', pick);
    g.addEventListener('click', (e) => { const el = e.target.closest('[data-cat]'); if (el) setActiveCat(activeCat === el.dataset.cat ? null : el.dataset.cat); });
    g.addEventListener('pointerleave', () => setActiveCat(null));
    g.addEventListener('focusout', () => setActiveCat(null));
    const legend = $('#legenda');
    legend.addEventListener('pointerover', pick);
    legend.addEventListener('click', (e) => { const el = e.target.closest('[data-cat]'); if (el) setActiveCat(activeCat === el.dataset.cat ? null : el.dataset.cat); });
    legend.addEventListener('pointerleave', () => setActiveCat(null));
  }

  /* ---------------------------------------------------------
     Exemplo, reset, CSV, impressão
     --------------------------------------------------------- */
  const SAMPLE = {
    renda: 5000,
    despesas: [
      ['Aluguel', 1500, 'moradia', 'auto'],
      ['Condomínio, luz e internet', 300, 'moradia', 'auto'],
      ['Mercado', 900, 'alimentacao', 'auto'],
      ['Delivery (iFood)', 350, 'alimentacao', 'want'],
      ['Uber e combustível', 400, 'transporte', 'auto'],
      ['Plano de saúde', 250, 'saude', 'auto'],
      ['Streaming e assinaturas', 90, 'lazer', 'auto'],
      ['Bares e restaurantes', 400, 'lazer', 'auto'],
      ['Parcela do cartão', 300, 'dividas', 'auto'],
      ['Aporte mensal', 300, 'investimentos', 'auto'],
    ],
  };

  async function loadSample() {
    if (state.despesas.length || state.renda) {
      const ok = await confirmDialog({ title: 'Carregar exemplo?', message: 'Os dados de renda e despesas atuais serão substituídos por um exemplo. Deseja continuar?', ok: 'Carregar exemplo', danger: false });
      if (!ok) return;
    }
    state.renda = SAMPLE.renda;
    state.despesas = SAMPLE.despesas.map(([descricao, valor, categoria, tipo]) => ({ id: uid(), descricao, valor, categoria, tipo }));
    hydrateInputs();
    renderAll();
    saveState();
    toast('Exemplo carregado — edite à vontade!');
    $('#painel').scrollIntoView({ block: 'start' });
  }

  async function resetAll() {
    const ok = await confirmDialog({ title: 'Limpar todos os dados?', message: 'Renda, despesas, metas e simulações serão apagados deste navegador. Essa ação não pode ser desfeita. Dica: exporte o CSV antes.', ok: 'Sim, limpar tudo' });
    if (!ok) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    state = defaultState();
    activeCat = null;
    hydrateInputs();
    renderAll();
    setSaveStatus('Dados apagados deste navegador');
    toast('Todos os dados foram apagados');
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`; // evita injeção de fórmulas
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function buildCSV() {
    const s = summarize(state);
    const d = diagnose(s);
    const r = calcReserva({ custo: reservaCusto(s), meses: state.reserva.meses, guardado: state.reserva.guardado, aporte: state.reserva.aporte });
    const m = calcMeta(state.meta);
    const sim = simulate({ ...state.sim, meses: state.sim.prazo });
    const statusTxt = { ok: 'Dentro do ideal', warn: 'Atenção', danger: 'Crítico' };
    const rows = [
      ['Bolso em Dia - Relatório de Controle Financeiro'],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      [],
      ['RESUMO DO MÊS', 'Valor (R$)'],
      ['Renda líquida', csvNum(s.renda)],
      ['Gastos (necessidades + desejos)', csvNum(s.totalGastos)],
      ['Investimentos lançados', csvNum(s.investido)],
      ['Saldo do mês (sobra)', csvNum(s.saldo)],
      [],
      ['REGRA 50/30/20', 'Valor (R$)', '% da renda', 'Ideal', 'Status'],
      ...d.rows.map((x) => [x.label, csvNum(x.value), csvNum(x.pct), `${x.key === 'future' ? '>=' : '<='} ${x.ideal}%`, statusTxt[x.level]]),
      [],
      ['DESPESAS', 'Categoria', 'Classificação 50/30/20', 'Valor (R$)'],
      ...state.despesas.map((x) => [x.descricao, CATEGORIES[x.categoria].label, BUCKETS[resolveBucket(x)].short, csvNum(x.valor)]),
      ['TOTAL', '', '', csvNum(s.totalSaidas)],
      [],
      ['GASTOS POR CATEGORIA', 'Valor (R$)', '% do total'],
      ...Object.entries(s.byCat).filter(([, v]) => v > 0).map(([k, v]) => [CATEGORIES[k].label, csvNum(v), csvNum((v / s.totalCategorias) * 100)]),
      [],
      ['RESERVA DE EMERGÊNCIA', 'Valor'],
      ['Custo de vida mensal (R$)', csvNum(r.custo)],
      ['Meses de cobertura', state.reserva.meses],
      ['Meta da reserva (R$)', csvNum(r.meta)],
      ['Já guardado (R$)', csvNum(state.reserva.guardado)],
      ['Falta (R$)', csvNum(r.falta)],
      ['Progresso (%)', csvNum(r.progresso)],
      ['Tempo estimado', r.mesesParaMeta == null ? '-' : formatDuration(r.mesesParaMeta)],
      [],
      ['META PERSONALIZADA', 'Valor'],
      ['Objetivo', state.meta.nome || '-'],
      ['Valor da meta (R$)', csvNum(m.valor)],
      ['Já guardado (R$)', csvNum(m.guardado)],
      ['Prazo (meses)', m.prazo],
      ['Guardar por mês (R$)', csvNum(m.mensal)],
      [],
      ['SIMULAÇÃO DE INVESTIMENTOS'],
      ['Aporte mensal (R$)', csvNum(state.sim.aporte)],
      ['Valor inicial (R$)', csvNum(state.sim.inicial)],
      ['Prazo (meses)', sim.n],
      ['Selic (% a.a.)', csvNum(state.sim.selic)],
      ['CDI (% a.a.)', csvNum(state.sim.cdi)],
      ['TR (% a.m.)', csvNum(state.sim.tr)],
      ['Produto', 'Total investido (R$)', 'Rendimento bruto (R$)', 'IR (R$)', 'Taxa B3 (R$)', 'Valor líquido final (R$)', 'Rendimento líquido (R$)', 'Rentabilidade líquida (%)'],
      ...['poupanca', 'cdb', 'tesouro'].map((k) => {
        const p = sim.products[k];
        return [p.label, csvNum(p.investido), csvNum(p.rendimentoBruto), csvNum(p.ir), csvNum(p.taxas), csvNum(p.liquido), csvNum(p.rendimentoLiquido), csvNum(p.rentabilidade)];
      }),
    ];
    return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  }

  function exportCSV() {
    const blob = new Blob([buildCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `controle-financeiro-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Arquivo CSV gerado — abre no Excel e Google Sheets');
  }

  function buildReport() {
    const s = summarize(state);
    const d = diagnose(s);
    const r = calcReserva({ custo: reservaCusto(s), meses: state.reserva.meses, guardado: state.reserva.guardado, aporte: state.reserva.aporte });
    const m = calcMeta(state.meta);
    const sim = simulate({ ...state.sim, meses: state.sim.prazo });
    const statusTxt = { ok: '✓ Dentro do ideal', warn: '! Atenção', danger: '⚠ Crítico' };
    const strip = (html) => html.replace(/<[^>]+>/g, '');
    const catRows = Object.entries(s.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td>${CATEGORIES[k].label}</td><td class="num">${brl(v)}</td><td class="num">${pct((v / s.totalCategorias) * 100)}</td></tr>`).join('');
    const expRows = state.despesas.map((x) => `<tr><td>${escapeHtml(x.descricao)}</td><td>${CATEGORIES[x.categoria].label}</td><td>${BUCKETS[resolveBucket(x)].short}</td><td class="num">${brl(x.valor)}</td></tr>`).join('');
    const hasSim = sim.invested[sim.n] > 0;

    $('#relatorio').innerHTML = `
      <div class="rp-header">
        <div><h1>Relatório Financeiro Pessoal</h1><p>Bolso em Dia • Planilha de gastos online</p></div>
        <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      </div>
      <div class="rp-kpis">
        <div><span>Renda líquida</span><strong>${brl(s.renda)}</strong></div>
        <div><span>Gastos</span><strong>${brl(s.totalGastos)}</strong></div>
        <div><span>Investido</span><strong>${brl(s.investido)}</strong></div>
        <div><span>Saldo</span><strong>${brl(s.saldo)}</strong></div>
      </div>
      <h2>Diagnóstico da regra 50/30/20 — ${escapeHtml(d.label)}</h2>
      ${d.rows.length ? `<table><thead><tr><th>Bloco</th><th class="num">Valor</th><th class="num">% da renda</th><th class="num">Ideal</th><th>Status</th></tr></thead><tbody>
        ${d.rows.map((x) => `<tr><td>${x.label}</td><td class="num">${brl(x.value)}</td><td class="num">${pct(x.pct)}</td><td class="num">${x.key === 'future' ? '≥' : '≤'} ${x.ideal}% (${brl(x.idealValue)})</td><td class="rp-${x.level}">${statusTxt[x.level]}</td></tr>`).join('')}
      </tbody></table>` : ''}
      <ul>${d.alerts.map((a) => `<li>${escapeHtml(strip(a.text))}</li>`).join('')}</ul>
      ${catRows ? `<h2>Gastos por categoria</h2><table><thead><tr><th>Categoria</th><th class="num">Valor</th><th class="num">% do total</th></tr></thead><tbody>${catRows}</tbody></table>` : ''}
      ${expRows ? `<h2>Lançamentos</h2><table><thead><tr><th>Descrição</th><th>Categoria</th><th>Classificação</th><th class="num">Valor</th></tr></thead><tbody>${expRows}<tr><th colspan="3">Total</th><th class="num">${brl(s.totalSaidas)}</th></tr></tbody></table>` : ''}
      <h2>Reserva de emergência</h2>
      <table><tbody>
        <tr><td>Custo de vida mensal considerado</td><td class="num">${brl(r.custo)}</td></tr>
        <tr><td>Meta (${state.reserva.meses} meses)</td><td class="num">${brl(r.meta)}</td></tr>
        <tr><td>Faixa recomendada (3 a 6 meses)</td><td class="num">${brl(r.min)} a ${brl(r.ideal)}</td></tr>
        <tr><td>Já guardado / progresso</td><td class="num">${brl(state.reserva.guardado)} (${pct(r.progresso, 0)})</td></tr>
        <tr><td>Falta guardar / tempo estimado</td><td class="num">${brl(r.falta)} • ${r.mesesParaMeta == null ? '—' : formatDuration(r.mesesParaMeta)}</td></tr>
      </tbody></table>
      ${m.valor > 0 ? `<h2>Meta: ${escapeHtml(state.meta.nome || 'personalizada')}</h2>
      <table><tbody>
        <tr><td>Valor da meta</td><td class="num">${brl(m.valor)}</td></tr>
        <tr><td>Já guardado / progresso</td><td class="num">${brl(m.guardado)} (${pct(m.progresso, 0)})</td></tr>
        <tr><td>Guardar por mês (${m.prazo} meses)</td><td class="num">${brl(m.mensal)}</td></tr>
      </tbody></table>` : ''}
      ${hasSim ? `<h2>Simulação: ${brl(state.sim.aporte)}/mês${state.sim.inicial > 0 ? ` + ${brl(state.sim.inicial)} iniciais` : ''} por ${formatTerm(sim.n)}</h2>
      <table><thead><tr><th>Produto</th><th class="num">Investido</th><th class="num">Rend. bruto</th><th class="num">IR + taxas</th><th class="num">Valor líquido</th><th class="num">Ganho líquido</th></tr></thead><tbody>
        ${['poupanca', 'cdb', 'tesouro'].map((k) => { const p = sim.products[k]; return `<tr><td>${p.label}${k === sim.best ? ' ★' : ''}</td><td class="num">${brl(p.investido)}</td><td class="num">${brl(p.rendimentoBruto)}</td><td class="num">${brl(p.ir + p.taxas)}</td><td class="num"><strong>${brl(p.liquido)}</strong></td><td class="num">${brl(p.rendimentoLiquido)} (${pct(p.rentabilidade, 2)})</td></tr>`; }).join('')}
      </tbody></table>
      <p style="font-size:8.5pt;color:#555">Taxas usadas: Selic ${pct(state.sim.selic, 2)} a.a., CDI ${pct(state.sim.cdi, 2)} a.a., TR ${pct(state.sim.tr, 2)} a.m. Projeção com taxas constantes.</p>` : ''}
      <p class="rp-foot">Relatório educativo gerado localmente no seu navegador. Não constitui recomendação de investimento. Rentabilidade passada não garante rentabilidade futura.</p>`;
  }

  function printReport() {
    buildReport();
    window.print();
  }

  /* ---------------------------------------------------------
     Inicialização
     --------------------------------------------------------- */
  function init() {
    $('#ano').textContent = new Date().getFullYear();
    hydrateInputs();
    bindInputs();
    bindExpenseForm();
    bindDonut();
    renderAll();
    if (state.updatedAt) setSaveStatus(`Dados restaurados • última alteração ${new Date(state.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);

    $('#btn-exemplo').addEventListener('click', loadSample);
    $('#btn-reset').addEventListener('click', resetAll);
    $('#btn-csv').addEventListener('click', exportCSV);
    $('#btn-print').addEventListener('click', printReport);
    window.addEventListener('beforeprint', buildReport);

    const useSobra = (path, inputSel) => {
      const s = summarize(state);
      if (s.saldo <= 0) { toast(s.renda > 0 ? 'Sem sobra no orçamento — revise seus gastos.' : 'Informe sua renda e despesas primeiro.'); return; }
      setPath(state, path, round2(s.saldo));
      $(inputSel).value = numFmt.format(round2(s.saldo));
      renderAll();
      saveState();
      toast(`Usando sua sobra de ${brl(s.saldo)}/mês`);
    };
    $('#btn-reserva-sobra').addEventListener('click', () => useSobra('reserva.aporte', '#reserva-aporte'));
    $('#btn-sim-sobra').addEventListener('click', () => useSobra('sim.aporte', '#sim-aporte'));

    $$('form').forEach((f) => { if (f.id !== 'form-despesa') f.addEventListener('submit', (e) => e.preventDefault()); });

    const chartWrap = $('#sim-chart-wrap');
    chartWrap.addEventListener('pointermove', handleChartPointer);
    chartWrap.addEventListener('pointerdown', handleChartPointer);
    chartWrap.addEventListener('pointerleave', hideTooltip);
    if ('ResizeObserver' in window) {
      let lastW = 0;
      new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== lastW) { lastW = w; if (lastSim) renderChart(lastSim.invested[lastSim.n] > 0 ? lastSim : null); }
      }).observe(chartWrap);
    }

    // Sincroniza entre abas abertas
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      state = loadState();
      hydrateInputs();
      renderAll();
      setSaveStatus('Atualizado a partir de outra aba');
    });
  }

  // Exposição apenas das funções de cálculo (útil para testes automatizados)
  window.BolsoCalc = Object.freeze({ parseMoney, summarize, diagnose, calcReserva, calcMeta, simulate, monthlyRates, irRate, monthsToDays, buildCSV, getState: () => JSON.parse(JSON.stringify(state)) });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
