const professionalsDemo = [
  ['Carlos Rodríguez','Electricista','127','4.9'],
  ['María Romero','Refrigeración','94','4.8'],
  ['Diego Fernández','Plomería','81','4.7'],
  ['Norte Servicios','Mantenimiento integral','210','5.0']
];

const state = {
  screen: 'splash',
  mode: null,
  selectedProfessional: {name:'', trade:'', rating:'', ratingCount:0, jobs:0},
  job: {
  id: '',
  service: '',
  description: '',
  locality: '',
  amount: null,
  status: localStorage.getItem('jobStatus') || 'Solicitud',
  professional: ''
},
  
  messages:[
   ...JSON.parse(localStorage.getItem('messages') || '[]')
  ],
 claims: JSON.parse(localStorage.getItem('claims') || '[]'),
  rating:0
};
function migrateMissingJobIds(){
  const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
 let lastJobNumber = Math.max(
  Number(localStorage.getItem('lastJobNumber') || '125'),
  ...history.map(item => Number(String(item.id || '').replace('360-', '')) || 0)
);
  let changed = false;

  const usedIds = new Set(
    history.map(item => item.id).filter(Boolean)
  );

  history.forEach(item => {
    if(!item.id){
      let newId;

      do {
        lastJobNumber += 1;
        newId = `360-${String(lastJobNumber).padStart(5,'0')}`;
      } while(usedIds.has(newId));

      item.id = newId;
      usedIds.add(newId);
      changed = true;
    }
  });

  if(changed){
    localStorage.setItem('jobHistory', JSON.stringify(history));
    localStorage.setItem('lastJobNumber', String(lastJobNumber));
  }
}

migrateMissingJobIds();
const app = document.getElementById('app');
const money = n => n == null ? 'Presupuesto pendiente' : '$ ' + n.toLocaleString('es-AR');

function layout(content, active='inicio', titleBrand=true){
  return `<div class="shell">
    <header class="topbar">
     <div class="brand"><b>360°</b> Mantenimiento</div>
      <div class="userdot">👤</div>
    </header>
    ${content}
 
 <nav class="bottomnav">
  <button class="${active==='inicio'?'active':''}" onclick="go(state.mode === 'professional' ? 'professional-home' : 'home')">⌂<br>Inicio</button>
  <button class="${active==='trabajos'?'active':''}" onclick="go(state.mode === 'professional' ? 'professional-confirmed' : 'jobs')">🧰<br>Trabajos</button>
 ${state.mode !== 'admin' ? `<button class="${active==='mensajes'?'active':''}" onclick="go('messages')">💬<br>Mensajes</button>` : ''}
  <button class="${active==='perfil'?'active':''}" onclick="go('profile')">👤<br>Perfil</button>
</nav>
</div>`;
}

function back(title){
  return `<div class="backrow"><button c
  lass="back" onclick="historyBack()">←</button><h2>${title}</h2></div>`;
}
let historyStack=[];

function go(screen){
  if(state.screen!==screen) historyStack.push(state.screen);
  state.screen=screen; render();
}
function resolveClaim(i){
  state.claims[i].status = 'Resuelto';
  localStorage.setItem('claims', JSON.stringify(state.claims));
  render();
}
function openCurrentJob(){
  if(state.mode === 'professional'){
    go('professional-confirmed-detail');
  } else {
    const q = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

    if(q && (q.status === 'Esperando respuesta del cliente' || q.status === 'Aceptado por el cliente')){
      go('quote-received');
    } else {
      go('contracted');
    }
  }
}
 

function historyBack(){
  state.screen = historyStack.pop() || 'home'; render();
}

