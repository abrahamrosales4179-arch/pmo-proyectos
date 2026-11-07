// =====================================================================
// Configuración – edita SOLO este archivo
// Los datos están en Supabase → Project Settings → API
// La "anon public key" puede estar en GitHub: la seguridad la dan las
// reglas (RLS) de schema.sql. NUNCA pongas aquí la "service_role key".
// =====================================================================

export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'PEGA-AQUI-TU-ANON-PUBLIC-KEY';

export const NOMBRE_APP = 'PMO Proyectos DGJ';

// Etapas del proceso. El número al inicio es el que usan las reglas de la
// base de datos; si cambias nombres, cambia también config_documentos.etapa.
export const ETAPAS = [
  '0. Devuelta a Comercial',
  '1. Solicitud',
  '3. Carpeta técnica',
  '4. Permisos',
  '5. Construcción',
  '6. Puesta en servicio',
  '7. Cierre y as-built',
  '8. Entregado a O&M',
];
