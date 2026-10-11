// Aislamiento visual: solo para el sitio de pruebas con ?demo=1.
// Nunca copia datos de la aplicación principal.
(function(){
  const qs = new URLSearchParams(window.location.search);
  if(qs.get('demo') !== '1') return;
  if(localStorage.getItem('lastJobNumber') === null){
    localStorage.setItem('lastJobNumber','171');
  }
  document.addEventListener('DOMContentLoaded',function(){
    const bar = document.createElement('div');
    bar.textContent = 'VERSIÓN DE PRUEBA · Sin cobros reales · Datos aislados';
    bar.setAttribute('role','status');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff3cd;color:#594100;text-align:center;font:600 12px/1.4 Arial,sans-serif;padding:8px 4px;box-shadow:0 1px 4px #0002';
    document.body.style.paddingTop = '32px';
    document.body.appendChild(bar);
  });
})();
