# INNOVA-C2

Aplicación web para preparar y gestionar el Plan de Gestión de la Innovación
de Formación Profesional del centro. La documentación funcional y el catálogo
oficial del curso 2026–2027 se conservan en `docs/reference/paquete-original/`.

## Estado de las fases

- **Fase 0 — base y seguridad: implementada.** PostgreSQL persistente,
  autenticación real, control de permisos por rol, protección CSRF, auditoría,
  configuración inicial, importación versionada del catálogo y despliegue
  autónomo con Docker Compose.
- **Fase 1 — PIC 1–10: implementada y probada por API.** Editor del PIC,
  diagnóstico DAFO, inventario y selección de proyectos, ATECA, las seis
  acciones/indicadores oficiales, ODS, CICLOPE, calendario, difusión,
  validación, control de concurrencia, snapshots inmutables, exportación
  campo a campo para transcripción manual a Laycos y documentos DOCX/PDF.
  El justificante de presentación se conserva con hash SHA-256.
- **Fase 2 — actuaciones y evidencias: integrada y probada por API.** Alta,
  edición, deduplicación, confirmación, validación y retirada de actuaciones;
  versiones documentales privadas, permisos por familia y concesiones expresas;
  solicitudes de datos esenciales, respuestas y validación C2; indicadores con
  trazabilidad de evidencias. Asignación de familia a cuentas nuevas y existentes.
  El antivirus debe estar disponible para descargar o aprobar archivos.
- **Fases posteriores: pendientes.** Circuitos completos de CICLOPE,
  comunicaciones reales por Resend, memoria,
  ATECA/FABLab y asistente IA se habilitarán según la especificación, con sus
  pruebas. No se sustituyen por envíos, respuestas o integraciones simuladas.

El PIC de 2024–2025 facilitado como referencia se ha resumido de forma
anonimizada en `docs/reference/pic-2024-25-aportes-anonimizados.md`. Sus
ejemplos son orientativos e históricos: no reemplazan el catálogo ni las reglas
oficiales de 2026–2027 y no se precargan en los planes de los centros.

## Arquitectura

- `artifacts/innova-c2`: interfaz React, Vite y TypeScript, con diseño adaptable
  inspirado en el portal de coordinación de referencia.
- `artifacts/api-server`: API REST Express, autenticación de sesión y reglas de
  negocio.
- `lib/db`: PostgreSQL y esquema/migraciones Drizzle.
- `lib/api-spec`: contrato OpenAPI; las validaciones Zod y el cliente React se
  generan desde ese contrato.
- `config/pic_2026_2027_catalogo.json`: catálogo PIC fuente de datos para las
  seis metas, 24 acciones, 31 indicadores y opciones dependientes.
- `scripts/` y `docker-compose.yml`: instalación, migraciones, copias cifradas,
  restauración y pruebas de fase.

Los documentos de presentación se generan en el servidor. Laycos no recibe
envíos automáticos: la aplicación prepara los campos ordenados y registra la
presentación manual con su justificante. Los archivos de evidencia se guardan
en el volumen persistente indicado por `DATA_DIR`.

Guía de uso, alcance y limitaciones de captura documental:
[`docs/fase2-actuaciones-evidencias.md`](docs/fase2-actuaciones-evidencias.md).
La consulta de cursos anteriores por IA corresponde a la fase 6: se utilizarán
como antecedentes con fuentes y permisos, nunca para arrastrar automáticamente
logros, evidencias o valores al curso actual. El asistente aún no está habilitado.

## Instalación autónoma en Ubuntu / Proxmox

Requisitos: Ubuntu 22.04 o posterior, arquitectura compatible con Docker
Engine y permisos de `root` o `sudo`. El instalador instala Docker Engine y el
plugin Compose si faltan, genera secretos aleatorios en `.env` sin imprimirlos
y arranca PostgreSQL y la aplicación:

```bash
git clone https://github.com/atreyu1968/InnovaC2.git
cd InnovaC2
sudo ./scripts/install.sh
```

Abre `http://<servidor>:8080` (o el puerto definido por `APP_PORT`) y completa
la configuración inicial para crear el primer administrador técnico, centro y
curso. El servicio de PostgreSQL no publica su puerto fuera de la red interna de
Compose. También se incluye ClamAV en la red privada: la aplicación espera a
que esté listo. En la primera instalación puede tardar varios minutos en
descargar sus firmas; necesita salida a Internet y memoria suficiente.

El administrador técnico acumula los permisos de todos los roles del centro,
incluidos PIC, actuaciones, evidencias, solicitudes e indicadores. No necesita
cambiar de rol: las intervenciones se registran con su identidad real. Esta
decisión expresa del usuario sustituye la separación inicial de la especificación;
no elimina CSRF, los límites del centro, el control de revisiones, la auditoría ni
las restricciones de cuarentena.

