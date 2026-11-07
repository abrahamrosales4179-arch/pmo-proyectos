# PMO Proyectos DGJ

Plataforma web para dar de alta solicitudes de proyectos, subir su expediente y darles seguimiento por etapas y por rol. Es la versión web (GitHub + Supabase) del piloto en Power Apps.

- **Página web:** HTML + JavaScript sin compilación; se publica gratis en **GitHub Pages**.
- **Datos, usuarios y archivos:** **Supabase** (plan gratuito: base de datos Postgres, login y almacenamiento).

## Qué hace

| Función | Detalle |
|---|---|
| Nueva solicitud | Municipio, segmento (Residencial/Comercial/Industrial), material (solo Industrial), documentos obligatorios según el tipo; el botón Enviar se activa cuando están completos. |
| Folio automático | `[clave municipio][R/C/I][P/A][año][consecutivo]`, ej. `ZRP26001`, `TIA26133`. Lo genera la base de datos, sin duplicados aunque dos personas envíen al mismo tiempo. |
| Bandejas por rol | Administrador/Consulta: todo · Comercial: sus solicitudes · Líder: 1. Solicitud · Proyectista: 3. Carpeta técnica asignada a él · Permisos: 4 · Construcción: 5, 6 y 7. Cualquiera puede activar «Ver todos». |
| Flujo | Líder asigna proyectista (1 → 3) o devuelve con motivo (→ 0). Comercial corrige y reenvía (0 → 1). Proyectista → Permisos → Construcción → Puesta en servicio → Cierre → Entregado a O&M. Antes de avanzar se revisan los documentos obligatorios de la etapa y que las licencias estén aprobadas. |
| Reglas en el servidor | Cada rol solo puede hacer los movimientos que le tocan, aunque alguien intente saltarse la página (lo valida la base de datos). |
| Expediente | Archivos por documento y etapa, en un bucket privado; enlaces de descarga temporales. |
| Licencias | Tipo, dependencia, estatus, fechas de ingreso y vencimiento. |
| Seguimiento | Fecha compromiso (se marca en rojo si está vencida), bloqueo actual y siguiente acción. |
| Historial | Se registra solo: creación, cambios de etapa, asignaciones y comentarios, con usuario y fecha. |
| Administración | Roles y usuarios activos, documentos requeridos por etapa/segmento/material, municipios y claves. |

## Instalación (unos 20 minutos)

### 1. Supabase
1. Crea una cuenta en <https://supabase.com> → **New project** (región: la más cercana, p. ej. `us-east`). Guarda la contraseña de la base.
2. Ve a **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**. Debe terminar en «Success».
3. **Authentication → Sign In / Providers → Email:** desactiva **Allow new users to sign up** (así solo entra quien tú des de alta).
4. **Authentication → Users → Add user → Create new user:** tu correo y una contraseña, con **Auto Confirm User** marcado. **El primer usuario que crees queda como Administrador.**
5. **Project Settings → API:** copia la **Project URL** y la **anon public key**.

### 2. Configurar la página
Abre `config.js` y pega los dos valores:
```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```
> La *anon key* es pública por diseño y puede ir en GitHub: la seguridad la dan las reglas de `schema.sql`. **Nunca** pongas la *service_role key*.

### 3. GitHub
1. En <https://github.com/new> crea un repositorio (p. ej. `pmo-proyectos`). Puede ser privado si tienes GitHub Pro; en cuenta gratuita, Pages requiere repositorio público (los datos siguen protegidos en Supabase).
2. **Add file → Upload files:** arrastra todos los archivos y carpetas de este proyecto → **Commit changes**.
3. **Settings → Pages → Build and deployment:** Source = *Deploy from a branch*, Branch = `main` y carpeta `/ (root)` → **Save**.
4. En 1–2 minutos tu app queda en `https://TU-USUARIO.github.io/pmo-proyectos/`.
5. De regreso en Supabase, **Authentication → URL Configuration → Site URL:** pega esa dirección.

### 4. Dar de alta al equipo
1. Supabase → **Authentication → Users → Add user** por cada persona (correo + contraseña temporal, Auto Confirm).
2. En la app → **Administración**: ponles nombre y rol (Comercial, Líder, Proyectista, Permisos, Construcción o Consulta).
3. Cada quien puede cambiar su contraseña en **Mi cuenta** (clic en su nombre, arriba a la derecha).

### 5. Ajustar catálogos
En **Administración → Documentos requeridos** reemplaza los documentos de ejemplo por tu lista real (los 23 de Config_Documentos), indicando etapa, segmento, material y si es obligatorio.

## Probar en tu computadora (opcional)
```bash
cd pmo-proyectos
python3 -m http.server 8000
# abre http://localhost:8000
```

## Personalizar
- **Nombre de etapas:** `config.js` → `ETAPAS`. Conserva el número inicial (las reglas lo usan) y actualiza la etapa de los documentos en Administración.
- **Solo correos de la empresa:** en `schema.sql`, función `crear_perfil`, quita los `--` de las líneas del dominio y vuelve a ejecutar el script.
- **Colores:** variables al inicio de `styles.css`.

## Archivos
```
index.html            Página
app.js                Lógica (pantallas, flujo, subida de archivos)
config.js             Conexión a Supabase y etapas
styles.css            Estilos
supabase/schema.sql   Tablas, folio, reglas por rol, historial y almacenamiento
```

## Siguientes pasos sugeridos
- Avisos por correo/Teams al cambiar de etapa (Supabase Edge Function con Resend, o un webhook de Supabase hacia Power Automate).
- Tablero ejecutivo con gráficas por etapa y municipio.
- Importar proyectos existentes desde Excel (Supabase → Table Editor → Import data from CSV).
