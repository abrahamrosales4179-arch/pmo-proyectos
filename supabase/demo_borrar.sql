-- =====================================================================
-- PMO Proyectos DGJ – BORRAR DATOS DE PRUEBA
-- Quita los proyectos "[DEMO]" (con su historial, licencias, avances y
-- actividades) y los usuarios de prueba que creó demo_datos.sql.
-- Los usuarios que ya existían antes (comercial@, proyectista@,
-- supervisor@ y gestor@ ejemplo.com) se conservan.
-- =====================================================================
delete from public.proyectos where descripcion like '[DEMO]%';

delete from auth.users where email in (
  'laura.mendez@ejemplo.com', 'jorge.ibarra@ejemplo.com', 'paola.ruiz@ejemplo.com', 'mariana.solis@ejemplo.com',
  'ricardo.navarro@ejemplo.com', 'fernanda.castro@ejemplo.com', 'hector.salinas@ejemplo.com', 'gabriela.reyes@ejemplo.com',
  'alberto.franco@ejemplo.com', 'sofia.vargas@ejemplo.com', 'carla.estrada@ejemplo.com', 'rocio.delgado@ejemplo.com',
  'tomas.aguilar@ejemplo.com');