function render(){
  const s=state.screen;
  if(s==='splash'){
    app.innerHTML=`<div class="splash"><div><div class="big">360°</div><h1>MANTENIMIENTO 360°</h1><p>Servicios integrales, profesionales verificados.</p><button class="btn btn-light" onclick="go('role')">Comenzar</button></div></div>`;
    return;
  }
 if(s==='role'){
  app.innerHTML=`<div class="splash">
    <div>
      <div class="big">360°</div>
      <h1>¿Cómo querés ingresar?</h1>
      <p>Elegí tu tipo de cuenta</p>

      <button class="btn btn-light" onclick="state.mode='client'; go('home')">
        👤 Soy cliente
      </button>

      <button class="btn btn-light" style="margin-left:10px" onclick="state.mode='professional'; go('professional-select')">
        🧰 Soy profesional
      </button>
      <button class="btn btn-light" style="margin-left:10px"
  onclick="state.mode='admin'; go('admin-home')">
  🛡️ Administrador
</button>
    </div>
  </div>`;
  return;
  }
  if(s==='professional-select'){
  app.innerHTML=layout(`<main class="page">
    ${back('Elegir profesional')}

    <div class="card">
      <h2>🧰 ¿Qué profesional está ingresando?</h2>
      <p>Elegí la cuenta profesional para continuar.</p>

      ${professionalsDemo.map((p,i)=>`
        <button class="btn btn-outline full" type="button"
          style="margin-top:10px;text-align:left"
          onclick="localStorage.setItem('professionalAccount','${p[0]}'); state.selectedProfessionalIndex=${i}; go('professional-home')">
          <b>${p[0]}</b><br>
          <span>${
  (
    JSON.parse(
      localStorage.getItem('professionalSpecialties_' + p[0]) || 'null'
    ) || [p[1]]
  ).join(' - ')
}</span>
        </button>
      `).join('')}
    </div>
  </main>`,'perfil');

  return;
}
 if(s==='admin-home'){
   const pendingSpecialties = JSON.parse(
  localStorage.getItem('pendingSpecialties') || '[]'
);
   window.approveSpecialty = function(index){
  const pending = JSON.parse(
    localStorage.getItem('pendingSpecialties') || '[]'
  );

  const approved = JSON.parse(
    localStorage.getItem('approvedSpecialties') || '[]'
  );

  const item = pending[index];
  if(!item) return;

  const alreadyApproved = approved.some(
    name => String(name).toLowerCase() === String(item.name).toLowerCase()
  );

  if(!alreadyApproved){
    approved.push(item.name);
  }

  pending.splice(index, 1);

  localStorage.setItem(
    'pendingSpecialties',
    JSON.stringify(pending)
  );

  localStorage.setItem(
    'approvedSpecialties',
    JSON.stringify(approved)
  );

  go('admin-home');
};

window.rejectSpecialty = function(index){
  const pending = JSON.parse(
    localStorage.getItem('pendingSpecialties') || '[]'
  );

  pending.splice(index, 1);

  localStorage.setItem(
    'pendingSpecialties',
    JSON.stringify(pending)
  );

  go('admin-home');
};
  app.innerHTML=layout(`<main class="page">
    ${back('Administración')}

    <div class="card">
      <h2>🛡️ Panel de Administración</h2>
      <p>Gestión de reclamos de Mantenimiento 360°.</p>
<h3 style="margin-top:24px">🧰 Especialidades pendientes de aprobación</h3>

${
  pendingSpecialties.length
    ? pendingSpecialties.map((item, index) => `
        <div class="card" style="margin-top:10px">
          <b>${item.name}</b>
          <p>Estado: ${item.status || 'Pendiente'}</p>

          <div class="actions">
            <button class="btn btn-primary"
              type="button"
              onclick="approveSpecialty(${index})">
              ✅ Aprobar
            </button>

            <button class="btn btn-outline"
              type="button"
              onclick="rejectSpecialty(${index})">
              ❌ Rechazar
            </button>
          </div>
        </div>
      `).join('')
    : '<p>No hay especialidades pendientes.</p>'
}

<hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
      <h3>⚠️ Pendientes: ${state.claims.filter(c => c.status !== 'Resuelto').length} | ✅ Resueltos: ${state.claims.filter(c => c.status === 'Resuelto').length}</h3>

${
  state.claims.length
    ? state.claims
        .map((c, index) => ({ c, index }))
        .sort((a, b) => {
          const numA = Number(String(a.c.id || '').replace(/\D/g, '')) || -1;
          const numB = Number(String(b.c.id || '').replace(/\D/g, '')) || -1;
          return numB - numA;
        })
        .map(({ c, index }) => `
          <div class="card" style="margin-top:12px">

            ${
              c.status !== 'Resuelto'
                ? `
                  <button class="btn btn-primary" type="button" onclick="resolveClaim(${index})">
                    ✅ Resolver reclamo
                  </button>
                `
                : `
                  <p><b>✅ Reclamo resuelto</b></p>
                `
            }

            <p><b>Trabajo #:</b> ${c.id || 'Sin ID'}</p>
            <p><b>Profesional:</b> ${c.professional || 'Sin asignar'}</p>
            <p><b>Motivo:</b> ${c.reason}</p>
            <p><b>Detalle:</b> ${c.text}</p>
            <p><b>Estado:</b> ${c.status}</p>
${c.id ? `
  <button class="btn btn-outline full" type="button"
    onclick="localStorage.setItem('chatJob', JSON.stringify({
      id:'${c.id}',
      professional:'${c.professional || 'Profesional'}',
      status:'Reclamo'
    })); go('chat')">
    💬 Ver chat del trabajo
  </button>
` : ''}
          </div>
        `).join('')
    : '<p>No hay reclamos registrados.</p>'
}
    </div>
  </main>`,'inicio');

  return;
}
  if(s==='professional-home'){
    const professionalAccount = localStorage.getItem('professionalAccount') || 'Profesional';
  app.innerHTML=layout(`<main class="page">
    <section class="hero">
      <div>
        <small>PANEL PROFESIONAL</small>
       <h1>Hola, ${professionalAccount}.</h1>
        <p>Desde acá vas a poder recibir solicitudes, enviar presupuestos y gestionar tus trabajos.</p>
      </div>
      <div class="big360">360°</div>
    </section>

    <h3 class="section-title">Mi actividad</h3>
<button class="card specialty" type="button" onclick="go('professional-requests')" style="cursor:pointer;width:100%;text-align:left">
  <div class="icon">📥</div>
  <b>Solicitudes disponibles</b>
</button>
      <button class="card specialty" type="button" onclick="go('professional-quotes')" style="cursor:pointer;width:100%;text-align:left">
  <div class="icon">💰</div>
  <b>Mis presupuestos</b>
</button>

      <button class="card specialty" type="button" onclick="go('professional-confirmed')" style="cursor:pointer;width:100%;text-align:left">
  <div class="icon">🧰</div>
  <b>Trabajos confirmados</b>
</button>

      <div class="card specialty">
        <div class="icon">💬</div>
        <b>Mensajes</b>
      </div>

     <div class="card specialty" onclick="go('profile')" style="cursor:pointer">
        <div class="icon">👤</div>
        <b>Mi perfil</b>
      </div>

      <div class="card specialty">
        <div class="icon">✅</div>
        <b>Profesional verificado</b>
      </div>
    </div>
  </main>`,'inicio');

  return;
}
 if(s==='professional-requests'){
  app.innerHTML=layout(`<main class="page">
    <div class="backrow"><button class="back" onclick="state.screen='professional-home'; render()">←</button><h2>Solicitudes disponibles</h2></div>

    <div class="list">
${(() => {
  const request = JSON.parse(localStorage.getItem('clientRequest') || 'null');
const jobStatus = localStorage.getItem('jobStatus') || 'Solicitud';
 if(!request || request.status === 'Presupuesto enviado' || ['Confirmado', 'En curso', 'Finalizado'].includes(jobStatus)) return '';
  return `
    <div class="card pro">
      <div>
        <b>${request.service}</b>
        <div class="notice" style="margin:4px 0">
          ${request.locality} · Nueva solicitud
        </div>
        <p>${request.description}</p>
      </div>

     <button class="btn btn-primary"style="min-width:140px" type="button" onclick="Object.assign(state.job, JSON.parse(localStorage.getItem('clientRequest') || '{}')); go('professional-request-detail')">Ver solicitud</button>
    </div>
  `;
})()}
     
      </div>

    </div>
  </main>`,'trabajos');

  return;
}
if(s==='professional-quotes'){
 const professionalAccount = localStorage.getItem('professionalAccount') || '';

const professionalQuotes = JSON.parse(
  localStorage.getItem('professionalQuotes') || '[]'
);

const rawQuote = JSON.parse(
  localStorage.getItem('professionalQuote') || 'null'
);

const myQuotes = professionalQuotes.filter(
  item => item.professional === professionalAccount
);
if(
  rawQuote &&
  rawQuote.professional === professionalAccount
){
  const historyIndex = professionalQuotes.findIndex(
    item => item.id === rawQuote.id &&
            item.professional === rawQuote.professional
  );

  const myIndex = myQuotes.findIndex(
    item => item.id === rawQuote.id
  );

  if(historyIndex >= 0){
    professionalQuotes[historyIndex] = rawQuote;

    if(myIndex >= 0){
      myQuotes[myIndex] = rawQuote;
    }
  }else{
    professionalQuotes.push(rawQuote);
    myQuotes.push(rawQuote);
  }

  localStorage.setItem(
    'professionalQuotes',
    JSON.stringify(professionalQuotes)
  );
}
  app.innerHTML=layout(`<main class="page">
    ${back('Mis presupuestos')}

    <div class="card">
      <h2>💰 Mis presupuestos</h2>
      <p>Presupuestos enviados por ${professionalAccount}.</p>
    </div>

  ${
  myQuotes.length
    ? myQuotes
  .slice()
  .sort((a, b) => {
    const numA = Number(String(a.id || '').replace(/\D/g, '')) || -1;
    const numB = Number(String(b.id || '').replace(/\D/g, '')) || -1;
    return numB - numA;
  })
  .map(q => `
        <div class="card">
          <p><b>Trabajo #:</b> ${q.id || 'Sin ID'}</p>
          <b>${q.specialty || 'Servicio'}</b>
          <p>📍 ${q.location || ''}</p>
          <p>${q.job || ''}</p>
          <p><b>Importe:</b> $${Number(q.amount || 0).toLocaleString('es-AR')}</p>
          <p><b>Detalle:</b> ${q.text || 'Sin detalle'}</p>
          <p><b>Estado:</b> ${
  q.status === 'Finalizado'
    ? '🏁 Finalizado'
    : q.status === 'En curso'
      ? '🟡 En curso'
      : q.status === 'Confirmado'
        ? '✅ Confirmado'
        : '⏳ ' + (q.status || 'Sin estado')
}</p>
        </div>
      `).join('')
    : `
        <div class="card">
          <p>No hay presupuestos para esta cuenta profesional.</p>
        </div>
      `
}
  </main>`,'trabajos');

  return;
}
  if(s==='professional-confirmed'){
  const professionalAccount = localStorage.getItem('professionalAccount') || '';
  const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
  const currentQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
if(currentQuote && !currentQuote.professional){
  const quoteTrade =
    currentQuote.specialty === 'Electricidad'
      ? 'Electricista'
      : currentQuote.specialty;

  const matchedProfessional = professionalsDemo.find(
    p => p[1] === quoteTrade
  );

  if(matchedProfessional){
    currentQuote.professional = matchedProfessional[0];
    localStorage.setItem('professionalQuote', JSON.stringify(currentQuote));
  }
}
  const professionalJobs = history.filter(
    item => item.professional === professionalAccount
  );

  if(
    currentQuote &&
    currentQuote.professional === professionalAccount &&
    !professionalJobs.some(item => item.id === currentQuote.id)
  ){
    professionalJobs.push(currentQuote);
  }

  app.innerHTML=layout(`<main class="page">
    ${back('Trabajos confirmados')}

    <div class="card">
      <h2>🧰 Trabajos confirmados</h2>
      <p>Trabajos de ${professionalAccount}.</p>
    </div>

    ${
      professionalJobs.length
       ? professionalJobs
  .slice()
  .sort((a, b) => {
    const numA = Number(String(a.id || '').replace(/\D/g, '')) || -1;
    const numB = Number(String(b.id || '').replace(/\D/g, '')) || -1;
    return numB - numA;
  })
  .map(j=>`
            <button class="card" type="button"
              onclick="localStorage.setItem('selectedProfessionalJobId','${j.id || ''}'); go('professional-confirmed-detail')"
              style="cursor:pointer;width:100%;text-align:left">

              <p><b>Trabajo #:</b> ${j.id || 'Sin ID'}</p>
              <b>${j.specialty || state.job.service}</b>
              <p>📍 ${j.location || state.job.locality}</p>
              <p>${j.job || state.job.description}</p>
              <p><b>Importe:</b> $${Number(j.amount || 0).toLocaleString('es-AR')}</p>
              <p><b>Estado:</b> ${
                j.status === 'Finalizado'
                  ? '🏁 Finalizado'
                  : j.status === 'En curso'
                    ? '🟡 En curso'
                    : '✅ Confirmado'
              }</p>
            </button>
          `).join('')
        : '<div class="card"><p>No hay trabajos para esta cuenta profesional.</p></div>'
    }

  </main>`,'trabajos');

  return;
}
 if(s==='professional-confirmed-detail'){
 const selectedProfessionalJobId = localStorage.getItem('selectedProfessionalJobId');
const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
const currentQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

const confirmedQuote =
  history.find(item => item.id === selectedProfessionalJobId) ||
  (currentQuote?.id === selectedProfessionalJobId ? currentQuote : null) ||
  currentQuote;
if(confirmedQuote){
  localStorage.setItem('chatJob', JSON.stringify(confirmedQuote));
}
  app.innerHTML=layout(`<main class="page">
    ${back('Detalle del trabajo')}

    <div class="card">
      <h2>🧰 ${confirmedQuote?.status === 'Finalizado' ? 'Trabajo finalizado' : confirmedQuote?.status === 'En curso' ? 'Trabajo en curso' : 'Trabajo confirmado'}</h2>
      <p><b>Trabajo #:</b> ${confirmedQuote?.id || state.job.id}</p>
      <p><b>Servicio:</b> ${confirmedQuote ? confirmedQuote.specialty : 'Electricidad'}</p>
      <p><b>Localidad:</b> ${confirmedQuote ? confirmedQuote.location : 'San Isidro'}</p>
      <p><b>Trabajo:</b> ${confirmedQuote ? confirmedQuote.job : 'Revisión de instalación eléctrica'}</p>
      <p><b>Importe:</b> $${confirmedQuote ? Number(confirmedQuote.amount).toLocaleString('es-AR') : '0'}</p>
      <p><b>Detalle:</b> ${confirmedQuote ? confirmedQuote.text : 'Sin detalle'}</p>
      
<p><b>Estado:</b> ${
  confirmedQuote && confirmedQuote.status === 'Finalizado'
    ? '🏁 Finalizado'
    : confirmedQuote && confirmedQuote.status === 'En curso'
      ? '🟡 En curso'
      : '✅ Confirmado'
}</p>
    <button class="btn btn-primary full" type="button" onclick="go('chat')">
      💬 Mensajes
    </button>
${state.claims.some(claim => claim.id === confirmedQuote?.id) ? `
  <button class="btn btn-primary full" type="button"
    onclick="localStorage.setItem('claimJobId','${confirmedQuote?.id || state.job.id}'); go('claim')">
    ⚠️ Ver reclamo
  </button>
` : ''}

${confirmedQuote && confirmedQuote.status === 'Finalizado'
  ? '<button class="btn btn-primary full" type="button" disabled>🏁 Trabajo finalizado</button>'
  : confirmedQuote && confirmedQuote.status === 'En curso'
    ? '<button class="btn btn-primary full" type="button" onclick="finishConfirmedJob()">✅ Finalizar trabajo</button>'
    : '<button class="btn btn-primary full" type="button" onclick="startConfirmedJob()">▶️ Iniciar trabajo</button>'
}
  </main>`,'trabajos');

  return;
}
  if(s==='professional-request-detail'){
  
    app.innerHTML=layout(`<main class="page">
    <div class="form">
      ${back('Detalle de solicitud')}

      <div class="card">
       <h2>${state.job.service}</h2>
       <p><b>Trabajo #:</b> ${state.job.id || 'Sin ID'}</p>
        <p><b>Localidad:</b> ${state.job.locality}</p>
        <p><b>Trabajo:</b> ${state.job.description}</p>
        
      </div>

      <div class="card" style="margin-top:14px">
        <h3>Enviar presupuesto</h3>

        <div class="field">
          <label>Importe</label>
          <input id="proAmount" type="number" placeholder="Ej.: 85000">
        </div>

        <div class="field">
          <label>Detalle del presupuesto</label>
          <textarea id="proQuoteText" placeholder="Describí mano de obra, materiales, tiempo estimado..."></textarea>
        </div>

        <button class="btn btn-primary full" onclick="sendProfessionalQuote()">
          Enviar presupuesto
        </button>
      </div>
    </div>
  </main>`,'trabajos');

  return;
}
  if(s==='home'){
    if(state.mode === 'professional'){
  go('professional-requests');
  return;
}
    app.innerHTML=layout(`<main class="page">
      <section class="hero">
        <div><small>SERVICIOS INTEGRALES</small><h1>Encontrá al profesional que necesitás.</h1>
        <p>Solicitá presupuestos, compará profesionales y contratá dentro de la plataforma.</p>
        <button class="btn btn-light" onclick="go('request')">Solicitar servicio</button></div>
        <div class="big360">360°</div>
      </section>
      <h3 class="section-title">Especialidades</h3>
      <div class="grid">
       <div class="card specialty" onclick="state.job.service='Electricidad'; go('professionals')" style="cursor:pointer"><div class="icon">⚡</div><b>Electricidad</b></div>

<div class="card specialty" onclick="state.job.service='Refrigeración'; go('professionals')" style="cursor:pointer"><div class="icon">❄️</div><b>Refrigeración</b></div>

<div class="card specialty" onclick="state.job.service='Plomería'; go('professionals')" style="cursor:pointer"><div class="icon">🔧</div><b>Plomería</b></div>
      </div>
    ${(() => {
 const q = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
const savedRating = JSON.parse(localStorage.getItem('professionalRating') || 'null');
const jobRated = localStorage.getItem('jobRated') === 'true';

if(!q || q.status !== 'Finalizado' || jobRated || savedRating) return '';

  return `
    <div class="card" style="margin-top:20px">
      <h2>🏁 Trabajo finalizado</h2>
      <p><b>Profesional:</b> ${(q.specialty || state.job.service) === 'Plomería' ? 'Diego Fernández' : (q.specialty || state.job.service) === 'Refrigeración' ? 'María Romero' : 'Carlos Rodríguez'}</p>
      <p><b>Servicio:</b> ${q.specialty || 'Electricidad'}</p>
      <p><b>Importe:</b> $${Number(q.amount || 0).toLocaleString('es-AR')}</p>

      ${savedRating
  ? '<button class="btn btn-primary full" type="button" disabled>✅ Profesional calificado</button>'
  : '<button class="btn btn-primary full" type="button" onclick="go(\'rating\')">⭐ Calificar profesional</button>'
}
    </div>
  `;
})()}
    </main>`,'inicio');
    return;
  }
  if(s==='rating'){
    const ratingQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
  app.innerHTML=layout(`<main class="page">
    ${back('Calificar profesional')}

    <div class="card">
      <h2>⭐ Calificar profesional</h2>
     <p><b>Profesional:</b> ${(ratingQuote?.specialty || state.job.service) === 'Plomería' ? 'Diego Fernández' : (ratingQuote?.specialty || state.job.service) === 'Refrigeración' ? 'María Romero' : 'Carlos Rodríguez'}</p>
      <p>¿Cómo fue tu experiencia?</p>

      <div style="font-size:32px;margin:20px 0">
        <button type="button" onclick="selectRating(1)">⭐</button>
        <button type="button" onclick="selectRating(2)">⭐</button>
        <button type="button" onclick="selectRating(3)">⭐</button>
        <button type="button" onclick="selectRating(4)">⭐</button>
        <button type="button" onclick="selectRating(5)">⭐</button>
      </div>

      <p id="ratingText">Seleccioná de 1 a 5 estrellas.</p>

      <textarea id="ratingComment"
        placeholder="Contanos cómo fue el trabajo..."
        style="width:100%;min-height:120px"></textarea>

      <button class="btn btn-primary full"
        type="button"
        onclick="submitRating()">
        Enviar calificación
      </button>
    </div>
  </main>`,'trabajos');

  return;
}
  if(s==='request'){
    const approvedSpecialties = JSON.parse(
  localStorage.getItem('approvedSpecialties') || '[]'
);
    window.filterServiceOptions = function(text){
  const select = document.getElementById('service');
  if(!select) return;

  const search = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let firstMatch = null;

  Array.from(select.options).forEach(option => {
    if(option.value === '__otra__'){
      option.hidden = false;
      return;
    }

    const optionText = option.text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const match = optionText.includes(search);
    option.hidden = !match;

    if(match && !firstMatch){
      firstMatch = option;
    }
  });

  if(search && firstMatch){
    select.value = firstMatch.value;
    select.dispatchEvent(new Event('change'));
  }
};
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Solicitar servicio')}
    <div class="field">
  <label>🔎 Buscar profesión</label>
  <input
    type="text"
    placeholder="Ej.: jardin, refrigeración, pintura..."
    oninput="filterServiceOptions(this.value)"
  >
</div>
     <div class="field">
  <label>¿Qué servicio necesitás?</label>
  <select id="service" onchange="document.getElementById('customServiceField').style.display=this.value==='__otra__'?'block':'none'">
    <option>Electricidad</option>
    <option>Refrigeración</option>
    <option>Plomería</option>
    <option>Pintura</option>
    <option>Carpintería</option>
    ${approvedSpecialties
  .filter(name =>
    !['Electricidad','Refrigeración','Plomería','Pintura','Carpintería']
      .some(base => base.toLowerCase() === String(name).toLowerCase())
  )
  .map(name => `<option>${name}</option>`)
  .join('')}
    <option value="__otra__">➕ Otra especialidad</option>
  </select>
</div>

<div class="field" id="customServiceField" style="display:none">
  <label>Escribí la especialidad que necesitás</label>
  <input id="customService" placeholder="Ej.: Jardinería, Techista, Limpieza...">
  <small>Esta especialidad quedará pendiente de aprobación por Administración.</small>
</div>
      <div class="field"><label>Describí el trabajo</label><textarea id="desc" placeholder="Contanos qué necesitás reparar o instalar..."></textarea></div>
      <div class="field"><label>Localidad</label><input id="loc" placeholder="Ej.: San Isidro, Vicente López"></div>
      <div class="field"><label>Fotos (opcional)</label><div class="upload">📷 Agregar fotos del trabajo</div></div>
      <div class="notice">🔒 Por seguridad, la dirección exacta se comparte después de avanzar con el profesional.</div>
      <button class="btn btn-primary full" onclick="saveRequest()">Buscar profesionales</button>
    </div></main>`,'inicio');
    return;
  }
  if(s==='professionals'){
    const pros = professionalsDemo;
const serviceTrade = {
  'Electricidad': 'Electricista',
  'Refrigeración': 'Refrigeración',
  'Plomería': 'Plomería'
};

const filteredPros = pros.filter(p => {
  const savedSpecialties = JSON.parse(
    localStorage.getItem('professionalSpecialties_' + p[0]) || 'null'
  );

  const specialties =
    Array.isArray(savedSpecialties) && savedSpecialties.length
      ? savedSpecialties
      : [
          p[1] === 'Electricista'
            ? 'Electricidad'
            : p[1]
        ];

  return specialties.some(
    specialty =>
      String(specialty).toLowerCase() ===
      String(state.job.service).toLowerCase()
  );
});
    const jobHistory = JSON.parse(
  localStorage.getItem('jobHistory') || '[]'
);

const lastSameService = [...jobHistory]
  .reverse()
  .find(item =>
    String(item.status || '').toLowerCase() === 'finalizado' &&
    String(item.specialty || item.service || '').toLowerCase() ===
      String(state.job.service || '').toLowerCase() &&
    item.professional
  );

filteredPros.sort((a, b) => {

  // 1. Primero el último profesional usado
  // por este cliente en esta misma especialidad
  if(lastSameService?.professional){
    if(a[0] === lastSameService.professional) return -1;
    if(b[0] === lastSameService.professional) return 1;
  }

  // 2. Mejor calificación
  const ratingA = Number(a[3]) || 0;
  const ratingB = Number(b[3]) || 0;

  if(ratingB !== ratingA){
    return ratingB - ratingA;
  }

  // 3. Mayor cantidad de trabajos realizados
  const jobsA = Number(a[2]) || 0;
  const jobsB = Number(b[2]) || 0;

  if(jobsB !== jobsA){
    return jobsB - jobsA;
  }

  // 4. Si todavía empatan, orden alfabético
  return String(a[0]).localeCompare(String(b[0]), 'es');
});
    app.innerHTML=layout(`<main class="page">${back('Profesionales')}
      <div class="field"><input placeholder="🔎 Buscar especialidad o profesional"></div>
      <div class="list">${filteredPros.map((p,i)=>`<div class="card pro" onclick="selectPro(${pros.indexOf(p)})" style="cursor:pointer">
        <div class="proleft"><div class="avatar">${p[0].split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div><b>${p[0]}</b><div class="notice" style="margin:4px 0">${(
  JSON.parse(
    localStorage.getItem('professionalSpecialties_' + p[0]) || 'null'
  ) || [p[1]]
).join(' - ')} · ${p[2]} trabajos realizados</div><span class="stars">★</span> ${p[3]} · <b>✓ Verificado</b></div></div>
        <button class="btn btn-outline" onclick="selectPro(${pros.indexOf(p)})">Ver</button>
      </div>`).join('')}</div>
      <button class="btn btn-primary full" type="button" onclick="requestQuotesToTrade()" style="margin-top:20px">
  📩 Solicitar presupuesto
</button>
    </main>`,'inicio');
    return;
  }
  if(s==='professional-detail'){
 const pros = professionalsDemo;

  const p=pros[state.selectedProfessionalIndex || 0];

  app.innerHTML=layout(`<main class="page"><div class="form">
    ${back('Perfil profesional')}

    <div class="card">
      <h2>${p[0]}</h2>
      <p><b>${p[1]}</b></p>
      <p>⭐ ${p[3]} · ${p[2]} trabajos realizados</p>
      <p>✓ Profesional verificado</p>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Información profesional</h3>
      <p>Especialidad: ${p[1]}</p>
      <p>Experiencia comprobada en Mantenimiento 360°.</p>
      <p>Identidad verificada por la plataforma.</p>
    </div>

    <button class="btn btn-primary full" style="margin-top:20px"
  onclick="requestProfessionalQuote()">Solicitar presupuesto</button>

  </div></main>`,'inicio');
  return;
}
  
  if(s==='quote-received'){
  const quote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
const request = JSON.parse(localStorage.getItem('clientRequest') || 'null');
  app.innerHTML = layout(`<main class="page">
    ${back('Presupuesto recibido')}

    <div class="card">
      <h2>Presupuesto recibido</h2>
      <p><b>Trabajo #:</b> ${quote?.id || request?.id || state.job.id}</p>
     <p><b>Servicio:</b> ${request?.service || state.job.service || quote?.specialty}</p> 
      <p><b>Profesional:</b> ${quote?.professional || (request?.service === 'Plomería' ? 'Diego Fernández' : request?.service === 'Refrigeración' ? 'María Romero' : 'Carlos Rodríguez')}</p>
      <p><b>Localidad:</b> ${quote?.location || state.job.locality}</p>
      <p><b>Trabajo:</b> ${quote?.job || state.job.description}</p>
      <div class="money">${money(quote?.amount || 0)}</div>
     <p>${quote?.text || 'Presupuesto enviado por el profesional.'}</p>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="acceptQuote()">Aceptar presupuesto</button>
      <button class="btn btn-outline" onclick="rejectQuote()">Rechazar</button>
</div>
</main>`, 'trabajos');

return;
}
  if(s==='payment'){
    const paymentQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Confirmar pago')}
      <div class="card"><div>Presupuesto aprobado</div><div><b>Trabajo #:</b> ${paymentQuote?.id || state.job.id}</div><div class="money">${money(state.job.amount)}</div><small>Servicio + materiales según presupuesto</small></div>
      <div class="card" style="margin-top:14px"><label class="payopt">💳 Mercado Pago <input type="radio" name="pay" checked></label>
      <label class="payopt">🏦 Transferencia bancaria <input type="radio" name="pay"></label></div>
      <button class="btn btn-primary full" style="margin-top:20px" onclick="confirmPayment()">Pagar y contratar</button>
      <div class="notice">Versión demo: no se realizan cobros reales.</div>
    </div></main>`,'trabajos');
    return;
  }
  if(s==='contracted'){
    const contractedQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
    if(contractedQuote){
  localStorage.setItem('chatJob', JSON.stringify(contractedQuote));
}
    if (!contractedQuote && !state.job.id) {
  app.innerHTML = layout(`<main class="page">
    ${back('Mis trabajos')}
    <div class="card">
      <h2>No hay trabajo seleccionado</h2>
      <p>Cuando tengas un trabajo activo, su detalle aparecerá acá.</p>
      <button class="btn btn-primary" type="button" onclick="go('jobs')">
        Ir a Mis trabajos
      </button>
    </div>
  </main>`, 'trabajos');
  return;
}
    app.innerHTML=layout(`<main class="page">${back('Detalle del Trabajo')}
      <div class="card">
        <div class="jobhead"><div><span class="badge">${state.job.status === 'Solicitud' ? '⏳ Solicitud enviada' : '✓ ' + state.job.status}</span><h2>${contractedQuote?.specialty || state.job.service}</h2><p>${JSON.parse(localStorage.getItem('professionalQuote') || 'null')?.job || state.job.description}</p></div><div class="money">${money(state.job.amount ?? (JSON.parse(localStorage.getItem('professionalQuote') || 'null')?.amount ? Number(JSON.parse(localStorage.getItem('professionalQuote') || 'null').amount) : null))}</div></div>
        <hr style="border:0;border-top:1px solid var(--line)">
        <p><b>Profesional:</b> ${contractedQuote ? (contractedQuote.professional || (contractedQuote.specialty === 'Plomería' ? 'Diego Fernández' : contractedQuote.specialty === 'Refrigeración' ? 'María Romero' : contractedQuote.specialty === 'Electricidad' ? 'Carlos Rodríguez' : '')) : ''} · ${contractedQuote ? '✓ Verificado' : ''}</p>
    <p><b>Localidad:</b> ${contractedQuote?.location || state.job.locality}</p>
<p><b>Trabajo:</b> #${contractedQuote?.id || state.job.id}</p>
        <div class="timeline">
          <div class="step done">Solicitud</div><div class="step ${state.job.status === 'Solicitud' ? '' : 'done'}">Presupuesto</div><div class="step ${state.job.status === 'Confirmado' ? 'current' : (state.job.status === 'En curso' || state.job.status === 'Finalizado') ? 'done' : ''}">Confirmado</div><div class="step ${state.job.status === 'En curso' ? 'current' : (state.job.status === 'Finalizado' ? 'done' : '')}">En curso</div><div class="step ${state.job.status === 'Finalizado' ? 'current' : ''}">Finalizado</div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" onclick="go('chat')">💬 Abrir chat</button>
          <button class="btn btn-outline" onclick="go('jobs')">🧰 Mis trabajos</button>
          <button class="btn btn-outline" onclick="go('claim')">⚠️ Hacer reclamo</button>
        
      </div>
    </main>`,'trabajos');
    return;
  }
 if(s==='jobs'){
   if(state.mode === 'professional'){
  go('professional-requests');
  return;
}
  const q = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
  const finalizado = q && q.status === 'Finalizado';
   const pendingRequest = JSON.parse(localStorage.getItem('clientRequest') || 'null');
const hasPendingRequest = pendingRequest && pendingRequest.status === 'Solicitud enviada' && !q;
   const hasReceivedQuote = q && q.status === 'Esperando respuesta del cliente';
const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
   let historyChanged = false;

if(q && q.status === 'Finalizado'){
  const currentProfessional =
    q.specialty === 'Plomería'
      ? 'Diego Fernández'
      : q.specialty === 'Refrigeración'
        ? 'María Romero'
        : q.professional || 'Carlos Rodríguez';

  history.forEach(item => {
    if(
      item.job === q.job &&
      Number(item.amount) === Number(q.amount) &&
      (item.location || '') === (q.location || '') &&
      item.professional !== currentProfessional
    ){
      item.professional = currentProfessional;
      historyChanged = true;
    }
  
});

if(historyChanged){
  localStorage.setItem('jobHistory', JSON.stringify(history));
}
  }
  app.innerHTML=layout(`<main class="page">${back('Mis trabajos')}

    <div class="list">
      <h3>🟢 Trabajos activos</h3>

    ${hasReceivedQuote ? `
<div class="card pro">
  <div>
    <b>${pendingRequest?.service || q.specialty || state.job.service}</b>
    <div class="notice" style="margin:4px 0">
      Presupuesto recibido
    </div>
    <div class="money">${money(q.amount || 0)}</div>
    <p>${q.text || ''}</p>
  </div>
  <button class="btn btn-primary" type="button" onclick="go('quote-received')">
    Ver presupuesto
  </button>
</div>
` : hasPendingRequest ? ` 
<div class="card pro">
  <div>
    <b>${pendingRequest.service}</b>
    <div class="notice" style="margin:4px 0">
      Solicitud enviada · Esperando presupuestos
    </div>
    <p>${pendingRequest.description}</p>
    <p>${pendingRequest.locality}</p>
  </div>
</div>
`: q && !finalizado ? `
      <div class="card pro"
         onclick="go('contracted')"
         style="cursor:pointer">
           <div>
            <b>${q?.specialty || pendingRequest?.service || state.job.service}</b>
            <div class="notice" style="margin:4px 0">
              ${q?.professional || (q?.specialty === 'Plomería' ? 'Diego Fernández' : q?.specialty === 'Refrigeración' ? 'María Romero' : 'Carlos Rodríguez')} · ${q?.location || pendingRequest?.locality || state.job.locality}
            </div>
          </div>
          <button class="btn btn-primary" onclick="event.stopPropagation(); openCurrentJob()">Ver trabajo</button></div>
      
      ` : `
        <div class="notice">No tenés trabajos activos.</div>
      `}

      <h3 style="margin-top:24px">✅ Historial de trabajos finalizados</h3>

   ${history.length ? history
  .map((item, index) => ({ item, index }))
  .sort((a, b) => {
    const numA = Number(String(a.item.id || '').replace(/\D/g, '')) || -1;
    const numB = Number(String(b.item.id || '').replace(/\D/g, '')) || -1;
    return numB - numA;
  })
  .map(({ item, index }) => `
  <div class="card pro"
       onclick="localStorage.setItem('selectedHistoryIndex','${index}'); go('finished-job-detail')"
       style="cursor:pointer">
    <div>
      <b>${item.specialty || 'Servicio'}</b>
      <div class="notice" style="margin:4px 0"><b>Trabajo #:</b> ${item.id || 'Sin ID'}</div>
      <div class="notice" style="margin:4px 0">
       ${item.professional || 'Profesional'} · ${item.location || ''}
      </div>
    </div>
    <span class="badge">Finalizado</span>
  </div>
`).join('') : `
  <div class="notice">Todavía no tenés trabajos finalizados.</div>
`}

      
    </div>

    

  </main>`,'trabajos');
  return;
}

  if(s==='finished-job-detail'){
  const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
const selectedIndex = Number(localStorage.getItem('selectedHistoryIndex'));
const q = history[selectedIndex] || JSON.parse(localStorage.getItem('professionalQuote') || 'null');
    
  if(!q){
    go('jobs');
    return;
  }
const currentQuote = JSON.parse(
  localStorage.getItem('professionalQuote') || 'null'
);

const legacyRating = JSON.parse(
  localStorage.getItem('professionalRating') || 'null'
);

const jobRating = JSON.parse(
  localStorage.getItem('jobRating') || 'null'
);

const isCurrentJob =
  currentQuote &&
  q.job === currentQuote.job &&
  Number(q.amount) === Number(currentQuote.amount) &&
  (q.location || '') === (currentQuote.location || '');

const rating =
  q.rating ||
  (
    jobRating &&
    jobRating.job === q.job &&
    Number(jobRating.amount) === Number(q.amount) &&
    (jobRating.location || '') === (q.location || '')
      ? jobRating
      : null
  ) ||
  (isCurrentJob ? legacyRating : null);   

const claimForJob = state.claims.find(claim =>
  (claim.id && q.id)
    ? claim.id === q.id
    : (
        claim.job === q.job &&
        Number(claim.amount) === Number(q.amount) &&
        (claim.location || '') === (q.location || '')
      )
);
    localStorage.setItem('chatJob', JSON.stringify(q));
  app.innerHTML=layout(`<main class="page">
    ${back('Detalle del trabajo')}

    <div class="card">
      <span class="badge">Finalizado</span>

      <h2 style="margin-top:14px">
        ${q.specialty || state.job.service}
      </h2>

      <p>${q.job || state.job.description}</p>

      <hr>

      <p><b>Profesional:</b> ${q.professional || (q.specialty === 'Plomería' ? 'Diego Fernández' : q.specialty === 'Refrigeración' ? 'María Romero' : 'Carlos Rodríguez')} ✓ Verificado</p>
      <p><b>Localidad:</b> ${q.location || state.job.locality}</p>
      <p><b>Trabajo #:</b> ${q.id || state.job.id}</p>
      <p><b>Importe:</b> $${Number(q.amount || state.job.amount).toLocaleString('es-AR')}</p>
      <p><b>Estado:</b> 🏁 Finalizado</p>

      ${rating ? `
        <div class="notice" style="margin-top:18px">
          <b>Tu calificación:</b> ${'⭐'.repeat(rating.stars)}
        ${rating.comment ? `<p>${rating.comment}</p>` : ''}
        </div>
    ` : state.mode !== 'admin' ? `
  <button class="btn btn-primary full"
    type="button"
    onclick="go('rating')">
    ⭐ Calificar profesional
  </button>
` : ''}
${state.mode !== 'admin' ? `
  <button class="btn btn-outline full"
    type="button"
    onclick="go('chat')"
    style="margin-top:12px">
    💬 Mensaje
  </button>
` : ''}
      ${state.mode !== 'admin' ? `
  <button class="btn btn-outline full"
    type="button"
    onclick="go('claim')"
    style="margin-top:12px">
    ${claimForJob ? '⚠️ Ver reclamo' : '⚠️ Hacer reclamo'}
  </button>
` : ''}
    </div>
  </main>`,'trabajos');

  return;
}
  if(s==='messages'){
  const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
  const currentQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
  const professionalAccount = localStorage.getItem('professionalAccount');

  const chatIds = Object.keys(localStorage)
    .filter(k => k.startsWith('messages_360-'))
    .map(k => k.replace('messages_', ''))
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .sort((a, b) =>
      Number(String(b).replace(/\D/g, '')) -
      Number(String(a).replace(/\D/g, ''))
    );

  window.openConversation = function(id){
    const hist = JSON.parse(localStorage.getItem('jobHistory') || '[]');
    const quote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

    const job =
      hist.find(j => j.id === id) ||
      (quote?.id === id ? quote : null) ||
      { id };

    localStorage.setItem('chatJob', JSON.stringify(job));
    go('chat');
  };

  const conversations = chatIds.map(id => {
    const job =
      history.find(j => j.id === id) ||
      (currentQuote?.id === id ? currentQuote : null) ||
      { id };

    const service = job.specialty || job.service || 'Trabajo';

    const professional =
      job.professional ||
      (service === 'Plomería'
        ? 'Diego Fernández'
        : service === 'Refrigeración'
        ? 'María Romero'
        : service === 'Electricidad'
        ? 'Carlos Rodríguez'
        : 'Profesional');

    if(state.mode === 'professional' && professional !== professionalAccount){
      return '';
    }

    const status = job.status || 'Conversación';

    return `
      <div class="card" style="margin-bottom:12px;cursor:pointer"
           onclick="openConversation('${id}')">
        <b>${professional}</b>
        <p>Trabajo #${id}</p>
        <p>${service} · ${status}</p>
      </div>
    `;
  }).join('');

  app.innerHTML = layout(`
    <main class="page">
      ${back('Mensajes')}
      <h2>Mensajes</h2>

      <div class="list">
        ${conversations || '<p>No tenés conversaciones todavía.</p>'}
      </div>
    </main>
  `, 'mensajes');

  return;
}
  if(s==='chat'){
   const chatJob = JSON.parse(localStorage.getItem('chatJob') || 'null');
const chatId = chatJob?.id || state.job.id;
const chatKey = 'messages_' + chatId;

const legacyChatKey = 'messages_' + [
  chatJob?.specialty || state.job.service,
  chatJob?.job || state.job.description,
  chatJob?.amount || state.job.amount,
  chatJob?.location || state.job.locality,
  chatJob?.professional || state.job.professional
].join('|');

const chatMessages = JSON.parse(
  localStorage.getItem(chatKey) ||
  localStorage.getItem(legacyChatKey) ||
  '[]'
);
  
    app.innerHTML=layout(`<main class="page">${back('Mensajes')}
      <div class="card"><div class="jobhead"><div><h2>${chatJob?.professional || state.job.professional}</h2><div class="notice">Trabajo #${chatJob?.id || state.job.id}</div></div><span class="badge blue">${chatJob?.status || state.job.status}</span></div>
      <div class="chatbox" id="chatbox">${chatMessages.map(m=>`<div class="msg ${(m.from==='client' || m.from==='me') ? 'me' : ''}">${m.text}</div>`).join('')}</div>
     ${state.mode === 'admin'
  ? `<div class="notice">🔒 Administración puede consultar este chat por el reclamo, pero no enviar mensajes.</div>`
  : `<div class="chatinput"><input id="msg" placeholder="Escribí un mensaje..." onkeydown="if(event.key==='Enter')sendMsg()"><button class="btn btn-primary" onclick="sendMsg()">Enviar</button></div>`
}
      <div class="notice">🔒 Tus datos están protegidos. Mantené la conversación dentro de la app.</div>
      </div>
    </main>`,'mensajes');
    setTimeout(()=>{const c=document.getElementById('chatbox'); if(c)c.scrollTop=c.scrollHeight},0);
    return;
  }
  if(s==='claim'){
  const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
const selectedIndex = Number(localStorage.getItem('selectedHistoryIndex'));
const currentQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
const claimJobId = localStorage.getItem('claimJobId');
const claimJob =
  claimJobId
    ? (
        history.find(item => item.id === claimJobId) ||
        (currentQuote?.id === claimJobId ? currentQuote : null)
      )
    : (
        currentQuote?.status === 'Finalizado'
          ? (history[selectedIndex] || currentQuote)
          : currentQuote
      );

if(claimJobId){
  localStorage.removeItem('claimJobId');
}

const existingClaim = claimJob
  ? state.claims.find(claim =>
      (claim.id && claimJob.id)
        ? claim.id === claimJob.id
        : (
            claim.job === claimJob.job &&
            Number(claim.amount) === Number(claimJob.amount) &&
            (claim.location || '') === (claimJob.location || '')
          )
    )
  : null;
    if(existingClaim){
  app.innerHTML = layout(`
    <main class="page">
     ${back(existingClaim.status === 'Resuelto' ? 'Reclamo resuelto' : 'Reclamo enviado')}
      <div class="card">
       <h2>${existingClaim.status === 'Resuelto' ? '✅ Reclamo resuelto' : '⚠️ Reclamo enviado'}</h2>
        <p><b>Motivo:</b> ${existingClaim.reason}</p>
        <p><b>Detalle:</b> ${existingClaim.text}</p>
        <p><b>Estado:</b> ${existingClaim.status}</p>
        <div class="notice">
          🔒 Este reclamo es visible solamente para vos, el profesional involucrado y Administración.
        </div>
      </div>
    </main>
  `,'trabajos');
  return;
}
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Nuevo reclamo')}
      <div class="card claims"><p><b>Trabajo:</b> #${claimJob?.id || state.job.id} · ${claimJob?.specialty || state.job.service}</p>
      <div class="field"><label>Motivo</label><select id="claimReason"><option>El profesional no se presentó</option><option>Problema con el trabajo</option><option>Problema con el presupuesto</option><option>Mala atención</option><option>Otro</option></select></div>
      <div class="field"><label>Contanos qué pasó</label><textarea id="claimText" placeholder="Describí el problema..."></textarea></div>
      <div class="notice">🔐 El reclamo será visible solamente para vos, el profesional involucrado y Administración.</div>
      <button class="btn btn-red full" onclick="submitClaim()">Enviar reclamo</button></div>
    </div></main>`,'trabajos');
    return;
  }
  if(s==='rating'){
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Calificar trabajo')}
      <div class="card"><h2>¿Cómo fue tu experiencia?</h2><p>${state.job.professional} · ${state.job.service}</p>
      <div class="rating-stars">${[1,2,3,4,5].map(n=>`<button class="${n<=state.rating?'on':''}" onclick="setRating(${n})">★</button>`).join('')}</div>
      <div class="field"><label>Comentario (opcional)</label><textarea id="ratingText" placeholder="Contanos cómo fue el trabajo..."></textarea></div>
      <button class="btn btn-primary full" onclick="submitRating()">Enviar calificación</button></div>
    </div></main>`,'trabajos');
    return;
  }
  if(s==='profile'){
    const professionalAccount =
  localStorage.getItem('professionalAccount') || '';

const approvedSpecialties = JSON.parse(
  localStorage.getItem('approvedSpecialties') || '[]'
);

const baseSpecialties = [
  'Electricidad',
  'Refrigeración',
  'Plomería',
  'Pintura',
  'Carpintería'
];

const allSpecialties = [
  ...new Set([...baseSpecialties, ...approvedSpecialties])
];

const defaultSpecialty =
  professionalAccount === 'Carlos Rodríguez'
    ? 'Electricidad'
    : professionalAccount === 'María Romero'
    ? 'Refrigeración'
    : professionalAccount === 'Diego Fernández'
    ? 'Plomería'
    : '';

const specialtiesKey =
  `professionalSpecialties_${professionalAccount}`;

let professionalSpecialties = JSON.parse(
  localStorage.getItem(specialtiesKey) || 'null'
);

if(!Array.isArray(professionalSpecialties)){
  professionalSpecialties =
    defaultSpecialty ? [defaultSpecialty] : [];
}
    window.saveProfessionalSpecialties = function(){
  const checked = Array.from(
    document.querySelectorAll('input[name="professionalSpecialty"]:checked')
  ).map(input => input.value);

  if(!checked.length){
    alert('Elegí al menos una especialidad.');
    return;
  }

  localStorage.setItem(
    specialtiesKey,
    JSON.stringify(checked)
  );

  alert('Especialidades guardadas correctamente.');
  go('profile');
};
    app.innerHTML=layout(`<main class="page">${back('Perfil')}
      <div class="card"><h2>Mi cuenta</h2><p>Esta pantalla seguirá siendo demostrativa hasta conectar registro y base de datos reales.</p>
      <button
  class="btn btn-outline full"
  type="button"
  style="margin-top:12px"
  onclick="state.mode=null; go('role')">
  Cambiar tipo de cuenta
</button>
      ${state.mode === 'professional' ? `
  <div class="card" style="margin-top:14px">
    <h3>🧰 Mis especialidades</h3>
    <p><b>${professionalAccount}</b></p>

    <div style="display:grid;gap:10px;margin-top:12px">
      ${allSpecialties.map(name => `
        <label class="payopt">
          <input
            type="checkbox"
            name="professionalSpecialty"
            value="${name}"
            ${professionalSpecialties.includes(name) ? 'checked' : ''}
          >
          ${name}
        </label>
      `).join('')}
    </div>

    <button
      class="btn btn-primary full"
      type="button"
      style="margin-top:16px"
      onclick="saveProfessionalSpecialties()">
      Guardar especialidades
    </button>
  </div>
` : ''}
      <div class="kpis"><div class="card kpi"><span>Trabajos</span><strong>${state.mode === 'professional' ? JSON.parse(localStorage.getItem('jobHistory') || '[]').length : JSON.parse(localStorage.getItem('jobHistory') || '[]').length}</strong></div><div class="card kpi"><span>Mensajes</span><strong>${state.messages.length}</strong></div><div class="card kpi"><span>Reclamos</span><strong>${state.claims.length}</strong></div><div class="card kpi"><span>Calificación</span><strong>${state.mode === 'professional' ? (JSON.parse(localStorage.getItem('professionalRating') || 'null')?.stars || '-') : (JSON.parse(localStorage.getItem('jobRating') || 'null')?.stars || JSON.parse(localStorage.getItem('professionalRating') || 'null')?.stars || '-')}</strong></div></div></div></main>`,'perfil');
    
    return;
  }
}

