// Solo se ejecuta al abrir este entorno con ?demo=1.
// No modificar ni importar datos reales: aquí se utilizan registros ficticios.
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== '1') return;

  const original = {
    id: '360-00171',
    professional: 'María Romero',
    specialty: 'Refrigeración',
    service: 'Refrigeración',
    job: 'Mantenimiento de equipo de refrigeración (DEMO)',
    location: 'San Isidro',
    amount: 250000,
    warrantyDays: 30,
    status: 'Finalizado',
    finishedAt: '2026-10-08T18:00:00.000Z',
    rating: { id: '360-00171', stars: 4, ratingType: 'trabajo', comment: 'Trabajo original (DEMO)' }
  };
  const warrantyA = {
    ...original,
    id: '360-00171-A',
    job: 'Corrección en garantía del trabajo 360-00171 (DEMO)',
    text: 'Primera intervención sin cargo (DEMO)',
    warrantyJob: true,
    originJobId: '360-00171',
    warrantyDays: 0,
    amount: 0,
    finishedAt: '2026-10-09T18:00:00.000Z',
    rating: { id: '360-00171-A', stars: 5, ratingType: 'garantia', comment: 'Primera garantía (DEMO)' }
  };
  const warrantyB = {
    ...warrantyA,
    id: '360-00171-B',
    job: 'Segunda corrección en garantía del trabajo 360-00171 (DEMO)',
    text: 'Segunda intervención sin cargo (DEMO)',
    finishedAt: '2026-10-10T18:00:00.000Z',
    rating: null
  };
  const demoClaims = [
    {
      id: '360-00171',
      professional: 'María Romero',
      reason: 'Necesita una corrección (DEMO)',
      text: 'Primer reclamo de prueba',
      status: 'Resuelto',
      originJobId: '360-00171',
      warrantyJobId: '360-00171-A',
      measure: 'Corrección en garantía',
      resolution: 'Se completó la primera garantía'
    },
    {
      id: '360-00171-A',
      professional: 'María Romero',
      reason: 'Nueva observación (DEMO)',
      text: 'Segundo reclamo de prueba',
      status: 'Resuelto',
      originJobId: '360-00171',
      warrantyIssueJobId: '360-00171-A',
      warrantyJobId: '360-00171-B',
      measure: 'Corrección en garantía',
      resolution: 'Se completó la segunda garantía'
    }
  ];

  // El ejemplo se crea solamente en un origen sin historial existente.
  if (!localStorage.getItem('jobHistory') && !localStorage.getItem('claims')) {
    localStorage.setItem('jobHistory', JSON.stringify([original, warrantyA, warrantyB]));
    localStorage.setItem('claims', JSON.stringify(demoClaims));
    localStorage.setItem('professionalQuote', JSON.stringify(warrantyB));
    localStorage.setItem('m360_demo_preview_initialized', '1');
  }

  document.addEventListener('DOMContentLoaded', function () {
    const banner = document.createElement('div');
    banner.textContent = 'ENTORNO DE PRUEBA · Datos ficticios (no son trabajos reales)';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff3cd;color:#593f00;text-align:center;font:600 12px/1.3 Arial,sans-serif;padding:8px 4px;box-shadow:0 1px 4px #0002';
    document.body.style.paddingTop = '32px';
    document.body.appendChild(banner);
  });
})();
