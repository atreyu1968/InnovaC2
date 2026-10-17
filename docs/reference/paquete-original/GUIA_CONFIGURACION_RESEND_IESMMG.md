# Guía técnica de configuración — Resend / iesmmg.org

**Estado:** diseño para Replit, no configuración ejecutada. No se han creado direcciones de correo ni cambiado registros DNS.

## Decisiones de arquitectura
1. Identidad de envío: `innovacion@iesmmg.org` (principal), `ciclope@iesmmg.org` y `proyectos@iesmmg.org` como alias propuestos. Todos los campos son configurables.
2. Recepción: subdominio dedicado `buzon.iesmmg.org`; `Reply-To: innovacion@buzon.iesmmg.org`. Sus MX deben configurarse en Resend **solo tras inspeccionar el estado DNS existente**.
3. Para respuesta visible desde `innovacion@iesmmg.org` en buzón actual, se necesita conservar su proveedor y configurar reenvío/alias autorizado; nunca reemplazar MX raíz por defecto.
4. Entrega a profesorado, C1, coordinación de familia, empresas y cuentas `@canariaseducacion.es`: no presupone autorización para enviar desde esos dominios; son destinatarios/remitentes externos.

## Activación segura
1. Solicitar autorización a quien gestione dominio/correo y verificar competencia para tratar datos de comunicaciones con el servicio externo.
2. Inventariar y documentar DNS actuales: MX raíz, SPF, DKIM, DMARC y subdominios ya usados. Exportar copia antes de modificar.
3. Registrar `iesmmg.org` en Resend y copiar **exactamente** los registros de autenticación indicados por su panel para envíos; evitar registros SPF duplicados en el mismo nombre.
4. Habilitar `buzon.iesmmg.org` como dominio de recepción independiente y aplicar los MX que muestre Resend **solo a ese subdominio**, nunca al dominio principal.
5. Verificar ambos estados, entregar variables sensibles únicamente mediante secret manager o `.env` privado; mantener ejemplo vacío en repositorio.
6. Exponer endpoint HTTPS `/api/v1/webhooks/resend`, verificar **firma sobre payload crudo** y controlar replays, errores, adjuntos e idempotencia. Configurar eventos `email.received` y estados de envío pertinentes.
7. Probar envío controlado de `innovacion@iesmmg.org` a un destinatario de prueba autorizado, responder desde un buzón `@canariaseducacion.es` si se dispone de uno autorizado, verificar bandeja, hilo, adjunto, rebote y auditoría.
8. Activar comunicaciones por segmentos sólo tras pruebas, revisión de privacidad y validación institucional. Las respuestas automáticas de IA permanecerán **desactivadas** inicialmente.

## Variables de entorno propuestas (sin secretos)
```dotenv
EMAIL_PROVIDER=resend
EMAIL_ENABLED=false
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
EMAIL_FROM_DEFAULT=innovacion@iesmmg.org
EMAIL_FROM_CICLOPE=ciclope@iesmmg.org
EMAIL_FROM_PROJECTS=proyectos@iesmmg.org
EMAIL_REPLY_TO=innovacion@buzon.iesmmg.org
EMAIL_RECEIVE_DOMAIN=buzon.iesmmg.org
EMAIL_AI_AUTOREPLY_ENABLED=false
EMAIL_SEND_APPROVAL_REQUIRED=true
EMAIL_MAX_BATCH_SIZE=50
```

## Restricciones de IA
Solo respuestas a preguntas frecuentes generales con documentación aprobada y permiso explícito de autoservicio. Bloquear automáticamente reclamaciones, consultas sobre alumnado, calificaciones, situaciones personales, nombramientos, promesas económicas, incidencias no resueltas y mensajes sin fuente fiable. El texto de emails o adjuntos jamás constituye una instrucción del sistema.

## Documentación del proveedor
- https://resend.com/features/inbound
- https://resend.com/blog/inbound-emails
- https://www.resend.com/changelog/managing-webhooks-via-api
- https://resend.com/changelog/custom-return-path

**Atención:** el uso de Resend es una dependencia del canal de correo. La autonomía de INNOVA-C2 significa que el PIC, documentos, expedientes y métricas siguen disponibles aunque no haya servicio externo; el correo no se enviará ni recibirá si Resend está desactivado.