function saveRequest(){
  const selectedService = document.getElementById('service').value;
const customService = (document.getElementById('customService')?.value || '').trim();

if(selectedService === '__otra__'){
  if(!customService){
    alert('Escribí la especialidad que necesitás.');
    return;
  }

  state.job.service = customService;
  const pendingSpecialties = JSON.parse(
  localStorage.getItem('pendingSpecialties') || '[]'
);

const alreadyExists = pendingSpecialties.some(
  item => (item.name || '').toLowerCase() === customService.toLowerCase()
);

if(!alreadyExists){
  pendingSpecialties.push({
    name: customService,
    status: 'Pendiente',
    createdAt: new Date().toISOString()
  });

  localStorage.setItem(
    'pendingSpecialties',
    JSON.stringify(pendingSpecialties)
  );
}
} else {
  state.job.service = selectedService;
}
  state.job.description=document.getElementById('desc').value || 'Trabajo solicitado desde Mantenimiento 360°';
  state.job.locality=document.getElementById('loc').value || 'San Isidro';
const lastJobNumber = Number(localStorage.getItem('lastJobNumber') || '125');
const nextJobNumber = lastJobNumber + 1;

localStorage.setItem('lastJobNumber', String(nextJobNumber));

state.job.id = `360-${String(nextJobNumber).padStart(5,'0')}`;
  localStorage.setItem('clientRequest', JSON.stringify({
    id: state.job.id,
    service: state.job.service,
    description: state.job.description,
    locality: state.job.locality,
    status: 'Buscando profesional'
  }));
localStorage.setItem('jobStatus', 'Solicitud');
  go('professionals');
}function requestQuotesToTrade(){
  const request = JSON.parse(localStorage.getItem('clientRequest') || 'null');

  if(!request){
    alert('No hay una solicitud para enviar.');
    return;
  }

  request.status = 'Solicitud enviada';

  localStorage.setItem('clientRequest', JSON.stringify(request));
  localStorage.setItem('professionalRequest', JSON.stringify(request));
localStorage.removeItem('professionalQuote');
localStorage.removeItem('professionalRating');
localStorage.removeItem('jobRated');
  alert('Solicitud de presupuesto enviada a los profesionales de ' + request.service + '.');
  go('jobs');
}
function selectPro(i){
  const names=['Carlos Rodríguez','María Romero','Diego Fernández','Norte Servicios'];
  state.selectedProfessionalIndex=i;
  state.job.professional=names[i];
  go('professional-detail');
}
function requestProfessionalQuote(){
  const request = JSON.parse(localStorage.getItem('clientRequest') || '{}');

  const quoteRequest = {
    service: request.service || state.job.service,
    description: request.description || state.job.description,
    locality: request.locality || state.job.locality,
    professional: state.job.professional,
    status: 'Solicitud enviada'
  };

  localStorage.setItem('professionalRequest', JSON.stringify(quoteRequest));
  localStorage.removeItem('professionalQuote');
  localStorage.removeItem('professionalRating');

  alert('Solicitud de presupuesto enviada al profesional.');
  go('home');
}
function acceptQuote(){
  const quote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

  if(!quote){
    alert('No se encontró el presupuesto.');
    return;
  }

  quote.status = 'Aceptado por el cliente';
  localStorage.setItem('professionalQuote', JSON.stringify(quote));

  state.job.amount = Number(quote.amount);
  state.job.status = 'Presupuesto aceptado';

  go('payment');
}
function confirmPayment(){
  state.job.status='Confirmado';localStorage.setItem('jobStatus', 'Confirmado');const q = JSON.parse(localStorage.getItem('professionalQuote') || '{}');
  state.job.id = q.id || state.job.id;
q.status = 'Confirmado';
localStorage.setItem('professionalQuote', JSON.stringify(q));
  const professionalQuotes = JSON.parse(
  localStorage.getItem('professionalQuotes') || '[]'
);

const quoteIndex = professionalQuotes.findIndex(
  item => item.id === q.id && item.professional === q.professional
);

if(quoteIndex >= 0){
  professionalQuotes[quoteIndex] = q;
}else{
  professionalQuotes.push(q);
}

localStorage.setItem(
  'professionalQuotes',
  JSON.stringify(professionalQuotes)
);
  state.job.amount=Number(JSON.parse(localStorage.getItem('professionalQuote') ||'{}').amount || state.job.amount);
  go('contracted');
}
function sendMsg(){
  const inp = document.getElementById('msg');
  if(!inp || !inp.value.trim()) return;

  const chatJob = JSON.parse(
    localStorage.getItem('chatJob') || 'null'
  );

 const chatId = chatJob?.id || state.job.id;
const chatKey = 'messages_' + chatId;

const legacyChatKey = 'messages_' + [
  chatJob?.specialty || state.job.service,
  chatJob?.job || state.job.description,
  chatJob?.amount || state.job.amount,
  chatJob?.location || state.job.locality,
  chatJob?.professional || state.job.professional
].join('|');

const messages = JSON.parse(
  localStorage.getItem(chatKey) ||
  localStorage.getItem(legacyChatKey) ||
  '[]'
);

 messages.push({
  from: state.mode === 'professional' ? 'professional' : 'client',
  text: inp.value.trim()
});
  localStorage.setItem(
    chatKey,
    JSON.stringify(messages)
  );

  render();
}
function finishJob(){
  state.job.status = 'Finalizado';

  const quote = JSON.parse(
    localStorage.getItem('professionalQuote') || '{}'
  );

  quote.status = 'Finalizado';
  quote.specialty = quote.specialty || state.job.service;
  quote.location = quote.location || state.job.locality;
  quote.job = quote.job || state.job.description;
  quote.amount = quote.amount || state.job.amount;

  localStorage.setItem(
    'professionalQuote',
    JSON.stringify(quote)
  );
const history = JSON.parse(
  localStorage.getItem('jobHistory') || '[]'
);

history.push({
  ...quote,
  id: quote.id || state.job.id,
  professional: state.job.professional,
  finishedAt: new Date().toISOString()
});

localStorage.setItem(
  'jobHistory',
  JSON.stringify(history)
);
  go('rating');
}
function submitRating(){
  if(!state.rating){
    alert('Elegí de 1 a 5 estrellas.');
    return;
  }

  const comment = document.getElementById('ratingComment')?.value.trim() || '';

 const currentQuote = JSON.parse(
  localStorage.getItem('professionalQuote') || 'null'
);

const rating = {
  stars: state.rating,
  comment: comment,
  createdAt: new Date().toISOString(),
  job: currentQuote?.job || state.job.description,
  amount: Number(currentQuote?.amount || state.job.amount || 0),
  location: currentQuote?.location || state.job.locality,
  professional: currentQuote?.professional || state.job.professional
};

localStorage.setItem('jobRating', JSON.stringify(rating));
localStorage.setItem('jobRated', 'true');

const history = JSON.parse(
  localStorage.getItem('jobHistory') || '[]'
);

const ratingIndex = currentQuote
  ? history.findIndex(item =>
      item.job === currentQuote.job &&
      Number(item.amount) === Number(currentQuote.amount) &&
      (item.location || '') === (currentQuote.location || '')
    )
  : -1;

if(ratingIndex >= 0){
  history[ratingIndex].rating = rating;
  localStorage.setItem('jobHistory', JSON.stringify(history));
}
  alert('Calificación guardada correctamente.');
  go('jobs');
}
function submitClaim(){
  const reason = document.getElementById('claimReason').value;
  const text = document.getElementById('claimText').value.trim();

  if(!text){
    alert('Contanos brevemente qué pasó.');
    return;
  }

  const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
  const selectedIndex = Number(localStorage.getItem('selectedHistoryIndex'));
  const currentQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

  const claimJob =
    currentQuote?.status === 'Finalizado'
      ? (history[selectedIndex] || currentQuote)
      : currentQuote;

  state.claims.push({
    reason,
    text,
    status: 'En revisión',
    id: claimJob?.id || state.job.id,
    job: claimJob?.job || state.job.description,
    amount: Number(claimJob?.amount || state.job.amount || 0),
    location: claimJob?.location || state.job.locality,
    professional: claimJob?.professional || state.job.professional
  });

  localStorage.setItem('claims', JSON.stringify(state.claims));

  alert('Reclamo enviado. Administración podrá revisarlo.');

  if(claimJob?.status === 'Finalizado'){
    go('finished-job-detail');
  }else{
    go('contracted');
  }
}
function resolveClaim(i){
  const pendingClaims = state.claims.filter(c => c.status !== 'Resuelto');
  const claim = pendingClaims[i];

  if(!claim) return;

  const originalIndex = state.claims.indexOf(claim);

  if(originalIndex === -1) return;

  state.claims[originalIndex].status = 'Resuelto';
  localStorage.setItem('claims', JSON.stringify(state.claims));

  alert('Reclamo marcado como resuelto.');
  go('admin-home');
}
function sendProfessionalQuote(){
  const amount=document.getElementById('proAmount').value;
  const text=document.getElementById('proQuoteText').value.trim();

  if(!amount){
    alert('Ingresá el importe del presupuesto.');
    return;
  }

  if(!text){
    alert('Agregá un detalle del presupuesto.');
    return;
  }
const currentRequest = JSON.parse(localStorage.getItem('clientRequest') || 'null');
  const quote = {
    id: currentRequest?.id || state.job.id,
 amount: Number(String(amount).replace(/\./g, '').replace(',', '.')),
  text: text,
 specialty: currentRequest?.service || state.job.service,
 location: currentRequest?.locality || state.job.locality,
    professional: localStorage.getItem('professionalAccount') || state.job.professional,
 job: currentRequest?.description || state.job.description,
  status: 'Esperando respuesta del cliente'
};

localStorage.setItem('professionalQuote', JSON.stringify(quote));
  const professionalQuotes = JSON.parse(
  localStorage.getItem('professionalQuotes') || '[]'
);

const existingQuoteIndex = professionalQuotes.findIndex(
  item => item.id === quote.id && item.professional === quote.professional
);

if(existingQuoteIndex >= 0){
  professionalQuotes[existingQuoteIndex] = quote;
}else{
  professionalQuotes.push(quote);
}

localStorage.setItem(
  'professionalQuotes',
  JSON.stringify(professionalQuotes)
);
  if(currentRequest){
  currentRequest.status = 'Presupuesto enviado';
  localStorage.setItem('clientRequest', JSON.stringify(currentRequest));
}
  alert('Presupuesto enviado correctamente.');
  go('professional-home');
}
render();
function startConfirmedJob(){
  const quote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

  if(!quote){
    alert('No hay un trabajo confirmado.');
    return;
  }

  quote.status = 'En curso'; state.job.status = 'En curso';
  localStorage.setItem('professionalQuote', JSON.stringify(quote));
localStorage.setItem('jobStatus', 'En curso');
  alert('Trabajo iniciado correctamente.');
  go('professional-confirmed-detail');
}


