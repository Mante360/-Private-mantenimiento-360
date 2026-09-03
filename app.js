
const state = {
  screen: 'splash',
  mode: null,
  selectedProfessional: {name:'Carlos Rodríguez', trade:'Electricista', rating:'4.9',ratingCount:127, jobs:127},
  job: {
    id:'360-00125',
    service:'Electricidad',
    description:'Revisión de instalación eléctrica',
    locality:'San Isidro',
    amount: null,
    status:'Confirmado',
    professional:'Carlos Rodríguez'
  },
  messages:[
    {from:'pro', text:'Hola, ya recibí la confirmación del trabajo.'},
    {from:'me', text:'Perfecto. ¿Cuándo podrías venir?'},
    {from:'pro', text:'Mañana a las 10:00 me queda bien.'}
  ],
  claims:[],
  rating:0
};

const app = document.getElementById('app');
const money = n => n == null ? 'Presupuesto pendiente' : '$ ' + n.toLocaleString('es-AR');

function layout(content, active='inicio', titleBrand=true){
  return `<div class="shell">
    <header class="topbar">
      <div class="brand"><b>360°</b> Mantenimiento 360°</div>
      <div class="userdot">👤</div>
    </header>
    ${content}
 
 <nav class="bottomnav">
  <button class="${active==='inicio'?'active':''}" onclick="go('home')">⌂<br>Inicio</button>
  <button class="${active==='trabajos'?'active':''}" onclick="go('jobs')">🧰<br>Trabajos</button>
  <button class="${active==='mensajes'?'active':''}" onclick="go('chat')">💬<br>Mensajes</button>
  <button class="${active==='perfil'?'active':''}" onclick="go('profile')">👤<br>Perfil</button>
</nav>
</div>`;
}

function back(title){
  return `<div class="backrow"><button class="back" onclick="historyBack()">←</button><h2>${title}</h2></div>`;
}
let historyStack=[];