Antes de exponer el sistema a Internet, configura HTTPS en un proxy inverso
confiable y cambia `COOKIE_SECURE=true`. Activa `TRUST_PROXY=1` únicamente si
el proxy elimina y vuelve a establecer `X-Forwarded-*`. No publiques `.env`,
las claves de copia, los datos del volumen `postgres_data` ni los documentos
del volumen `documents_data`.

Operaciones:

```bash
docker compose ps
docker compose logs -f api
./scripts/migrate.sh
./scripts/backup.sh
```

`backup.sh` genera copias cifradas de la base de datos y de los documentos en
`backups/`; conserva `BACKUP_ENCRYPTION_KEY` fuera del servidor y por separado
de esas copias. `scripts/restore.sh` reemplaza los datos existentes: verifica
las sumas y conserva una copia previa, pero ejecútalo solo durante una
restauración planificada.

## PIC · apartado 2: familias y totales del centro

El apartado 2 permite añadir, editar y quitar familias del catálogo oficial,
indicando los niveles impartidos y el número de grupos de cada una. Se conserva
por separado la familia de coordinación requerida por el formulario oficial.
Los grupos del centro son la suma del desglose y los niveles son su unión sin
repeticiones; no son campos editables ni se calculan contando usuarios o actividades.
El servidor recalcula los totales y rechaza familias desconocidas o duplicadas.
El desglose se guarda con «Guardar PIC» y aparece también en Word, PDF y la ficha
de campos para Laycos.

Los PIC antiguos conservan sus cifras originales. La aplicación no distribuye
automáticamente ese total entre familias: muestra un aviso para completar el
desglose o asignar expresamente el registro anterior a la familia de coordinación.
Las versiones inmutables ya creadas no se reescriben. Para validar una nueva versión
se exige al menos una familia con niveles y grupos completos.

## Desarrollo y pruebas

La recuperación de contraseña y su aviso se comprueban con:

```bash
pnpm run test:password-reset
```

Requiere las herramientas de PostgreSQL 16 o posterior (`initdb`, `pg_ctl`,
`createdb`) en `PATH`, Node.js y pnpm; no se debe ejecutar como root.
El comando crea un clúster PostgreSQL desechable con un socket privado, sin
escuchar en la red, aplica las migraciones y construye la API. Genera su propio
secreto de sesión y elimina el clúster al terminar, también si falla una prueba.
Ignora los valores externos de `DATABASE_URL` y `TEST_DATABASE_URL`: nunca
recurre a la base de la aplicación. No necesita Docker ni servicios de correo
reales. Comprueba tanto la entrega del aviso como el fallo simulado del envío,
sin deshacer el cambio de contraseña.

El proyecto usa pnpm workspaces. Para las pruebas, prepara una base PostgreSQL
desechable, separada de `DATABASE_URL`, y exporta `TEST_DATABASE_URL` con su
cadena de conexión. Las pruebas rechazan usar la misma cadena que la aplicación:

```bash
pnpm install --frozen-lockfile
export TEST_DATABASE_URL='postgresql://innova:contraseña-local@127.0.0.1:5432/innova_c2_test'
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @workspace/db run push
pnpm -w run typecheck
pnpm run test:phase0
pnpm run test:phase1
pnpm run test:phase2
BASE_PATH=/ PORT=3000 pnpm -w run build
```

Las pruebas de fase 0 y 1 inicializan cuentas, centro y planes temporales en la
base indicada por `TEST_DATABASE_URL`, y los eliminan al terminar. El servidor
de prueba usa además un directorio temporal para evidencias. No las ejecutes
contra producción ni contra la base activa del centro. `test:phase1` verifica
permisos, edición, validación oficial, concurrencia, snapshots, exportaciones
DOCX/PDF, salida Laycos y almacenamiento/descarga del justificante.

`test:phase2` prepara el esquema en la base desechable y comprueba asignaciones
de familia, deduplicación, revisiones concurrentes, respuestas de información,
privacidad, concesiones expresas, versiones y bloqueo por cuarentena. Utiliza
un antivirus deshabilitado deliberadamente para verificar que el sistema falla
de forma segura; no certifica la detección real de malware ni el circuito de
aprobación con ClamAV. Esas comprobaciones deben realizarse en el entorno de
despliegue con el servicio real, antes del uso con documentos del centro.

Variables de ejemplo: `.env.example`. La API sirve el frontend compilado y
responde en `/api/v1/health`.


## Cierre y apertura de cursos

Administración técnica y C2 disponen de **Cursos académicos** (`/cursos`).
El cierre exige validación reciente, escribir el nombre exacto del curso y
justificarlo. Bloquean el cierre las actuaciones sin validar/descartar,
las solicitudes de información pendientes y los documentos sin revisar.
Un PIC inexistente o en borrador se muestra como advertencia: cerrar el curso
no equivale a aprobar el PIC ni a acreditar su entrega.

