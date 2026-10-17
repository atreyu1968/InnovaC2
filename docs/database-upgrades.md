# Actualización segura de PostgreSQL (Ubuntu y autohospedado)

Este procedimiento es para la instalación autónoma con PostgreSQL **16**.
No modifica producción desde Replit y no presupone que Replit Publish gestione,
respalde o actualice una base externa. Los comandos se ejecutan en el servidor
que administra esa base, desde la raíz de la instalación.

## Qué se comprueba

`lib/db/drizzle/meta/_journal.json` es el orden autorizado: actualmente contiene
16 entradas. Hay prefijos numéricos repetidos de ramas anteriores; **no ordenar
los archivos por nombre ni renombrar migraciones ya aplicadas**. Se verifica que
todos los SQL estén registrados, que los índices y fechas sean crecientes y que
los hashes de los archivos coincidan con la referencia.

La referencia `scripts/migrations/reference.json` se reproduce ejecutando cada
migración en un clúster nuevo. Contiene huellas por objeto y por estado del
diario, no datos de usuarios. El preflight compara:

- Tablas y clases de relación, persistencia, particiones y opciones.
- Columnas: tipos, nulabilidad, valores por defecto, identidad, generación,
  dimensiones y colaciones. El orden físico de columnas no se considera una
  diferencia: un `push` puede crearlas en otro orden sin cambiar sus nombres ni
  su significado.
- Restricciones (incluida su validación y aplazamiento), índices y su estado.
- Funciones completas y triggers, también el estado de los triggers internos de
  las claves externas; no basta con que exista un trigger con el mismo nombre.
- Enumerados/dominios, secuencias y su propiedad, reglas/vistas, políticas RLS,
  herencia y extensiones. Los contadores de secuencia no se reinician.
- Objetos inesperados y la estructura y contenido del registro Drizzle.

Es una comparación estricta, no un corrector general de esquemas. Objetos
adicionales, definiciones distintas o estados no reconocidos bloquean el proceso.
No se ignoran las protecciones de cursos cerrados, seguimientos o entregas.
No se certifica que todos los datos históricos cumplan reglas que no existían
cuando se guardaron, ni que un curso esté aprobado. Permisos de conexión,
propiedad/grants de administración y configuración del servidor siguen siendo
responsabilidad del administrador; no se sobrescriben.

## 1. Preparar y consultar, sin escribir

Conservar `.env`, `SESSION_SECRET` y `BACKUP_ENCRYPTION_KEY` en un lugar seguro,
fuera del repositorio y de las propias copias. La copia cifra la base y los
documentos, pero no incorpora las claves. Tener espacio para la copia y una
restauración de ensayo.

```bash
docker compose build api
docker compose up -d db
./scripts/migrate.sh --preflight
```

También `./scripts/migrate.sh` **sin argumentos solo comprueba**. Se usa un
contenedor puntual sin ejecutar el arranque de la API, por lo que funciona aunque
esta esté detenida. La consulta abre una transacción de solo lectura con una
instantánea coherente y no crea el esquema ni el ledger Drizzle.

Resultados:

| Estado | Interpretación |
| --- | --- |
| `fresh` | Sin objetos de aplicación ni migraciones registradas. |
| `tracked` | Ledger conocido, contiguo y esquema idéntico al prefijo registrado. |
| `baseline-required` | Tablas existentes y ledger vacío; coincide exactamente con un estado conocido. |
| `blocked` | Diferencias estructurales; se enumeran objetos ausentes, distintos o adicionales. Salida distinta de cero. |

Un ledger con hashes desconocidos, huecos, fechas alteradas o estructura ajena
también falla. No se «arregla» insertando la última fecha ni truncando el registro.

## 2. Ensayar primero sobre una copia

Antes de operar una instalación con datos, restaurar su copia en **otro servidor,
clúster o proyecto Compose con volúmenes nuevos**. No basta con cambiar el nombre
de una base que ya exista. Usar credenciales y `SESSION_SECRET` de ensayo, sin
activar correo, colas externas ni IA. No arrancar una API con credenciales reales
de servicios externos para probar una restauración.

Ejecutar allí el preflight, el comando aplicable del apartado siguiente y una
segunda actualización. Comparar registros, archivos y ledger antes/después.
Nunca usar `restore.sh` sobre la instalación original para hacer este ensayo:
ese script reemplaza datos y solo pertenece a una restauración autorizada.

## 3. Aplicar con copia previa obligatoria

Programar mantenimiento; cerrar el acceso de usuarios y detener cualquier
proceso externo que escriba en la base. Los comandos siguientes detienen la API,
repiten el preflight, crean una copia cifrada **con la API detenida**, verifican
sus sumas y conservan el resultado junto al respaldo. No borran ni recrean tablas
de aplicación y no reinician automáticamente la API.

Para un ledger normal con migraciones pendientes:

```bash
./scripts/migrate.sh --apply
```

Para tablas con ledger vacío y coincidencia exacta:

```bash
./scripts/migrate.sh --apply --baseline
```

