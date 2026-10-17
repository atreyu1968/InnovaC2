# ClamAV: cuarentena, recuperación y prueba real en Ubuntu

## Operación normal

En la instalación Ubuntu con `docker-compose.yml`, ClamAV 1.4 está en la red
privada `innova_private`, sin puerto publicado. Su volumen `clamav_data`
conserva las firmas actualizadas por freshclam. La API usa INSTREAM sobre TCP
(`CLAMAV_HOST=clamav`, `CLAMAV_PORT=3310`); no comparte el volumen documental
con el antivirus. El límite documental de la API es 8 MiB y cada análisis tiene
un plazo máximo de 8 segundos. Un cierre prematuro, respuesta inesperada,
error o timeout nunca se interpreta como limpio.

En el primer arranque Compose espera el estado saludable de ClamAV, que puede
tardar varios minutos en descargar las firmas. No quitar esta dependencia para
acelerar la instalación. Comprobar:

```bash
docker compose ps
docker compose logs --tail=100 clamav
docker compose exec clamav clamdscan --ping 1
```

Si el antivirus cae después del arranque, la API sigue guardando versiones
inmutables en cuarentena (`no_disponible`). Sin configuración registra
`no_configurado`. Las descargas y la aprobación permanecen bloqueadas mientras
el resultado de esa versión no sea `limpio`. Un archivo detectado durante la
subida se rechaza sin guardarlo; si ya estaba en cuarentena cuando se detecta,
se conserva bloqueado con estado `infectado`.

## Recuperar versiones conservadas

1. Resolver la causa de la caída (memoria, espacio, conectividad o firmas).
   Revisar los logs de ClamAV/freshclam antes de reiniciar:

   ```bash
   docker compose up -d clamav
   docker compose exec clamav clamdscan --ping 1
   ```

2. Entrar en **Actuaciones y evidencias → Documentos**, seleccionar el documento
   y pulsar **Reanalizar versión N** en «Versiones conservadas». El botón solo
   se muestra al propietario del documento o a Coordinación C2, dentro del centro.
   Administración técnica hereda los permisos de C2 según la política vigente,
   sin suplantar la identidad del actor ni omitir controles antivirus.
   Compartir acceso o pertenecer a la misma familia no concede este permiso.
3. Esperar el resultado. No se vuelven a subir bytes ni se altera SHA-256,
   nombre, tamaño, número de versión ni clave de almacenamiento. La API verifica
   tamaño y hash de los bytes guardados antes del análisis. Si faltan o difieren,
   registra el fallo de integridad y mantiene el bloqueo.
4. Con resultado limpio, esa versión ya se puede descargar. C2 debe **aprobar**
   expresamente la versión actual antes de que su evidencia pueda contribuir a
   indicadores. Reanalizar una versión histórica no sustituye a la actual ni
   aprueba el documento. Cada resultado invalida la revisión anterior.

La operación es `POST /api/v1/documents/{documentId}/versions/{version}/rescan`
con sesión, cabecera `X-CSRF-Token` y JSON `{"expectedRevision": N}`.
Devuelve el documento actualizado (el `scanStatus` de la respuesta corresponde
a la **versión actual**; consultar `GET /documents/{id}` para el histórico).
`200` significa que se registró el resultado, no necesariamente que sea limpio.
`400` indica entrada inválida, `403` permiso insuficiente, `404` versión o ámbito
inexistente y `409` revisión obsoleta, operación concurrente, versión ya limpia o
fallo de integridad. Tras un `409`, recargar antes de reintentar.

El bloqueo PostgreSQL de la fila documental cubre la lectura y el análisis;
otro reintento simultáneo recibe `409` sin quedar en cola, incluso con varias
instancias de API. Se libera automáticamente si muere el proceso. El cambio de
estado de versión, evidencia, revisión y auditoría se confirma en una única
transacción. La auditoría `document.version.rescanned` registra actor y fecha,
versión, hash, resultado anterior/nuevo, integridad, inicio/fin y revisión
esperada/nueva; los conflictos se registran como
`document.version.rescan_conflict`. No se guardan bytes ni rutas en el registro.
La interfaz actualiza lista/detalle tras el reintento y los consulta cada 30 s
mientras está activa para reflejar cambios de otra sesión.

## Prueba automática con motor real y datos aislados

No ejecutar pruebas de caída/EICAR sobre la instalación del centro. Desde una
copia de trabajo, como usuario **no root**, instalar Node.js 24 y pnpm 10.26.1
según los requisitos del proyecto, y los binarios de Ubuntu:

```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-client clamav-daemon
# initdb y pg_ctl no suelen estar en PATH en Ubuntu:
export PATH="$(pg_config --bindir):$PATH"
pnpm install --frozen-lockfile
pnpm run test:clamav
```

Si se instaló solo el paquete servidor sin herramientas de desarrollo y no existe
`pg_config`, añadir al PATH `/usr/lib/postgresql/<version-instalada>/bin`.
`clamd` debe estar en PATH (habitualmente `/usr/sbin`); se puede indicar otro
binario mediante `CLAMD_BIN=/ruta/clamd pnpm run test:clamav`.
No es necesario detener servicios PostgreSQL/ClamAV del sistema.

El comando construye la API, crea PostgreSQL en un directorio temporal con socket
Unix privado (sin escuchar TCP), crea una base nueva, aplica el esquema y ejecuta
la batería de fase 2 con API y `DATA_DIR` temporales. No usa ni prepara
`DATABASE_URL` del centro ni pide `TEST_DATABASE_URL`. Al terminar, incluso si una
aserción falla, cierra la API y el motor, elimina los datos de prueba y detiene
el PostgreSQL temporal. Una interrupción forzada del sistema (`SIGKILL`, apagado)
puede requerir retirar recursos temporales manualmente; nunca borrar directorios
de una prueba que siga en ejecución.

Se ejecuta el **binario clamd real**, sin respuestas simuladas. Para que la prueba
sea repetible sin Internet usa una base HDB mínima, solo en el directorio de
pruebas, con la firma del patrón estándar **EICAR**. EICAR es inocuo y no es una
muestra de malware. Esta prueba confirma protocolo, motor y flujo completo,
**no** la actualización ni cobertura de las firmas de producción: comprobar
freshclam y la salud del contenedor separadamente. Nunca copiar esta base mínima
al volumen productivo.

Comprueba archivo inocuo, rechazo EICAR en subida, EICAR ya conservado en
cuarentena, indisponibilidad real (daemon parado), recuperación y nueva caída,
permisos de propietario/C2 frente a lectores/jefatura y herencia C2 de administración técnica,
sesión/CSRF, entradas inválidas, revisión obsoleta y bloqueo concurrente real
PostgreSQL. Compara bytes y metadatos antes/después, descarga histórica/actual,
aprobación explícita y conteo de indicadores posterior; comprueba además que
una alteración de bytes nunca recibe autorización de descarga.

Comprobaciones complementarias: `pnpm run typecheck`.
La prueba no conduce un navegador ni valida visualmente el botón tras iniciar
sesión. La configuración Compose se revisa por separado; este entorno de
desarrollo no ejecuta Docker y no sustituye una comprobación del contenedor
Ubuntu con sus firmas completas.