function finishConfirmedJob(){
  const quote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

  if(!quote){
    alert('No hay un trabajo en curso.');
    return;
  }

  quote.status = 'Finalizado';
 
state.job.status = 'Finalizado';
localStorage.setItem('jobStatus', 'Finalizado');
const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
const professionalName =
  quote.specialty === 'Plomería'
    ? 'Diego Fernández'
    : quote.specialty === 'Refrigeración'
      ? 'María Romero'
      : quote.professional || 'Carlos Rodríguez';

quote.professional = professionalName;
localStorage.setItem('professionalQuote', JSON.stringify(quote));
const existingIndex = history.findIndex(item =>
  quote.id
    ? item.id === quote.id
    : (
        item.job === quote.job &&
        Number(item.amount) === Number(quote.amount) &&
        (item.location || '') === (quote.location || '')
      )
);

if(existingIndex >= 0){
  history[existingIndex] = {
    ...history[existingIndex],
    ...quote,
   id: quote.id || history[existingIndex].id || state.job.id,
    professional: professionalName
  };
}else{
  history.push({
    ...quote,
   id: quote.id || state.job.id,
    professional: professionalName,
    finishedAt: new Date().toISOString()
  });
}
localStorage.setItem('jobHistory', JSON.stringify(history));
  alert('Trabajo finalizado correctamente.');
  go('professional-confirmed-detail');
}
let selectedRating = 0;

function selectRating(value){
  selectedRating = value;

  const text = document.getElementById('ratingText');
  if(text){
    text.textContent = 'Seleccionaste ' + value + ' estrella' + (value > 1 ? 's' : '') + '.';
  }

}

function submitRating(){
  if(selectedRating === 0){
    alert('Seleccioná una calificación de 1 a 5 estrellas.');
    return;
  }

  const comment = document.getElementById('ratingComment')?.value.trim() || '';

  const rating = {
    stars: selectedRating,
    comment: comment,
    professional: 'Carlos Rodríguez',
    createdAt: new Date().toISOString()
  };
const oldAverage = Number(state.selectedProfessional.rating);
const oldCount = state.selectedProfessional.ratingCount;
const newAverage = ((oldAverage * oldCount) + selectedRating) / (oldCount + 1);

state.selectedProfessional.rating = newAverage.toFixed(1);
state.selectedProfessional.ratingCount = oldCount + 1;
  
  localStorage.setItem('professionalRating', JSON.stringify(rating));
localStorage.setItem('jobRating', JSON.stringify(rating));
localStorage.setItem('jobRated', 'true');
  alert('Calificación enviada correctamente. ¡Gracias!');
  go('home');
}

render();