function go(screen){
  if(state.screen!==screen) historyStack.push(state.screen);
  state.screen=screen; render();
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

      <button class="btn btn-light" style="margin-left:10px" onclick="state.mode='professional'; go('professional-home')">
        🧰 Soy profesional
      </button>
    </div>
  </div>`;
  return;
  }
 if(s==='professional-home'){
  app.innerHTML=layout(`<main class="page">
    <section class="hero">
      <div>
        <small>PANEL PROFESIONAL</small>
        <h1>Hola, profesional.</h1>
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

      <div class="card specialty">
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
    ${back('Solicitudes disponibles')}

    <div class="list">
${(() => {
  const request = JSON.parse(localStorage.getItem('clientRequest') || 'null');

  if(!request) return '';

  return `
    <div class="card pro">
      <div>
        <b>${request.service}</b>
        <div class="notice" style="margin:4px 0">
          ${request.locality} · Nueva solicitud
        </div>
        <p>${request.description}</p>
      </div>

      <button class="btn btn-primary"
        type="button"
        onclick="go('professional-request-detail')">
        Ver solicitud
      </button>
    </div>
  `;
})()}
      <div class="card pro">
        <div>
          <b>Electricidad</b>
          <div class="notice" style="margin:4px 0">
            San Isidro · Revisión de instalación eléctrica
          </div>
          <p>Cliente solicita revisión de tablero y tomacorrientes.</p>
        </div>

        <button class="btn btn-primary" onclick="go('professional-request-detail')">
          Ver solicitud
        </button>
      </div>

      <div class="card pro">
        <div>
          <b>Refrigeración</b>
          <div class="notice" style="margin:4px 0">
            Vicente López · Aire acondicionado
          </div>
          <p>Equipo split no enfría correctamente.</p>
        </div>

        <button type="button" class="btn btn-outline"
        onclick="go('professional-request-detail')">
          Ver solicitud
        </button>
      </div>

    </div>
  </main>`,'trabajos');

  return;
}
if(s==='professional-quotes'){
  const savedQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
  app.innerHTML=layout(`<main class="page">
    ${back('Mis presupuestos')}

    <div class="card">
      <h2>💰 Mis presupuestos</h2>
      <p>Presupuestos enviados a clientes</p>
    </div>

    <div class="card">
  <b>${savedQuote ? savedQuote.specialty : 'Electricidad'}</b>
  <p>📍 ${savedQuote ? savedQuote.location : 'San Isidro'}</p>
  <p>${savedQuote ? savedQuote.job : 'Revisión de instalación eléctrica'}</p>
  <p><b>Importe: $${savedQuote ? Number(savedQuote.amount).toLocaleString('es-AR') : '0'}</b></p>
  <p>Detalle: ${savedQuote ? savedQuote.text : 'Sin detalle'}</p>
  <p>Estado: ⏳ ${savedQuote ? savedQuote.status : 'Sin presupuesto enviado'}</p>
</div>

  </main>`,'trabajos');

  return;
}
  if(s==='professional-confirmed'){
  const confirmedQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
    app.innerHTML=layout(`<main class="page">
    ${back('Trabajos confirmados')}

    <div class="card">
      <h2>🧰 Trabajos confirmados</h2>
      <p>Trabajos aceptados por clientes.</p>
    </div>

   <button class="card" type="button" onclick="go('professional-confirmed-detail')" style="cursor:pointer;width:100%;text-align:left">
  <b>${confirmedQuote ? confirmedQuote.specialty : 'Electricidad'}</b>
  <p>📍 ${confirmedQuote ? confirmedQuote.location : 'San Isidro'}</p>
  <p>${confirmedQuote ? confirmedQuote.job : 'Revisión de instalación eléctrica'}</p>
  <p><b>Importe:</b> $${confirmedQuote ? Number(confirmedQuote.amount).toLocaleString('es-AR') : '0'}</p>
  <p><b>Detalle:</b> ${confirmedQuote ? confirmedQuote.text : 'Sin detalle'}</p>
 <p><b>Estado:</b> ${confirmedQuote && confirmedQuote.status === 'En curso' ? '🟡 En curso' : '✅ Confirmado'}</p>
</button>

  </main>`,'trabajos');

  return;
}
 if(s==='professional-confirmed-detail'){
  const confirmedQuote = JSON.parse(localStorage.getItem('professionalQuote') || 'null');

  app.innerHTML=layout(`<main class="page">
    ${back('Detalle del trabajo')}

    <div class="card">
      <h2>🧰 Trabajo confirmado</h2>
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
    app.innerHTML=layout(`<main class="page">
      <section class="hero">
        <div><small>SERVICIOS INTEGRALES</small><h1>Encontrá al profesional que necesitás.</h1>
        <p>Solicitá presupuestos, compará profesionales y contratá dentro de la plataforma.</p>
        <button class="btn btn-light" onclick="go('request')">Solicitar servicio</button></div>
        <div class="big360">360°</div>
      </section>
      <h3 class="section-title">Especialidades</h3>
      <div class="grid">
        <div class="card specialty" onclick="go('professionals')" style="cursor:pointer"><div class="icon">⚡</div><b>Electricidad</b></div>
        <div class="card specialty"><div class="icon">❄️</div><b>Refrigeración</b></div>
        <div class="card specialty"><div class="icon">🔧</div><b>Plomería</b></div>
      </div>
    ${(() => {
  const q = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
const savedRating = JSON.parse(localStorage.getItem('professionalRating') || 'null');
  if(!q || q.status !== 'Finalizado') return '';

  return `
    <div class="card" style="margin-top:20px">
      <h2>🏁 Trabajo finalizado</h2>
      <p><b>Profesional:</b> Carlos Rodríguez</p>
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
  app.innerHTML=layout(`<main class="page">
    ${back('Calificar profesional')}

    <div class="card">
      <h2>⭐ Calificar profesional</h2>
      <p><b>Profesional:</b> Carlos Rodríguez</p>
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
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Solicitar servicio')}
      <div class="field"><label>¿Qué servicio necesitás?</label><select id="service"><option>Electricidad</option><option>Refrigeración</option><option>Plomería</option><option>Pintura</option><option>Carpintería</option></select></div>
      <div class="field"><label>Describí el trabajo</label><textarea id="desc" placeholder="Contanos qué necesitás reparar o instalar..."></textarea></div>
      <div class="field"><label>Localidad</label><input id="loc" placeholder="Ej.: San Isidro, Vicente López"></div>
      <div class="field"><label>Fotos (opcional)</label><div class="upload">📷 Agregar fotos del trabajo</div></div>
      <div class="notice">🔒 Por seguridad, la dirección exacta se comparte después de avanzar con el profesional.</div>
      <button class="btn btn-primary full" onclick="saveRequest()">Buscar profesionales</button>
    </div></main>`,'inicio');
    return;
  }
  if(s==='professionals'){
    const pros=[
      ['Carlos Rodríguez','Electricista','127','4.9'],
      ['María Romero','Refrigeración','94','4.8'],
      ['Diego Fernández','Plomería','81','4.7'],
      ['Norte Servicios','Mantenimiento integral','210','5.0']
    ];
    app.innerHTML=layout(`<main class="page">${back('Profesionales')}
      <div class="field"><input placeholder="🔎 Buscar especialidad o profesional"></div>
      <div class="list">${pros.map((p,i)=>`<div class="card pro" onclick="selectPro(${i})" style="cursor:pointer">
        <div class="proleft"><div class="avatar">${p[0].split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div><b>${p[0]}</b><div class="notice" style="margin:4px 0">${p[1]} · ${p[2]} trabajos realizados</div><span class="stars">★</span> ${p[3]} · <b>✓ Verificado</b></div></div>
        <button class="btn btn-outline" onclick="selectPro(${i})">Ver</button>
      </div>`).join('')}</div>
    </main>`,'inicio');
    return;
  }
  if(s==='professional-detail'){
  const pros=[
    ['Carlos Rodriguez','Electricista','127','4.9'],
    ['Maria Romero','Refrigeración','94','4.8'],
    ['Diego Fernández','Plomería','81','4.7'],
    ['Norte Servicios','Mantenimiento integral','210','5.0']
  ];

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
  onclick="requestProfessionalQuote()">Solicitarpresupuesto</button>

  </div></main>`,'inicio');
  return;
}
  
  if(s==='payment'){
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Confirmar pago')}
      <div class="card"><div>Presupuesto aprobado</div><div class="money">${money(state.job.amount)}</div><small>Servicio + materiales según presupuesto</small></div>
      <div class="card" style="margin-top:14px"><label class="payopt">💳 Mercado Pago <input type="radio" name="pay" checked></label>
      <label class="payopt">🏦 Transferencia bancaria <input type="radio" name="pay"></label></div>
      <button class="btn btn-primary full" style="margin-top:20px" onclick="confirmPayment()">Pagar y contratar</button>
      <div class="notice">Versión demo: no se realizan cobros reales.</div>
    </div></main>`,'trabajos');
    return;
  }
  if(s==='contracted'){
    app.innerHTML=layout(`<main class="page">${back('Trabajo contratado')}
      <div class="card">
        <div class="jobhead"><div><span class="badge">✓ Contratado</span><h2>${state.job.service}</h2><p>${state.job.description}</p></div><div class="money">${money(state.job.amount ?? (JSON.parse(localStorage.getItem('professionalQuote') || 'null')?.amount ? Number(JSON.parse(localStorage.getItem('professionalQuote') || 'null').amount) : null))}</div></div>
        <hr style="border:0;border-top:1px solid var(--line)">
        <p><b>Profesional:</b> ${state.job.professional} · ✓ Verificado</p>
        <p><b>Localidad:</b> ${state.job.locality}</p>
        <p><b>Trabajo:</b> #${state.job.id}</p>
        <div class="timeline">
          <div class="step done">Solicitud</div><div class="step done">Presupuesto</div><div class="step current">Confirmado</div><div class="step">En curso</div><div class="step">Finalizado</div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" onclick="go('chat')">💬 Abrir chat</button>
          <button class="btn btn-outline" onclick="go('jobs')">🧰 Mis trabajos</button>
          <button class="btn btn-outline" onclick="go('claim')">⚠️ Hacer reclamo</button>
          ${state.job.status === 'En curso' ? <button class="btn btn-green" onclick="finishJob()">✓ Marcar como finalizado</button> : ''}
        </div>
      </div>
    </main>`,'trabajos');
    return;
  }
 if(s==='jobs'){
  const q = JSON.parse(localStorage.getItem('professionalQuote') || 'null');
  const finalizado = q && q.status === 'Finalizado';
const history = JSON.parse(localStorage.getItem('jobHistory') || '[]');
  app.innerHTML=layout(`<main class="page">${back('Mis trabajos')}

    <div class="list">
      <h3>🟢 Trabajos activos</h3>

      ${!finalizado ? `
      <div class="card pro"
         onclick="go('contracted')"
         style="cursor:pointer">
           <div>
            <b>${state.job.service}</b>
            <div class="notice" style="margin:4px 0">
              ${state.job.professional} · ${state.job.locality}
            </div>
          </div>
          <span class="badge">${state.job.status}</span>
        <button class="btn btn-primary" onclick="go('contracted')">Ver trabajo</button></div>
      ` : `
        <div class="notice">No tenés trabajos activos.</div>
      `}

      <h3 style="margin-top:24px">✅ Historial de trabajos finalizados</h3>

      ${history.length ? history.map((item, index) => `
  <div class="card pro"
       onclick="localStorage.setItem('selectedHistoryIndex','${index}'); go('finished-job-detail')"
       style="cursor:pointer">
    <div>
      <b>${item.specialty || 'Servicio'}</b>
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
  const rating = JSON.parse(localStorage.getItem('professionalRating') || 'null');

  if(!q){
    go('jobs');
    return;
  }

  app.innerHTML=layout(`<main class="page">
    ${back('Detalle del trabajo')}

    <div class="card">
      <span class="badge">Finalizado</span>

      <h2 style="margin-top:14px">
        ${q.specialty || state.job.service}
      </h2>

      <p>${q.job || state.job.description}</p>

      <hr>

      <p><b>Profesional:</b> Carlos Rodríguez ✓ Verificado</p>
      <p><b>Localidad:</b> ${q.location || state.job.locality}</p>
      <p><b>Importe:</b> $${Number(q.amount || state.job.amount).toLocaleString('es-AR')}</p>
      <p><b>Estado:</b> 🏁 Finalizado</p>

      ${rating ? `
        <div class="notice" style="margin-top:18px">
          <b>Tu calificación:</b> ${'⭐'.repeat(rating.stars)}
        ${rating.comment ? `<p>${rating.comment}</p>` : ''}
        </div>
      ` : `
        <button class="btn btn-primary full"
          type="button"
          onclick="go('rating')">
          ⭐ Calificar profesional
        </button>
      `}

      <button class="btn btn-outline full"
        type="button"
        onclick="go('claim')"
        style="margin-top:12px">
        ⚠️ Hacer reclamo
      </button>
    </div>
  </main>`,'trabajos');

  return;
}
  if(s==='chat'){
    app.innerHTML=layout(`<main class="page">${back('Mensajes')}
      <div class="card"><div class="jobhead"><div><h2>${state.job.professional}</h2><div class="notice">Trabajo #${state.job.id}</div></div><span class="badge blue">${state.job.status}</span></div>
      <div class="chatbox" id="chatbox">${state.messages.map(m=>`<div class="msg ${m.from==='me'?'me':''}">${m.text}</div>`).join('')}</div>
      <div class="chatinput"><input id="msg" placeholder="Escribí un mensaje..." onkeydown="if(event.key==='Enter')sendMsg()"><button class="btn btn-primary" onclick="sendMsg()">Enviar</button></div>
      <div class="notice">🔒 Tus datos están protegidos. Mantené la conversación dentro de la app.</div>
      </div>
    </main>`,'mensajes');
    setTimeout(()=>{const c=document.getElementById('chatbox'); if(c)c.scrollTop=c.scrollHeight},0);
    return;
  }
  if(s==='claim'){
    app.innerHTML=layout(`<main class="page"><div class="form">${back('Nuevo reclamo')}
      <div class="card claims"><p><b>Trabajo:</b> #${state.job.id} · ${state.job.service}</p>
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
    app.innerHTML=layout(`<main class="page">${back('Perfil')}
      <div class="card"><h2>Mi cuenta</h2><p>Esta pantalla seguirá siendo demostrativa hasta conectar registro y base de datos reales.</p>
      <div class="kpis"><div class="card kpi"><span>Trabajos</span><strong>2</strong></div><div class="card kpi"><span>Mensajes</span><strong>${state.messages.length}</strong></div><div class="card kpi"><span>Reclamos</span><strong>${state.claims.length}</strong></div><div class="card kpi"><span>Calificación</span><strong>${state.rating||'—'}</strong></div></div></div>
    </main>`,'perfil');
    return;
  }
}

function saveRequest(){
  state.job.service=document.getElementById('service').value;
  state.job.description=document.getElementById('desc').value || 'Trabajo solicitado desde Mantenimiento 360°';
  state.job.locality=document.getElementById('loc').value || 'San Isidro';

  localStorage.setItem('clientRequest', JSON.stringify({
    service: state.job.service,
    description: state.job.description,
    locality: state.job.locality,
    status: 'Buscando profesional'
  }));

  go('professionals');
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
function confirmPayment(){
  state.job.status='Confirmado';
  state.job.amount=Nomber(JSON.parse(localStrage.getItem('professionalQuote') ||'{}').amount || state.job.amount);
  go('contracted');
}
function sendMsg(){
  const inp=document.getElementById('msg');
  if(!inp || !inp.value.trim()) return;
  state.messages.push({from:'me',text:inp.value.trim()});
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
  professional: state.job.professional,
  finishedAt: new Date().toISOString()
});

localStorage.setItem(
  'jobHistory',
  JSON.stringify(history)
);
  go('rating');
}
function setRating(n){ state.rating=n; render(); }
function submitRating(){
  if(!state.rating){ alert('Elegí de 1 a 5 estrellas.'); return; }
  alert('Calificación guardada en esta demostración.');
  go('jobs');
}
function submitClaim(){
  const reason=document.getElementById('claimReason').value;
  const text=document.getElementById('claimText').value.trim();
  if(!text){ alert('Contanos brevemente qué pasó.'); return; }
  state.claims.push({reason,text,status:'En revisión'});
  alert('Reclamo enviado. Administración podrá revisarlo.');
  go('contracted');
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
const quote = {
 amount: Number(String(amount).replace(/\./g, '').replace(',', '.')),
  text: text,
  specialty: 'Electricidad',
  location: 'San Isidro',
  job: 'Revisión de instalación eléctrica',
  status: 'Esperando respuesta del cliente'
};

localStorage.setItem('professionalQuote', JSON.stringify(quote));
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
  localStorage.setItem('professionalQuote', JSON.stringify(quote));

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

  alert('Calificación enviada correctamente. ¡Gracias!');
  go('home');
}

rende();
