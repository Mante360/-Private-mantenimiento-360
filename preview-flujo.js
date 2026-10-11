// Aislamiento visual: solo para el sitio de pruebas con ?demo=1.
// Nunca copia datos de la aplicación principal.
(function(){
  const qs = new URLSearchParams(window.location.search);
  if(qs.get('demo') !== '1') return;
  if(localStorage.getItem('lastJobNumber') === null){
    localStorage.setItem('lastJobNumber','171');
  }
  // Ejemplo opcional: solo si este sitio de prueba todavía no tiene solicitudes.
  // No altera datos ya existentes ni se ejecuta en la versión principal.
  if(qs.get('comparar') === '1' &&
     !localStorage.getItem('clientRequest') &&
     !localStorage.getItem('professionalQuote') &&
     !localStorage.getItem('professionalQuotes') &&
     !localStorage.getItem('jobHistory')){
    const id = '360-00172';
    const request = {
      id,service:'Refrigeración',task:'Reparación',description:'Aire acondicionado que no enfría',
      locality:'San Isidro',professional:'',status:'Presupuesto enviado'
    };
    const offers = [
      {id,professional:'María Romero',amount:85000,warrantyDays:30,
       specialty:'Refrigeración',task:'Reparación',location:'San Isidro',
       job:request.description,text:'Diagnóstico y reparación del equipo',status:'Esperando respuesta del cliente'},
      {id,professional:'Norte Servicios',amount:69000,warrantyDays:60,
       specialty:'Refrigeración',task:'Reparación',location:'San Isidro',
       job:request.description,text:'Revisión del equipo y reparación general',status:'Esperando respuesta del cliente'}
    ];
    localStorage.setItem('clientRequest',JSON.stringify(request));
    localStorage.setItem('professionalQuotes',JSON.stringify(offers));
    localStorage.setItem('jobStatus','Solicitud');
    localStorage.setItem('lastJobNumber','172');
  }
  document.addEventListener('DOMContentLoaded',function(){
    const bar = document.createElement('div');
    bar.textContent = qs.get('comparar') === '1' ? 'COMPARADOR DE PRUEBA · Presupuestos ficticios · Sin cobros reales' : 'VERSIÓN DE PRUEBA · Sin cobros reales · Datos aislados';
    bar.setAttribute('role','status');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff3cd;color:#594100;text-align:center;font:600 12px/1.4 Arial,sans-serif;padding:8px 4px;box-shadow:0 1px 4px #0002';
    document.body.style.paddingTop = '32px';
    document.body.appendChild(bar);
  });
})();
