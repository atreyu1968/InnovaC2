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
- **Fase 3 — CICLOPE y coordinación C2: implementada.** Composición y
  participación, calendario, refrendo institucional configurable, convocatorias
  por bandeja interna autorizada, orden del día, actas manuales versionadas,
  asistencia revisada, acuerdos/tareas y avisos al responsable según su preferencia.
  Agenda C1 separada, permisos por curso y exportaciones DOCX/PDF.
- **Fase 3B — comunicaciones: implementada en modo seguro.** Bandeja y agenda
  por curso, plantillas, borradores, aprobación humana, cola persistente, webhooks
  Resend firmados e idempotentes y adjuntos privados con análisis y revisión.
  El envío requiere dos confirmaciones independientes del servidor, los secretos,
  DNS SPF/DKIM/DMARC y la verificación del dominio. La prueba de esta fase no envía correo.
- **Fases 4–6 — memoria, ATECA/FABLab y asistente IA: pendientes.** No se
  simulan envíos, respuestas, lectura ni capacidades aún no implementadas.
  La grabación/transcripción y el borrador de actas son una extensión parcial de
  IA; no implican que el asistente documental/RAG esté terminado.

### Fase 3: uso, límites y comprobaciones

El menú **CICLOPE** usa el curso activo. C2 organiza el expediente; el equipo
directivo configura si exige refrendo y autoriza expresamente la bandeja
interna como canal institucional. Sin autorización no se emiten convocatorias.
La administración técnica mantiene todas estas funciones con su identidad real.
Una persona participante solo accede a sus reuniones y puede proponer puntos.

El circuito es `programada → convocada → celebrada → acta_borrador →
acta_validada`. La programación no acredita celebración; la celebración solo
se registra después del final previsto. C2 revisa expresamente las asistencias,
el desarrollo y los acuerdos. La validación humana competente crea tareas
vinculadas a la revisión inmutable del acta. Nadie se suscribe a recordatorios
por decisión ajena: cada responsable activa su preferencia. Los avisos se
guardan en su bandeja, no se transfieren a C2.

Las reuniones de red C1 registran convocatorias **recibidas**, separadas de
CICLOPE; no aumentan su número de sesiones. El dato institucional de 21/10/2026
se puede incorporar expresamente desde el formulario, con verificaciones y
asistencia pendientes, sin enlace Meet inventado.

Los adjuntos fijan versión y SHA-256; una nueva versión documental no cambia
una convocatoria anterior. Las revisiones conservan nombres y roles declarados,
no solo referencias a cuentas que podrían cambiar después. Los DOCX/PDF
generados se conservan privadamente bajo `DATA_DIR/ciclope-generated`; las
copias de seguridad existentes incluyen todo `DATA_DIR`. La consulta y descarga
requieren sesión autorizada; no se exponen rutas de almacenamiento.

La redacción manual sigue disponible; la extensión de grabación y borrador IA
se describe a continuación y está desactivada hasta configurar un proveedor. Los avisos
internos no son correos Resend ni acreditan lectura. La Fase 3B separa los
estados aceptado, entregado y rebotado: un OK de Resend no se presenta como una
entrega. Las respuestas automáticas por IA están desactivadas.

### Grabación de reuniones y borrador asistido

En **Configuración → Proveedor de IA**, exclusivamente administración técnica
puede seleccionar desactivado, local o externo expresamente autorizado, indicar
el endpoint base compatible con OpenAI (normalmente terminado en `/v1`), el modelo
de transcripción y el de redacción. El proveedor debe implementar
`POST /audio/transcriptions` (multipart) y `POST /chat/completions` (JSON).
No se usa una integración de Replit ni se elige un proveedor alternativo si falla.
El modo local resuelve únicamente a redes privadas/bucle local; el externo exige
HTTPS, dirección pública, clave y confirmación institucional. Se bloquean
metadatos de infraestructura, redirecciones y respuestas excesivas. La dirección
validada se fija en la conexión para evitar cambios DNS entre validación y envío.

La clave se introduce en esa pantalla, se cifra con AES-256-GCM en PostgreSQL,
no vuelve a mostrarse y nunca se incluye en la auditoría. La llave de cifrado
deriva de `SESSION_SECRET`: conservarlo en la instalación autónoma y sus copias
seguras. Si cambia, hay que volver a introducir la credencial; no se recupera
en claro desde la interfaz. Aplicar migraciones con
`pnpm --filter @workspace/db run migrate` antes de arrancar el servidor actualizado.
El formulario controla revisiones para no pisar cambios simultáneos.

En ese mismo apartado, **Comprobar proveedor guardado** permite a administración
técnica verificar conexión, autenticación y compatibilidad de ambos modelos.
Exige confirmar antes de enviar un tono sintético de un segundo y un texto
ficticio al proveedor guardado; puede generar consumo. No usa reuniones reales,
no modifica ajustes ni guarda actas o resultados. Se bloquea si hay cambios sin
guardar y rechaza una revisión desactualizada. Muestra por separado los errores
de autorización, modelo/ruta/parámetros, formato y conexión. Una respuesta
compatible no acredita precisión de transcripción ni calidad de redacción;
un tono sin voz puede devolver texto vacío. La comprobación limita cada solicitud
a 20 segundos. Pruebas aisladas, sin base de datos ni proveedor real:
`pnpm run test:ai-provider-check`.

C2 o administración técnica pueden grabar una reunión **convocada**, de manera
presencial por micrófono o mezclando audio de una pestaña online y, opcionalmente,
su propio micrófono. Es obligatorio informar a participantes y confirmar su
consentimiento. El navegador debe permitir micrófono/compartición en un contexto
seguro (HTTPS o localhost). La captura de pestaña y el audio compartido dependen
del navegador; la subida de una grabación es la alternativa. En instalaciones
embebidas, el contenedor también debe conceder estos permisos.

