# ENTRADA PARA EL AGENTE DE REPLIT — CONSTRUIR INNOVA-C2

Construye la aplicación web **INNOVA-C2** con código real y funcional. Sigue como requisitos vinculantes la especificación completa adjunta en `ESPECIFICACION_FUNCIONAL_TECNICA_INNOVA_C2.md` y el catálogo oficial incluido en `config/pic_2026_2027_catalogo.json`.

## Objetivo del producto
Una aplicación autónoma de gestión de la coordinación C2 de innovación FP del IES Manuel Martín González: recoge información ya existente, evita duplicados, solicita a los responsables solo datos imprescindibles, conserva evidencias, calcula indicadores sin IA, genera documentos y prepara una ficha de traslado **manual** a Laycos. Incluye la gestión operativa y convocatorias de CICLOPE por la persona C2, con el equipo directivo en sus funciones institucionales. **Centro de comunicaciones bidireccional con Resend desde `iesmmg.org` y bandeja inteligente**, según especificación §12; recepción preferente en `buzon.iesmmg.org` para respetar el MX raíz. Debe funcionar fuera de Replit, sobre Ubuntu/Proxmox, con PostgreSQL y almacenamiento propio.

## Restricciones explícitas
1. **PROHIBIDO desarrollar integración, scraping, automatización de navegador o envío automático a Laycos.** El único mecanismo es preparación de campos, copia, exportación y comprobante de presentación manual.
2. El sistema debe funcionar sin proveedor IA y sin conectores externos. La IA es opcional, con aprobación humana y citas a evidencia.
3. No producir solo mockups, demos o valores hardcoded: implementar autenticación, persistencia, RBAC, migraciones, endpoints, documentos, pruebas y backups reales.
4. En el PIC utilizar los identificadores y etiquetas del JSON; hay 6 objetivos, 24 acciones y 31 indicadores oficiales. Una actuación puede contribuir a varios indicadores, pero no duplicarse como evento.
5. Gestión de todos los proyectos internos sin límite, mientras que el PIC declara máximo 6 proyectos seleccionados explícitamente.
6. Reconocer FABLab como instalación permanente compartida por todas las familias, distinta de ATECA.
7. Crear proyecto transversal «Innovando en FP» con productos INNOVA-C2, CoordinacionFP y SafeExit en estados independientes; «FP Inteligente» como línea SCORM/IA.
8. El C2 organiza y convoca operativamente CICLOPE; permitir refrendo institucional configurable cuando corresponda.
9. No considerar certificados de 40 horas como pagos económicos ni falsificar asistencia, nombramientos o entregas.
10. No incluir contraseñas, tokens ni datos sensibles del centro en repositorio ni datos de demo.
11. Comunicaciones salientes con Resend y `iesmmg.org`: verificar dominio, SPF/DKIM/DMARC y **no modificar los MX del dominio raíz**. Inbound en subdominio dedicado `buzon.iesmmg.org`, webhook firmado, bandeja, adjuntos controlados, correlación por Message-ID y auditoría.
12. IA clasifica y prepara borradores. **Autorrepuesta solo en preguntas frecuentes de bajo riesgo, autorizadas por política institucional y respaldadas por contenido aprobado**. Consultas sobre alumnado, reclamaciones o decisiones institucionales siempre pasan a revisión humana. Sin claves o DNS no realizar envíos reales; dejar módulo inactivo y núcleo autónomo operativo.

## Ejecución iterativa obligatoria
- Empieza por **Fase 0** (stack ejecutable + autenticación + permisos + DB + catálogo). Adjunta pruebas y README.
- Continúa con **Fase 1** (PIC completo, validaciones y exportación campo a campo). No pasar a fases posteriores sin pruebas verdes.
- Sigue las fases 2–7 de la especificación en orden, manteniendo la aplicación ejecutable al terminar cada fase.
- Después de cada fase: explica qué código se ha escrito, qué flujos probados funcionan, pruebas realizadas, incidencias reales y próximas tareas. No declarar «completo» por tener una pantalla visual.
- Entrega en cada fase instrucciones reproducibles para instalar y ejecutar en Ubuntu, y actualiza README y migraciones.

## Condiciones de aceptación inicial
Las pruebas `AT-01…AT-52` de la especificación son vinculantes. Presenta resultados verificables, no aseveraciones sin prueba. Las integraciones opcionales con Gmail/Calendar/Drive/Moodle requieren autorización y no bloquean el núcleo autónomo. Interfaz en español de España, menú lateral plegable, panel de pendientes, visual sobrio similar en estructura a un aplicativo de coordinación educativa, sin copiar marca ni código ajeno.

## Primer paso a realizar ahora
Lee el documento y JSON, valida catálogo y límites; genera estructura de repositorio, modelos, migraciones y pantallas del módulo PIC. Comunica cualquier contradicción normativa/documental antes de codificar una regla irreversible. Inicia Fase 0 sin esperar información adicional salvo que sea estrictamente imprescindible.
