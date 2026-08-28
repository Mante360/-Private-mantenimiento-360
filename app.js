const professionals=[
 {name:"Carlos Rodríguez",role:"Electricista",rating:"4.9",jobs:127,verified:true,initials:"CR"},
 {name:"María Romero",role:"Refrigeración",rating:"4.8",jobs:94,verified:true,initials:"MR"},
 {name:"Diego Fernández",role:"Plomería",rating:"4.7",jobs:81,verified:true,initials:"DF"},
 {name:"Norte Servicios",role:"Mantenimiento integral",rating:"5.0",jobs:210,verified:true,initials:"NS"}
];

function go(id){
 document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
 const el=document.getElementById(id);
 if(el) el.classList.add("active");
 if(id==="professionals") renderProfessionals();
 window.scrollTo(0,0);
}
function selectService(service){
 document.getElementById("serviceType").value=service;
 go("request");
}
function createRequest(){
 const desc=document.getElementById("description").value.trim();
 const loc=document.getElementById("location").value.trim();
 if(!desc||!loc){showToast("Completá el servicio y la localidad.");return;}
 showToast("Solicitud creada. Buscando profesionales...");
 setTimeout(()=>go("professionals"),700);
}
function renderProfessionals(){
 const list=document.getElementById("professionalList");
 list.innerHTML=professionals.map((p,i)=>`
 <div class="pro">
   <div class="avatar">${p.initials}</div>
   <div class="pro-main"><b>${p.name}</b><p>${p.role} · ${p.jobs} trabajos realizados</p><div class="stars">⭐ ${p.rating} · <span class="verified">✓ Verificado</span></div></div>
   <button class="secondary" onclick="chooseProfessional(${i})">Ver</button>
 </div>`).join("");
}
function chooseProfessional(i){
 const p=professionals[i];
 showToast(p.name+" seleccionado");
 setTimeout(()=>go("payment"),500);
}
function openChat(name){showToast("Chat con "+name+" abierto (demo).")}
function showToast(msg){
 const t=document.getElementById("toast");
 t.textContent=msg;t.classList.add("show");
 clearTimeout(window.toastTimer);
 window.toastTimer=setTimeout(()=>t.classList.remove("show"),2200);
}
document.addEventListener("DOMContentLoaded",()=>go("splash"));
