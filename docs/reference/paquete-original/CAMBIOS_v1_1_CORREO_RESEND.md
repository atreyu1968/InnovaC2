# INNOVA-C2 — cambios v1.1 (17/10/2026)

- Dominio remitente confirmado por el promotor: **`iesmmg.org`**.
- Remitentes propuestos y parametrizables: `innovacion@iesmmg.org`, `ciclope@iesmmg.org`, `proyectos@iesmmg.org`.
- Recepción recomendada por Resend en subdominio independiente **`buzon.iesmmg.org`**, `Reply-To: innovacion@buzon.iesmmg.org` (pendiente de creación/validación).
- Bandeja unificada de comunicaciones con personal del centro, responsables de familias, C1, empresas, centros y comunidad educativa en ámbitos autorizados.
- Envíos con Resend, recepción por webhook firmado, almacenamiento local propio, tratamiento de adjuntos, idempotencia y control de rebotes.
- Clasificación y respuesta asistida por IA, con autoenvío solo en categorías generales de bajo riesgo expresamente habilitadas.
- Respuesta siempre humana para solicitudes individuales, datos del alumnado, reclamaciones, compromisos institucionales, dudas sin fuente fiable.
- No tocar MX del dominio raíz sin análisis y autorización. No se ha realizado ningún cambio DNS ni envío de correo.
- Variables de entorno sin secretos reales; ver sección 12 de la especificación.
- Pruebas nuevas AT-41 a AT-52. Fase 3B de implementación (comunicaciones).
- Compatibilidad y autonomía: sin Resend, PIC y gestión interna deben continuar funcionando.
