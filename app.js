
const state = {
  screen: 'splash',
  selectedProfessional: {name:'Carlos Rodríguez', trade:'Electricista', rating:'4.9', jobs:127},
  job: {
    id:'360-00125',
    service:'Electricidad',
    description:'Revisión de instalación eléctrica',
    locality:'San Isidro',
    amount:85000,
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
const money = n => '$ ' + n.toLocaleString('es-AR');

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
    app.innerHTML=`<div class="splash"><div><div class="big">360°</div><h1>MANTENIMIENTO 360°</h1><p>Servicios integrales, profesionales verificados.</p><button class="btn btn-light" onclick="go('home')">Comenzar</button></div></div>`;
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
        <div class="card specialty"><div class="icon">⚡</div><b>Electricidad</b></div>
        <div class="card specialty"><div class="icon">❄️</div><b>Refrigeración</b></div>
        <div class="card specialty"><div class="icon">🔧</div><b>Plomería</b></div>
      </div>
    </main>`,'inicio');
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
      <div class="list">${pros.map((p,i)=>`<div class="card pro">
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
      onclick="go('payment')">Elegir profesional</button>

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
        <div class="jobhead"><div><span class="badge">✓ Contratado</span><h2>${state.job.service}</h2><p>${state.job.description}</p></div><div class="money">${money(state.job.amount)}</div></div>
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
          <button class="btn btn-green" onclick="finishJob()">✓ Marcar como finalizado</button>
        </div>
      </div>
    </main>`,'trabajos');
    return;
  }
  if(s==='jobs'){
    app.innerHTML=layout(`<main class="page">${back('Mis trabajos')}
      <div class="list">
        <div class="card pro"><div><b>${state.job.service}</b><div class="notice" style="margin:4px 0">${state.job.professional} · ${state.job.locality}</div></div><span class="badge ${state.job.status==='Finalizado'?'':'blue'}">${state.job.status}</span></div>
        <div class="card pro"><div><b>Mantenimiento preventivo</b><div class="notice" style="margin:4px 0">María Gómez · Vicente López</div></div><span class="badge">Finalizado</span></div>
      </div>
      <button class="btn btn-primary" style="margin-top:18px" onclick="go('contracted')">Ver trabajo seleccionado</button>
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
  go('professionals');
}
function selectPro(i){
  const names=['Carlos Rodríguez','María Romero','Diego Fernández','Norte Servicios'];
  state.selectedProfessionalIndex=i;
  state.job.professional=names[i];
  go('professional-detail')
}
function confirmPayment(){
  state.job.status='Confirmado';
  go('contracted');
}
function sendMsg(){
  const inp=document.getElementById('msg');
  if(!inp || !inp.value.trim()) return;
  state.messages.push({from:'me',text:inp.value.trim()});
  render();
}
function finishJob(){
  state.job.status='Finalizado';
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
render();