`--baseline` reconoce exclusivamente el prefijo cuya estructura se ha demostrado.
Inserta sus hashes y fechas reales; **no vuelve a ejecutar esos SQL**. Las
migraciones posteriores se ejecutan en orden. El registro, las migraciones
pendientes y la verificación final forman una sola transacción. Se toman un
bloqueo de mantenimiento y bloqueos de tablas; ante error o tiempo de espera se
revierte esa transacción completa. La copia anterior queda conservada.

El respaldo está en `BACKUP_DIR/migration-<fecha>-<identificador>/...`, o en
`backups/` si no se configuró otra ruta. Incluye `database.dump.enc`,
`documents.tar.gz.enc`, `SHA256SUMS` y, tras el éxito, `migration-result.json`.
Verificar sumas detecta corrupción; **no sustituye probar la restauración**.

### Excepción explícita: solo faltan funciones/triggers de protección

Una instalación creada con `drizzle push` puede tener todas las tablas y columnas
pero carecer de protecciones escritas a mano. El preflight devuelve
`guardRepairAvailable: true` únicamente si todas las diferencias son funciones
o triggers **ausentes**, cuyas definiciones están en la referencia conocida, y
el ledger está vacío.

En ese caso, tras el ensayo:

```bash
./scripts/migrate.sh --apply --baseline --repair-guards
```

Se añade exclusivamente lo ausente, con el SQL reproducido desde el diario.
Después se exige de nuevo coincidencia total **antes** de reconocer el historial.
No se reemplazan funciones distintas, no se habilitan silenciosamente triggers
desactivados, no se corrigen columnas, no se suprimen objetos adicionales y no
se reescriben filas. Si algo más difiere, la operación se revierte y queda
bloqueada. No usar `push-force`, vaciar el ledger o eliminar tablas para saltarla.

### Después de aplicar

```bash
./scripts/migrate.sh --preflight
docker compose up -d api
docker compose ps
docker compose logs --tail=100 api
./scripts/health.sh
```

La segunda ejecución no añade filas al ledger ni repite SQL. El arranque
automático solo inicializa una base nueva o acepta una ya actualizada: una base
existente con migraciones pendientes o ledger vacío se detiene con instrucciones
de mantenimiento, en lugar de actualizarla sin copia.

Si falla una comprobación, la API queda detenida. Revisar el informe y corregir la
causa en una copia antes de reintentar. No se hace una restauración destructiva
automática ni se borra el respaldo.

## PostgreSQL externo sin Compose

Usar las herramientas del administrador para detener escritores y crear/verificar
una copia cifrada del **mismo destino**, con los dos archivos y `SHA256SUMS` del
formato anterior. Guardar `DATABASE_URL` en el entorno seguro; no pasar claves
ni URLs con contraseña como argumentos o en el chat.

```bash
pnpm --filter @workspace/db run preflight
node scripts/migrate-database.mjs --apply --backup-dir /ruta/copia
# Solo si el preflight lo permite:
node scripts/migrate-database.mjs --apply --baseline --backup-dir /ruta/copia
# Añadir --repair-guards únicamente para la excepción documentada.
```

El verificador comprueba integridad y presencia de los archivos cifrados, no
puede demostrar que una copia facilitada manualmente pertenece al destino ni que
se puede descifrar: el administrador debe verificarlo mediante restauración.
No admite comparaciones entre versiones mayores de PostgreSQL; una actualización
de motor necesita su propio ensayo y referencia.

## Regresión reproducible sin base preparada a mano

Requisitos: Node/pnpm y herramientas PostgreSQL 16 (`initdb`, `pg_ctl`, `pg_dump`,
`pg_restore`). Ejecutar como usuario sin privilegios de root.

```bash
pnpm run test:migrations
# Solo en este workspace de desarrollo, opt-in explícito de copia de DATABASE_URL:
node scripts/test-migrations.mjs --copy-development
```

La prueba normal no usa `DATABASE_URL` ni `TEST_DATABASE_URL`. Crea y elimina un
clúster propio sin puerto TCP. Reproduce todas las migraciones y compara la
referencia versionada, prueba instalación limpia, actualizaciones repetidas,
ledger intermedio, copia/restauración con registros existentes, reparación
limitada de guardas, detección de desviaciones y reversión ante fallo. Ejecuta
también los scripts de mantenimiento copiados en un directorio aislado, mediante
un adaptador estricto de comandos Docker con `pg_dump`, cifrado y restauración
reales. Esto no verifica la orquestación Docker ni permisos de volúmenes en Ubuntu.

La variante de desarrollo solo hace `pg_dump` de la fuente en modo de solo
lectura; toda reparación o reconocimiento se realiza en la copia dentro del
clúster privado. Compara el número y la huella de todas las filas preexistentes,
sin mostrar su contenido, y elimina los archivos temporales al terminar.
**No ejecutar esa opción contra producción.**

Al añadir migraciones, reconciliar primero el diario y generar la referencia:

```bash
node scripts/test-migrations.mjs --generate-reference
pnpm run test:migrations
```

La referencia nunca se genera a partir de una instalación existente ni se edita
para aceptar sus diferencias. Revisar el SQL nuevo y conservar las migraciones
históricas sin cambios.
