(() => {
  'use strict';
  const el = (id) => document.getElementById(id);
  const tokenKey = 'm360-lab-token';
  let choice = 'client';
  let token = sessionStorage.getItem(tokenKey) || '';
  let profile = null;
  let labCategoryId=null;
  let labProfessional=null;

  function feedback(message, failed = false) {
    const node = el('feedback');
    node.textContent = message;
    node.className = 'feedback ' + (failed ? 'error' : 'ok');
  }
  async function api(method, path, data, credential = token) {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: {
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(credential ? { Authorization: 'Bearer ' + credential } : {})
      },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const known = {
        invalid_input: 'Revisá los datos ingresados. La contraseña necesita 12 caracteres o más.',
        account_unavailable: 'Esta cuenta ya existe o no está disponible.',
        invalid_credentials: 'Correo o contraseña incorrectos.',
        authentication_required: 'Necesitás iniciar sesión.',
        invalid_or_expired_token: 'La sesión venció. Volvé a ingresar.'
      };
      throw new Error(known[body.error] || 'La solicitud no se completó (HTTP ' + response.status + ').');
    }
    return body;
  }
  function select(role) {
    choice = role;
    el('roleClient').classList.toggle('active', role === 'client');
    el('rolePro').classList.toggle('active', role === 'professional');
    el('roleClient').setAttribute('aria-pressed',String(role === 'client'));
    el('rolePro').setAttribute('aria-pressed',String(role === 'professional'));
    el('registerHeading').textContent = role === 'client' ? 'Registrar cliente de prueba' : 'Registrar profesional de prueba';
    el('regName').placeholder = role === 'client' ? 'Ejemplo: Cliente de Prueba' : 'Ejemplo: Profesional de Prueba';
    el('regEmail').placeholder = role === 'client' ? 'cliente360@test.invalid' : 'profesional360@test.invalid';
  }
  function view(tab) {
    const isReg = tab === 'register';
    el('registerForm').hidden = !isReg;
    el('loginForm').hidden = isReg;
    el('showRegister').classList.toggle('active',isReg);
    el('showLogin').classList.toggle('active',!isReg);
    feedback('');
  }
  function render() {
    el('guest').hidden = !!profile;
    el('signedIn').hidden = !profile;
    if (!profile) return;
    el('profileName').textContent = profile.name || '—';
    el('profileRole').textContent = profile.role === 'professional' ? 'Profesional' : profile.role === 'client' ? 'Cliente' : 'Administrador';
    el('profileId').textContent = String(profile.id || '—');
    el('roleNotice').textContent = profile.role === 'admin'
      ? 'Administración de laboratorio: sólo aprobación ficticia, sin documentos personales.'
      : profile.role === 'professional'
      ? 'Las cuentas profesionales nuevas requieren aprobación de Administración antes de recibir solicitudes. No hay datos reales.'
      : 'Tu cuenta ficticia ya puede iniciar sesión. Las solicitudes serán exclusivamente de prueba.';
    el('jobsPanel').textContent = '';
    el('adminSection').hidden = profile.role !== 'admin';
    if(profile.role === 'admin') void loadProfessionals();
  }
  async function activate(data) {
    token = data.token;
    profile = data.user;
    sessionStorage.setItem(tokenKey, token);
    el('regPassword').value = '';
    el('loginPassword').value = '';
    render();
    feedback('Cuenta de prueba activa.');
  }
  async function handleRegistration(event) {
    event.preventDefault();
    const name = el('regName').value.trim();
    const email = el('regEmail').value.trim().toLowerCase();
    const password = el('regPassword').value;
    if (!email.endsWith('@test.invalid')) {
      feedback('Para esta prueba usá un correo inventado terminado en @test.invalid.',true);
      return;
    }
    const button=el('registerButton');
    button.disabled = true;
    try {
      const data=await api('POST','/api/auth/register',{ name,email,password,role:choice },'');
      await activate(data);
    } catch(err) {
      feedback(err.message,true);
    } finally {
      button.disabled=false;
      el('regPassword').value = '';
    }
  }
  async function handleLogin(event) {
    event.preventDefault();
    const button=el('loginButton');
    button.disabled=true;
    try {
      const data=await api('POST','/api/auth/login',{
        email:el('loginEmail').value.trim().toLowerCase(),
        password:el('loginPassword').value
      },'');
      await activate(data);
    }catch(err){
      feedback(err.message,true);
    }finally{
      button.disabled=false;
      el('loginPassword').value='';
    }
  }
  async function restore() {
    if (!token) return;
    try {
      const data = await api('GET','/api/auth/me');
      profile=data.user;
      render();
    } catch {
      token='';
      sessionStorage.removeItem(tokenKey);
      render();
    }
  }
  async function refreshJobs() {
    try {
      const jobs=await api('GET','/api/jobs');
      el('jobsPanel').textContent=jobs.length
        ? 'Solicitudes de prueba disponibles: ' + jobs.length + '\n' +
          jobs.map(j=>'• '+j.public_code+' · '+j.locality+' · '+j.status).join('\n')
        : 'No hay solicitudes visibles para esta cuenta. Si es profesional, la aprobación de Administración es obligatoria.';
    }catch(err){
      el('jobsPanel').textContent=err.message;
    }
  }
  async function loadProfessionals() {
    const target = el('adminTarget');
    target.textContent = 'Buscando profesional de prueba ID 4...';
    try {
      const [pros,categories]=await Promise.all([
        api('GET','/api/admin/professionals'),
        api('GET','/api/admin/specialties')
      ]);
      labCategoryId = Number(categories.find(c=>c.name==='Refrigeración')?.id)||null;
      labProfessional = pros.find(p=>String(p.id)==='4') || null;
      if(!labProfessional) {
        target.textContent='No encontramos la cuenta profesional ID 4. No se realizó ninguna aprobación.';
      } else {
        target.textContent='Profesional: '+labProfessional.name+' | ID: '+labProfessional.id+
          '\nEstado: '+labProfessional.verification_status+
          '\nEspecialidad: '+(labCategoryId ? 'Refrigeración preparada' : 'Falta preparar Refrigeración');
      }
      el('approveSelected').disabled=!labProfessional||
        labProfessional.verification_status!=='pending'||!labCategoryId;
    }catch(error) { target.textContent=error.message;el('approveSelected').disabled=true; }
  }
  async function prepareRefrigeration() {
    const button=el('prepareRefrigeration');
    button.disabled=true;
    try {
      const result=await api('POST','/api/admin/specialties',{
        name:'Refrigeración',services:['Reparación','Mantenimiento preventivo']
      });
      labCategoryId=Number(result.id);
      feedback('Rubro ficticio Refrigeración preparado.');
      await loadProfessionals();
    }catch(error){feedback(error.message,true);}
    finally{button.disabled=false;}
  }
  async function approveSelected() {
    if(!labProfessional||String(labProfessional.id)!=='4'||!labCategoryId) return;
    if(!confirm('¿Aprobar para PRUEBAS a '+labProfessional.name+' (ID 4) en Refrigeración?')) return;
    const button=el('approveSelected');
    button.disabled=true;
    try {
      const result=await api('POST','/api/admin/professionals/4/approve',{
        specialtyId:labCategoryId
      });
      feedback('Profesional ID 4 aprobado solamente para el laboratorio: '+result.specialty+'.');
      await loadProfessionals();
    }catch(error){feedback(error.message,true);button.disabled=false;}
  }

  el('roleClient').addEventListener('click',()=>select('client'));
  el('rolePro').addEventListener('click',()=>select('professional'));
  el('showRegister').addEventListener('click',()=>view('register'));
  el('showLogin').addEventListener('click',()=>view('login'));
  el('registerForm').addEventListener('submit',handleRegistration);
  el('loginForm').addEventListener('submit',handleLogin);
  el('refreshJobs').addEventListener('click',refreshJobs);
  el('showPending').addEventListener('click',loadProfessionals);
  el('prepareRefrigeration').addEventListener('click',prepareRefrigeration);
  el('approveSelected').addEventListener('click',approveSelected);
  el('logout').addEventListener('click',()=>{
    token='';profile=null;labProfessional=null;labCategoryId=null;
    el('adminSection').hidden=true;
    sessionStorage.removeItem(tokenKey);
    render();
    feedback('Sesión de prueba cerrada.');
  });
  select('client');
  view('register');
  render();
  void restore();
})();