El cierre guarda una instantánea completa con huella SHA-256, catálogo
referenciado, PIC, fuentes de actuaciones, indicadores, metadatos/versiones
documentales y contexto de asignaciones/permisos. El curso y sus registros
quedan protegidos contra cambios y borrados mediante restricciones y triggers
PostgreSQL, no solo mediante botones deshabilitados. Los archivos físicos no
se copian ni se sobrescriben; el histórico conserva sus identificadores y
checksums. No deben eliminarse esos archivos desde operaciones de mantenimiento.

Solo después del cierre se abre el siguiente curso consecutivo. Se seleccionan
expresamente las cuentas activas, sus familias y sus roles vigentes, incluyendo
al menos un responsable C2. Las asignaciones anuales limitan los permisos
globales de la cuenta; omitir una persona no le traslada acceso al curso nuevo.
La administración técnica conserva su supervisión operativa global del centro.
La creación administrativa de una cuenta durante un curso revisado también la
asigna a ese curso; cambiar su familia afecta al curso abierto, nunca al cerrado.
El nuevo curso comienza sin PIC, actuaciones, logros, valores de indicadores
ni documentos heredados.

La consulta consolidada del expediente es exclusiva de administración técnica y C2 autorizada
del centro. La API `GET /api/v1/school-years/{id}/history` devuelve curso,
huella y fuentes con tipo/identificador/datos, sin rutas de almacenamiento ni
credenciales. Cada lectura se audita. Es la base para una futura recuperación
autorizada del asistente, que deberá citar curso y fuente, sin presentar el
antecedente como resultado actual. No se ha activado ningún proveedor de IA.
Salvo la supervisión global de administración técnica, la consulta exige que
la cuenta también tuviera acceso C2 en el curso archivado. Una promoción posterior
no concede ese acceso ni amplía el alcance de los documentos o actuaciones antiguos.
Los accesos individuales a actuaciones/documentos conservan su autorización
propia y usan la familia registrada al cierre; una reasignación posterior no
abre documentos históricos de la familia nueva.


### Prueba aislada del ciclo

```bash
pnpm run test:school-cycle
```

Requiere los ejecutables PostgreSQL `initdb`, `pg_ctl` y `postgres`, disponibles
en el entorno de desarrollo. Crea un clúster local temporal, aplica todas las
migraciones y genera su propia clave de sesión; no utiliza `DATABASE_URL` ni
`TEST_DATABASE_URL` del centro. Comprueba dos cursos, permisos, CSRF, fuentes,
validaciones pendientes, revisiones antiguas, cierres/aperturas concurrentes,
inmutabilidad y ausencia de traslados. Al terminar o recibir una señal normal
detiene los procesos y elimina su directorio.

### Prueba aislada de copia y restauración de expedientes

```bash
pnpm run test:school-cycle-backup
```

Requiere además `pg_dump`, `pg_restore`, `createdb`, Bash, OpenSSL, `tar` y
`sha256sum`. Reutiliza las pruebas del ciclo y archiva **dos cursos con archivos
físicos**, dejando un tercero activo. Ejecuta copias sin modificar de
`scripts/backup.sh` y `scripts/restore.sh` desde una carpeta temporal, con una
clave generada solo para la prueba. Un adaptador estricto de las órdenes Docker
ejecuta PostgreSQL y `tar` locales: no usa Docker, `.env`, volúmenes, claves ni
bases del centro. La base de destino pertenece al mismo clúster desechable,
distinta de la base origen.

Comprueba todos los registros antes/después, incluidos los snapshots y sus
huellas/fuentes, asignaciones revisadas, curso activo y checksums/tamaños de
cada archivo. Comprueba que se eliminan los archivos anteriores del destino,
que siguen vigentes los bloqueos de escritura de ambos cursos cerrados y que
el curso activo admite cambios. También exige rechazo sin alteraciones ante
una copia corrupta o una confirmación cancelada. Las migraciones se aplican
desde cero; no se desactivan los triggers para restaurar.

Esta prueba valida el contenido y los scripts, **no** la orquestación real de
Docker, permisos de sus volúmenes ni una recuperación completa en Ubuntu.
Tampoco certifica la consistencia de una copia tomada mientras se modifican
documentos en producción.

En desarrollo, el setup posterior a la integración aplica `drizzle push` y
`scripts/apply-course-guards.mjs`: los triggers no se representan en un simple
`push`. Las instalaciones independientes siguen las migraciones versionadas,
incluida `0007_course_guards.sql`, mediante el procedimiento de migración
existente. No basta con crear las columnas para garantizar la inmutabilidad.
