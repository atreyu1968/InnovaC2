# Lista de conformidad para recepción de trabajo de Replit

Marcar únicamente tras ejecutar la prueba y conservar evidencia. No sustituir por afirmaciones del agente.

| Elemento | Evidencia exigida | Estado inicial |
|---|---|---|
| Instalación Ubuntu/Proxmox | Instalación desde contenedor limpio y acceso funcional | Pendiente |
| Operación independiente de Replit | Servicio reiniciado y datos recuperados fuera de Replit | Pendiente |
| Sin Laycos integrado | Revisión de rutas, conectores y código; exportación manual probada | Pendiente |
| Catálogo PIC | Resultado de `python qa/validate_catalog.py` | Pendiente |
| Pruebas AT-01 a AT-40 | Capturas/logs o reporte del runner, enlazado con cada prueba | Pendiente |
| Seguridad RBAC | Matriz de permisos y prueba de acceso no autorizado | Pendiente |
| Datos sin inventar | Estados sin información y no realizado diferenciados | Pendiente |
| Datos únicos | Duplicado documental no incrementa número de actuaciones | Pendiente |
| CICLOPE C2 operativo | Convocatoria, acta, acuerdos y validación institucional probados | Pendiente |
| FABLab y ATECA | Un proyecto utiliza ambos espacios sin duplicar evento | Pendiente |
| Innovando en FP | 3 productos con versiones y estados independientes | Pendiente |
| Copia/restauración | Backup íntegro y restore en entorno de prueba | Pendiente |
| Sin IA | Desactivar IA sin pérdida de funciones P0/P1 | Pendiente |
| Exportaciones | Comparación campo a campo con DOCX fuente del PIC | Pendiente |
| Documentación | README, manuales, `.env.example`, mantenimiento | Pendiente |


## Complemento v1.1 — correo Resend / dominio iesmmg.org
- [ ] Dominio `iesmmg.org` verificado sin alterar el MX principal (AT-41).
- [ ] Envío real y estado de Resend verificados (AT-42).
- [ ] Respuesta procedente de `@canariaseducacion.es` recibida y asociada al hilo (AT-43).
- [ ] Subdominio entrante separado `buzon.iesmmg.org` correctamente configurado (AT-44).
- [ ] Webhooks de recepción/estado firmados e idempotentes (AT-45).
- [ ] Adjuntos con protección y segregación de permisos (AT-46).
- [ ] Autorespuesta únicamente en FAQ institucional aprobada, con IA activada expresamente (AT-47).
- [ ] Consultas individuales de alumnado y reclamaciones bloqueadas de autoenvío (AT-48).
- [ ] Consulta sin fuente documental fiable nunca recibe respuesta automática (AT-49).
- [ ] Fallos de Resend crean incidencia; no falsean estados de comunicación (AT-50).
- [ ] Núcleo continúa operativo sin Resend ni IA (AT-51).
- [ ] Emails duplicados no duplican actuaciones ni indicadores PIC (AT-52).
