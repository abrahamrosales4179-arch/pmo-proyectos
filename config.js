// =====================================================================
// Configuración – edita SOLO este archivo
// Los datos están en Supabase → Project Settings → API
// La "anon public key" puede estar en GitHub: la seguridad la dan las
// reglas (RLS) de schema.sql. NUNCA pongas aquí la "service_role key".
// =====================================================================

export const SUPABASE_URL = 'https://qzygzbgnztqdfhkmsgha.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_55HJQy_LSjUuCF-byyLiAw_qjGPgP__';

export const NOMBRE_APP = 'PMO Proyectos DGJ';

// Etapas del proceso. El número al inicio es el que usan las reglas de la
// base de datos (supabase/005_etapas.sql); si cambias nombres, cambia también
// config_documentos.etapa, config_actividades.etapa y config_tiempos.etapa.
export const ETAPAS = [
  '0. Devuelta a Comercial',
  '1. Solicitud',
  '2. Anteproyecto y factibilidad',
  '3. Aprobación comercial (KAM)',
  '4. Obtención del PEP',
  '5. Dictamen de diseño',
  '6. Expediente de permisos',
  '7. Revisión DRO',
  '8. Licencias',
  '9. Socialización y liberación de zona',
  '10. Carpeta técnica',
  '11. Construcción',
  '12. Cierre y as-built',
  '13. Puesta en servicio',
  '14. Entregado a O&M',
  '99. Cancelado',
];