El audio admite hasta 50 MB por fragmento (el proveedor puede imponer menos).
Permanece **solo en memoria del navegador** hasta procesarlo o descartarlo, con
preescucha y confirmación antes de reemplazarlo. Se conserva al cambiar de
sección o reunión dentro de la misma página; cerrar/recargar lo pierde y muestra
un aviso. Cerrar sesión exige confirmación si hay audio pendiente y lo descarta.
Para procesarlo hay que detener la grabación y marcar la reunión como celebrada,
una vez pasada su hora de fin. No hay archivos originales ni copias de audio en
`DATA_DIR`, base de datos, localStorage o IndexedDB: el servidor lo usa en memoria
para transmitirlo al proveedor. Tras éxito se elimina también del navegador;
si falla, se mantiene localmente para reintentar o descartarlo. La retención
en un proveedor externo depende de su contrato: verificarla antes de autorizarlo.

Solo se conservan transcripción, origen/constancia de consentimiento, borrador,
revisión inmutable y auditoría técnica. La IA no marca asistencias, no crea
acuerdos ni certifica aprobación. Las notas previas requieren autorización de
sustitución; si la reunión o el proveedor cambian durante el proceso, no se
sobrescribe una revisión humana más reciente ni se manda el texto a otro proveedor.
El borrador debe revisarse y validarse por la persona competente. Un fallo del
proveedor no guarda un acta parcial ni modifica las notas existentes.

**Comprobaciones reproducibles:** `pnpm run test:phase3` crea un PostgreSQL
temporal independiente y un proveedor HTTP local de pruebas. Comprueba permisos,
CSRF, cifrado/no exposición de claves, consentimiento, concurrencia, conservación
del original fuera del servidor, errores y ausencia de aprobación automática.
Ese proveedor existe solo en pruebas: no sustituye a la IA de la aplicación y
no demuestra la calidad o compatibilidad de un servicio externo real.

### Fase 3B: comunicaciones y configuración

La bandeja usa contactos del curso activo con una referencia de autorización,
clasificación y control de baja. Cada mensaje se crea individualmente por
destinatario; el C2 y la dirección pueden revisar y gestionar conversaciones.
Los borradores se guardan sin proveedor y la cola informa que no ha enviado nada.
La aplicación no responde automáticamente ni expone credenciales en el navegador.

El administrador técnico gestiona el proveedor exclusivamente en **Configuración**.
La clave API y el secreto Svix son variables privadas del servidor; la pantalla
solo informa si están configuradas. La comprobación consulta DNS público y el
estado de Resend en modo de solo lectura: no cambia registros DNS ni el MX raíz.
Antes de habilitar envíos hay que verificar SPF, DKIM, DMARC, la recepción en
`buzon.iesmmg.org` y el dominio de Resend. Además de `EMAIL_ENABLED`, el servidor
requiere `EMAIL_ACTIVATION_CONFIRMED` como confirmación institucional separada.
Las firmas, duplicados y curso activo se comprueban en servidor.
Los adjuntos entrantes se guardan en almacenamiento privado, se someten a ClamAV,
y requieren aprobación humana antes de poder descargarse. Sin ClamAV permanecen
en cuarentena.

Para un servidor Ubuntu independiente, mantén `EMAIL_ENABLED=false` y
`EMAIL_ACTIVATION_CONFIRMED=false`. Guarda `RESEND_API_KEY` y
`RESEND_WEBHOOK_SECRET` solo en el almacén de secretos. No actives el envío hasta
completar DNS y recibir la autorización institucional documentada.

Prueba reproducible, sin reutilizar `DATABASE_URL` ni datos del centro:

```bash
pnpm run test:phase3
```

Requiere PostgreSQL (`initdb`, `pg_ctl`) en `PATH`. Crea un clúster temporal,
aplica todas las migraciones, arranca una API independiente y elimina el entorno
al finalizar. Comprueba permisos, CSRF, cuatro sesiones, refrendo, solapamientos,
estados, C1 separado, actas, responsables/avisos, concurrencia, DOCX/PDF, revisión
inmutable e inclusión de CICLOPE en el expediente cerrado. La última ejecución
conjunta Fase 3/Fase 3B completó **116 comprobaciones API correctas**.

Fase 3B y regresión CICLOPE (clúster PostgreSQL temporal, Resend sin clave):

```bash
pnpm run test:phase3b
```

Comprueba contactos y plantillas locales, aprobación independiente, adjuntos
autorizados, firma/deduplicación del webhook, estado DNS de solo lectura y que la
cola persiste sin afirmar envío cuando el proveedor está desactivado. La prueba
no contacta con Resend ni envía correo real.

Una pasada de navegador sobre el entorno desechable comprobó persistencia,
refrendo, convocatoria, asistencia, acta validada, historial, descargas DOCX/PDF,
tarea del docente y adaptación a móvil. Detectó que editar el acta borraba la
indicación del refrendo anterior; se corrigió y se añadió una regresión por API.
No se verificó en navegador el selector de adjuntos por no disponer de un
documento limpio aprobado en ese entorno; no se falsificó el análisis antivirus.

Ubuntu/Proxmox conserva el procedimiento autónomo existente: reconstruir la
imagen, ejecutar `./scripts/migrate.sh` y arrancar `docker compose up -d`.
Las migraciones `0008` y `0009` crean las tablas y los bloqueos de cursos
cerrados/versiones inmutables. En desarrollo se aplica `pnpm --filter
@workspace/db run push` seguido de `node scripts/apply-course-guards.mjs`;
un `push` aislado no instala los triggers.

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
