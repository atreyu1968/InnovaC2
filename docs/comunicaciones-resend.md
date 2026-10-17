# Centro de comunicaciones institucionales

## Estado seguro por defecto

En `.env` conserva:

```dotenv
EMAIL_ENABLED=false
EMAIL_ACTIVATION_CONFIRMED=false
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
```

Las claves solo van en el almacén seguro del servidor. El envío exige que
`EMAIL_ENABLED` y `EMAIL_ACTIVATION_CONFIRMED` estén confirmados, que la cuenta
Resend tenga la clave, que el ajuste del centro permita procesar la cola, que
Resend confirme el dominio y que la comprobación DNS pública esté completa.
Las cuentas nuevas mantienen el envío desactivado y la aprobación humana no se
puede deshabilitar.

Sin proveedor, la aplicación permite mantener contactos, segmentos, plantillas,
conversaciones y borradores. Los mensajes aprobados permanecen en la cola
persistente; el estado de cola nunca se presenta como envío o entrega.

## Verificación DNS de solo lectura

En **Configuración → Correo institucional → Comprobar DNS y Resend**, la API
consulta:

- TXT SPF en `iesmmg.org` y `send.iesmmg.org`.
- DKIM en `resend._domainkey.iesmmg.org`.
- DMARC en `_dmarc.iesmmg.org`.
- MX de recepción en `buzon.iesmmg.org`.
- El MX actual de `iesmmg.org`, solo para informar y confirmar que la consulta
  no lo modifica.

La comprobación no escribe DNS. Configura la recepción únicamente en
`buzon.iesmmg.org`; no cambies el MX raíz ni sustituyas registros SPF
existentes. La verificación de Resend y la consulta pública DNS son señales
independientes: ambas deben estar completas para habilitar la cola.

El estado observado el 17 de octubre de 2026 encontró que `iesmmg.org` no
publicaba MX raíz; `send.iesmmg.org` publicaba `v=spf1 include:amazonses.com
~all` y había una clave TXT en `resend._domainkey.iesmmg.org`. No se encontró
`_dmarc.iesmmg.org` ni MX en `buzon.iesmmg.org`. Por tanto, el DNS no está
completo y el envío debe seguir desactivado. La clave DKIM visible no se pudo
cotejar con los valores actuales de la cuenta Resend. Esta instantánea no
sustituye una comprobación nueva.

## Activación autorizada

No activar hasta que dirección y las personas responsables confirmen la
titularidad del dominio y la cuenta Resend, DNS, destinatarios autorizados,
finalidad y base jurídica, conservación, encargo de tratamiento y revisión del
DPD. Solo después de esa confirmación se configuran las variables privadas:

```dotenv
EMAIL_ENABLED=true
EMAIL_ACTIVATION_CONFIRMED=true
RESEND_API_KEY=<configurada en el gestor de secretos>
RESEND_WEBHOOK_SECRET=<configurado en el gestor de secretos>
```

La confirmación explícita es un segundo seguro de servidor; no se activa durante
una instalación rutinaria ni se guarda en el repositorio. Configurar HTTPS y
registrar en Resend la URL pública
`https://<dominio-publicado>/api/v1/webhooks/resend`. No se genera ni se supone
un dominio público desde el nombre local del contenedor.

Antes de comunicaciones generales, realizar una prueba controlada de envío y
respuesta desde una cuenta autorizada, con un destinatario de prueba que haya
dado permiso. No probar con listas reales. La aplicación no envía mensajes de
prueba automáticamente y no afirma entrega hasta recibir el evento del
proveedor.

## Operación Ubuntu / Proxmox

Desde el directorio de la instalación:

```bash
sudo ./scripts/migrate.sh
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

El correo institucional usa las migraciones PostgreSQL existentes y los mismos
procedimientos autónomos de actualización y copia de seguridad. Mantén
`EMAIL_ENABLED=false` y `EMAIL_ACTIVATION_CONFIRMED=false` al instalar y
actualizar. El worker procesa el correo en el servicio API; la cola se conserva
en PostgreSQL y los eventos de webhook son idempotentes. Los fallos temporales
se reintentan con espera y límite; si el proveedor está desactivado no se inicia
un envío.

No copiar secretos en logs, capturas, `docker-compose.yml` ni archivos
versionados. La instalación incluye ClamAV; los adjuntos entrantes se guardan en
almacenamiento privado, se analizan y permanecen en cuarentena hasta la revisión
humana. Los adjuntos salientes solo pueden proceder de versiones documentales
vigentes, aprobadas, limpias y compartidas con el centro.

## Bandeja, aprobaciones y CICLOPE

- Contactos y plantillas se limitan al centro y al curso activo. Cada contacto
  requiere segmento y referencia de autorización.
- Cada destinatario recibe su propio mensaje. La clasificación y las bajas se
  respetan, salvo comunicaciones obligatorias.
- Una persona distinta de quien redactó debe aprobar el borrador antes de ponerlo
  en cola.
- Las convocatorias CICLOPE conservan su refrendo y los destinatarios del
  expediente; la integración solo prepara el borrador institucional.
- La recepción usa el subdominio `buzon.iesmmg.org`. Se verifica la firma Svix
  sobre el cuerpo original, se deduplican eventos y se correlacionan respuestas
  mediante token de conversación y cabeceras Message-ID.
- No hay auto-respuesta con IA. Los mensajes entrantes y sus adjuntos se tratan
  como contenido no confiable.

## Comprobaciones

`pnpm run test:phase3b` ejecuta las comprobaciones AT-41–AT-46 y AT-50–AT-51
contra una base PostgreSQL temporal y las regresiones CICLOPE. No usa credenciales
Resend ni envía correo real. La entrega y respuesta externa de AT-42/AT-43
quedan pendientes hasta contar con credenciales, DNS y autorización confirmados.
