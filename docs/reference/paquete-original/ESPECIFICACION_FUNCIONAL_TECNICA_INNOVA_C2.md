# INNOVA-C2
## Documento de especificación funcional, técnica y administrativa para desarrollo en Replit

**Proyecto:** INNOVA-C2 — Plataforma autónoma de gestión de la coordinación de innovación de FP  
**Promotor / centro piloto:** IES Manuel Martín González, Guía de Isora (Tenerife)  
**Proyecto estratégico del centro:** «Innovando en FP»  
**Curso de referencia:** 2026-2027  
**Versión del documento:** 1.1, 17 de octubre de 2026  
**Estado:** Especificación para desarrollo; las decisiones institucionales y accesos externos señalados como pendientes deben confirmarse.  
**Destinatario:** Equipo de programación / agente desarrollador de Replit.

> **REQUISITO CRÍTICO:** INNOVA-C2 no se integra con Laycos, no depende de Laycos para funcionar y no escribe ni lee sus datos automáticamente. Prepara y exporta, con correspondencia exacta al modelo de PIC oficial, la información necesaria para su traslado **manual** a Laycos. Nunca simular una entrega oficial ni marcarla como realizada sin prueba aportada por una persona autorizada.

> **REQUISITO CRÍTICO DE COMUNICACIONES:** Todos los correos salientes propios de INNOVA-C2 se enviarán mediante Resend desde el dominio **`iesmmg.org`**, tras verificarlo y autenticarlo con DNS (SPF, DKIM, política DMARC). El buzón entrante automático se implementará preferentemente sobre el subdominio **`buzon.iesmmg.org`** para no interferir con el MX del dominio raíz. Dirección remitente inicial propuesta `innovacion@iesmmg.org`, Reply-To `innovacion@buzon.iesmmg.org`. Ninguna dirección supone un buzón existente hasta configurar y probar DNS/recepción. En caso de no disponer de Resend, el núcleo administrativo seguirá funcionando y los envíos permanecerán en una cola no despachada.

> **REQUISITO CRÍTICO DE ORGANIZACIÓN:** La coordinación de Innovación C2 asume en el centro la **organización operativa, las convocatorias, la secretaría documental y el seguimiento de la unidad CICLOPE**, dada la necesidad de centralizar la gestión y la disponibilidad limitada de otros participantes. La constitución formal, la participación del equipo directivo y las competencias institucionales se mantienen: el sistema distingue «preparado», «convocado», «celebrado» y «aprobado/validado» y no atribuye una delegación jurídica no acreditada.

---

## 1. Mandato, alcance y criterios de éxito

### 1.1. Problema a resolver
La coordinación C2 dispone de una hora lectiva semanal de coordinación y debe elaborar el PIC, organizar o participar en CICLOPE, asistir a reuniones de red, informar a órganos de coordinación, impulsar actuaciones, recabar resultados de proyectos, preservar evidencias, actualizar indicadores y redactar tres seguimientos y memoria final. Actualmente estos datos se dispersan entre documentos, correo, convocatorias, calendarios, formularios, profesorado y jefaturas. El verdadero cuello de botella es **conseguir información fiable sin multiplicar el trabajo administrativo**.

### 1.2. Finalidad
Construir un sistema web autónomo que sirva de **fuente única de verdad** para el expediente de innovación de cada curso, capte información de manera distribuida y permita a la persona C2 **supervisar excepciones y validar productos** en vez de transcribir documentos. Debe ser útil aunque no haya integración con ningún servicio externo.

### 1.3. Objetivos verificables
- Evitar el registro duplicado: una actuación única alimenta proyectos, evidencias, indicadores, informes y difusión, cuando corresponda.
- Proporcionar la **correspondencia campo a campo** para las secciones 1–14 del modelo PIC 2026-2027.
- Permitir generar el PIC en Word y PDF, fichas de copia por campos para Laycos, seguimientos trimestrales, memoria final, actas, convocatorias, anexos PGA y dossier justificativo.
- Permitir que cualquier docente autorizado aporte una actividad con una descripción o archivo; extraer y proponer su ficha con IA, pero **no darla por validada** sin confirmación procedente.
- Programar, convocar, documentar y seguir las reuniones CICLOPE con mínima intervención de C2.
- Configurar el motor de acciones e indicadores a partir del **catálogo versionado oficial**, con recuentos deterministas y evidencias consultables.
- Permitir operaciones con IA apagada; todos los procesos críticos, cálculos e informes estructurados deben continuar operativos.
- Incorporar centro de comunicaciones bidireccionales usando Resend y el dominio remitente `iesmmg.org`, con buzón entrante independiente, bandeja unificada y respuesta IA restringida a asuntos generales.
- Mantener independencia del hosting de Replit: exportar código, datos y documentación para ejecución en Ubuntu/Proxmox.

### 1.4. Fuera de alcance (expreso)
- Integración, scraping, automatización por navegador o envío automático a **Laycos**.
- Emisión de certificaciones oficiales, retribuciones económicas, firmas electrónicas con presunción oficial o aprobación autónoma de órganos colegiados.
- Sustituir Moodle, SCORM Classroom o un ERP académico; solo gestionar inventario, evidencias y datos agregados autorizados de experiencias.
- Acceso indiscriminado a correo, contenidos del alumnado o documentos de otras coordinaciones.
- Aprobaciones administrativas y convocatorias oficiales sin confirmación y autorización adecuadas. **Solo se permitirá respuesta automática a consultas generales de bajo riesgo y a partir de contenidos aprobados, con políticas por categoría y auditoría** (ver §12.1–12.9); los envíos administrativos y masivos requieren aprobación humana.

### 1.5. Definición de «autónomo»
Autónomo significa: instalación local, base de datos propia, archivo documental propio, autenticación propia, copias/restauración propia, tareas programadas locales, funcionamiento sin Laycos y posibilidad de desactivar todos los conectores. La funcionalidad de IA tendrá **modo local opcional** (por ejemplo, proveedor compatible OpenAI desplegado en red local) y modo desactivado; una API externa de IA será optativa, no un requisito operativo.

---

## 2. Marco oficial y criterios de interpretación

**Documentos proporcionados:** PIC_Innovacion_Centro_26-27.docx; guías C2 de referencia y trabajo; Cuestionario previo C2; cronograma de la Red de Innovación 2026-2027; «Cómo Rellenar Indicadores PIC y PIR»; guía C1 y documentación de contexto; comunicación recibida del coordinador C1.

**Normas citadas por la documentación:** Resolución 5020/2026, de 31 de julio; Resolución conjunta 73/2026, de 27 de mayo (organización y horario); Ley Orgánica 3/2022; RD 659/2023. La aplicación no es un sistema de interpretación jurídica automática. Ante una contradicción entre los datos cargados y una modificación oficial, debe mostrar «Requiere actualización del catálogo», nunca alterar silenciosamente formularios ya presentados.

**Reglas oficiales del PIC 2026-2027:**
- Partes 1–10 del formulario PIC se completan al planificar, **hasta 30/10/2026**; partes 11–14 se habilitan a lo largo del curso.
- DAFO: de una a tres situaciones por cada uno de los cuatro cuadrantes.
- Máximo **seis proyectos declarables en el apartado 4 del PIC**; en el inventario interno se permiten todos los proyectos reales, sin límite artificial. Si hay más de seis, señalar selección oficial pendiente de C2 (jamás omitir silenciosamente).
- Seis objetivos oficiales, al menos una acción seleccionada por objetivo; acciones **1.1** y **1.2** siempre obligatorias.
- Catálogo 2026-2027 transcrito del modelo: **24 acciones oficiales y 31 indicadores oficiales**. Se entrega el JSON versionado junto a este documento; debe validarse al importar con el documento fuente.
- Hasta tres acciones propias adicionales del centro.
- Por cada indicador seleccionado: **meta** y **riesgo** en planificación. El campo **logrado** solo se edita en periodos de seguimiento y memoria; siempre queda historial.
- Unidades: entero/número, porcentaje, sí/no o escala 1–5. Para indicadores numéricos y escala de satisfacción el riesgo no será cero; para booleanos el par meta SÍ / riesgo NO es válido.
- Los recuentos acumulativos no se reinician en cada trimestre; porcentajes y medias indican valor actual y denominador o universo definido.
- CICLOPE: reuniones mínimas de inicio, seguimiento trimestral y cierre (mínimo cuatro); calendario verificable.
- Informes trimestrales y memoria final hasta **18/06/2027**, con incorporación institucional de la memoria.
- Certificación de 40 horas de coordinación C2 condicionada a los requisitos oficiales, incluido 85 % de asistencia, plan/seguimientos/memoria en plazo y solicitud al finalizar. No identificar esas 40 horas como importe económico.

**Reglas a configuración, no código rígido:** curso, fechas, sesiones, documentos oficiales, estados, objetivos, acciones, indicadores, ODS, familias profesionales, cargos CICLOPE, catálogos DAFO, límites administrativos y plantillas. Conservar versiones por curso.

---

## 3. Contexto organizativo del centro piloto

### 3.1. Estructuras
El IES Manuel Martín González mantiene enseñanzas de Formación Profesional en Administración y Gestión, Automoción, Agraria e Imagen Personal, sujetas a confirmación administrativa del curso. La persona C2 de innovación articula el expediente de centro, la coordinación con las distintas familias y la relación con C1 de la red; también asume de manera operativa la organización de la unidad CICLOPE.

### 3.2. Coordinación externa C1
Según la convocatoria facilitada: **Aurelio Fernández**, CIFP Gran Sur (CIFP en Adeje), reunión telemática de coordinaciones C2 el **miércoles 21/10/2026 a las 11:15**, duración estimada de 60 minutos. Se registra como cita recibida, con fecha, remitente y URL de Meet aportada por la persona usuaria, sin afirmar asistencia. El sistema conserva preguntas abiertas: cuestionario previo de diagnóstico, situación de CICLOPE, acceso con cuenta corporativa y confirmación del C2 de cada centro. La fecha del PIC permanece fijada al 30/10/2026. Contraseñas compartidas en correos **NO** se incluyen en semillas, registros de demostración, repositorios ni documentación entregable.

### 3.3. Activos permanentes de innovación
- **Aula ATECA:** espacio con actividades y recursos tecnológicos de aplicación didáctica.
- **FABLab:** laboratorio permanente de diseño, prototipado y fabricación de modelos mediante impresoras 3D, operativo durante el curso y accesible a **todas las familias profesionales**. No equiparar ni fundir FABLab con ATECA; una actividad puede usar ambos y debe contabilizarse una vez como actuación, aunque contribuya a distintos indicadores justificables.
- **Proyecto transversal «Innovando en FP»:** iniciativa de centro de desarrollo de software de uso administrativo y educativo. Productos relacionados, con ficha y estado propios: **INNOVA-C2**, aplicación de Coordinación de Familias Profesionales (CoordinacionFP) y **SafeExit**, así como otras aplicaciones o módulos que se documenten. Su existencia como proyectos/productos no demuestra por sí sola implantación ni aprobación oficial.
- **FP Inteligente:** línea de experiencias SCORM, sistemas de evaluación formativa/competencial, simuladores, IA y digitalización curricular. Catálogo separable por módulo y familia, con distribución a través de la Coordinación de Administración y Gestión de Canarias cuando se autorice.

### 3.4. Autoridad en CICLOPE
La persona C2 será la **gestora operativa de CICLOPE** en el aplicativo: prepara calendario, convoca por canales autorizados, solicita puntos, compone orden del día, registra reuniones, propone actas, gestiona acuerdos y hace seguimiento. El equipo directivo participa y conserva las atribuciones institucionales; el sistema permite configurar responsable de convocatoria formal, persona que preside, secretario/a, participantes y validadores sin presuponer identidad entre ellos. Si una atribución requiere autorización interna no acreditada, se muestra estado **pendiente de autorización**. El producto no debe describir automáticamente «C1 del centro» a las coordinaciones de otras redes: C1 se refiere a coordinación de una red de centros, mientras las personas coordinadoras internas intervienen en CICLOPE en su función respectiva.

---

## 4. Principios UX y experiencia de usuario

- Referencia visual: una interfaz administrativa parecida, en simplicidad y arquitectura de navegación, a la aplicación de Coordinación de Familias Profesionales; no copiar código ni marca sin autorización. Barra superior compacta, menú lateral plegable, buscador global, tarjeta de centro/curso, indicadores y bandeja única de trabajo.
- Máximo tres acciones visibles en el panel de «Lo que tengo que hacer»: **revisar, validar y resolver excepción**. El resto debe ser automático o estar asignado al responsable de origen.
- Panel de responsable de departamento simplificado: «Mis actuaciones / Pendientes de confirmar / Aportar documento». Evitar mostrarle toda la estructura PIC.
- Móvil: carga de una foto/documento o dictado breve y validación de los datos extraídos.
- Mostrar siempre la fuente y grado de confianza: **confirmado**, **propuesto por IA**, **sin información**, **no realizado**, **pendiente de validación**. Prohibido sustituir «sin información» por «NO».
- Accesibilidad objetivo **WCAG 2.2 AA**: contraste, teclado, etiquetas de campo, errores legibles, no usar color como única señal y diseño responsivo.
- Lenguaje formal de administración educativa en castellano de España; fechas europeas y zona `Atlantic/Canary`.
- Información del curso anterior utilizable solo como antecedente; no arrastrar «logrado» de otro curso.

### 4.1. Pantallas mínimas
1. Acceso, configuración inicial y selección de curso.
2. Panel C2: plazos, incidencias, métricas y validaciones.
3. Centro, familias, personas, roles y nombramientos.
4. Diagnóstico y cuestionario previo con DAFO.
5. Editor del PIC organizado en catorce apartados, con validaciones y vista Laycos «campo a campo».
6. Catálogo de proyectos, líneas, aplicaciones/productos y actuaciones.
7. Ficha de actuación de dos modos: rápida / completa (mostrar solo campos necesarios).
8. Centro documental y bandeja de archivos entrantes.
9. ATECA y FABLab: recursos, reservas/uso documentado y actuaciones.
10. CICLOPE: calendario, participantes, convocatorias, orden del día, reuniones, acuerdos y actas.
11. Reuniones de red C1: convocatorias recibidas, asistencia y acuerdos.
12. Indicadores: meta, riesgo, logrado, evidencia y evolución.
13. Formación, colaboradores y participación.
14. Difusión interior, coordinación de familia profesional y transferencia externa.
15. Asistente de IA y preparación de documentos.
16. Seguimientos y memoria final; exportaciones con estado de validación.
17. Administración: auditoría, permisos, copias, restauración, tareas programadas, importación de catálogo.

---

## 5. Roles, autorización y segregación de responsabilidades

| Rol | Lectura | Escritura y aprobación |
|---|---|---|
| Administrador técnico | Configuración técnica y logs, con acceso documental restringido por principio de mínimo privilegio | Usuarios, respaldos, ajustes técnicos; NO aprueba PIC ni evidencia pedagógica |
| C2 de Innovación | Expediente completo del centro, salvo contenido reservado ajeno a finalidad | Plan PIC, validación de actuaciones, convocatorias operativas CICLOPE, informes, difusión propuesta y expediente de certificación |
| Equipo directivo / validador institucional | Plan, actas y resúmenes pertinentes | Validación institucional de PGA/Claustro y actas/acuerdos que correspondan |
| Coordinación de otra red / participante CICLOPE | Actuaciones transversales y reuniones autorizadas | Puntos del orden del día, propuestas, acuerdos y aportaciones |
| Jefatura de departamento | Registros y evidencias de su familia profesional | Confirmación de actividades y datos que le correspondan |
| Profesorado participante | Sus actuaciones y recursos compartidos | Comunicación sencilla de actividades y evidencias propias |
| Consulta C1 externa | Resúmenes compartidos por C2 | Confirmación de recepción; sin acceso indiscriminado al expediente interno |
| Consulta auditora | Informes aprobados y trazas pertinentes | Solo lectura, autorización temporal |

**Reglas:** RBAC con permisos granulares por entidad, ámbito y acción. «Administrador técnico» no equivale a «coordinador». Invitaciones con vencimiento y revocación. No crear ni enviar usuarios masivamente sin control. Acceso externo y vínculos públicos deshabilitados de forma predeterminada.

---

## 6. Modelo funcional: expedientes, fuentes y trazabilidad

### 6.1. Entidades de datos
Crear como mínimo: `users`, `roles`, `permissions`, `centers`, `school_years`, `professional_families`, `departments`, `assignments`, `people`, `c1_networks`, `projects`, `products`, `activities`, `activity_people`, `spaces`, `space_uses`, `documents`, `document_versions`, `evidences`, `evidence_links`, `pic_templates`, `pic_plans`, `pic_dafo`, `pic_actions`, `pic_custom_actions`, `pic_indicators`, `indicator_observations`, `indicator_snapshots`, `pic_ods`, `meetings`, `meeting_participants`, `agendas`, `minutes`, `agreements`, `agreement_tasks`, `communications`, `publication_events`, `information_requests`, `information_responses`, `reminders`, `submission_records`, `report_drafts`, `approvals`, `ai_jobs`, `audit_logs`, `backups` y `settings`.

### 6.2. Reglas de integridad
- Todas las entidades de gestión ligadas a centro y curso y, cuando corresponda, a proyecto/actuación/familia.
- UUID o ULID como claves internas; código oficial de acciones e indicadores **distinto** del ID interno.
- Restricciones únicas y comprobación de duplicados por combinación de evento, fecha, responsable, fuente y huella del documento.
- Una actuación real puede vincularse a varias acciones oficiales **sin convertirse en varias actuaciones**; el indicador define sus reglas independientes de recuento.
- `source_id`, archivo de origen, autor de dato, momento de captura, fecha de validación y responsable que validó son obligatorios para datos que influyan en «LOGRADO».
- Ediciones históricas mediante versionado y registro de cambios. Documentos con huella SHA-256, soporte de múltiples versiones y retención configurable.
- Estados de actividad: `detectada`, `informacion_incompleta`, `pendiente_responsable`, `pendiente_c2`, `validada`, `en_ejecucion`, `finalizada`, `descartada`. Estados de información: `confirmada`, `propuesta_ia`, `sin_datos`, `no_realizada`, `en_revision`.
- Proyectos internos **ilimitados**; solo máximo seis en lista oficial de apartado 4, con elección explícita de proyectos declarados y otros agregados como datos internos.
- «Innovando en FP» como proyecto paraguas con productos independientes: INNOVA-C2, CoordinacionFP, SafeExit. «FP Inteligente» como línea distinta y vinculable.
- ATECA y FABLab como dos espacios permanentes diferentes; mismo evento puede referenciar ambos; métricas de ocupación, grupo, familia y actividad separables.

### 6.3. Ejemplos de modelos mínimos (no migraciones completas)
`Activity(id, center_id, year_id, title, date_start, family_ids[], project_id, responsible_id, status, evidence_ids[], source_ids[], official_action_codes[], validated_by, validated_at)`.
`IndicatorDefinition(code, action_code, version, label, unit, aggregation, normative_minimum, evidence_policy)`.
`IndicatorObservation(id, plan_id, indicator_code, period, value, numerator, denominator, method_version, calculated_at, evidence_ids[], status)`.
`Meeting(id, meeting_type, center_id, year_id, scheduled_at, convener_id, formal_authorizer_id?, agenda_status, attendance_status, minutes_status, approval_status)`.
`InformationRequest(id, recipient_id, subject_type, subject_id, requested_fields[], reason, due_at, reminder_policy, status, response_id?)`.

---

## 7. Recogida distribuida y autónoma de información

### 7.1. Problema principal
Las jefaturas y el profesorado tienen poca disponibilidad. Si el software exige rellenar informes para que el C2 pueda elaborar los suyos, aumenta el trabajo en vez de reducirlo. La solución es un sistema de **captura progresiva y solicitudes mínimas**.

### 7.2. Circuito de una actuación
1. Entrada a través de subida web, enlace QR interno, documento recibido, registro de espacio o fuente conectada autorizada.
2. Extracción local de texto/metadatos cuando sea posible; IA opcional propone categoría, fecha, descripción, familias, proyecto y acciones relacionadas.
3. Detección de duplicados: «¿Esta actividad ya existe?», fusionar sin pérdida de fuentes.
4. Campos confirmados se incorporan directamente; únicamente los faltantes esenciales originan una microconsulta al responsable original, preferentemente una sola vez.
5. Responsable confirma o corrige, con registro de autoría y fecha.
6. C2 recibe únicamente registros de impacto administrativo, inconsistentes, conflictivos o pendientes de su conformidad.
7. Indicadores, informes y memoria consumen el mismo registro validado y sus evidencias.

### 7.3. Microconsultas
- Solicitar **solo el dato que falta**: «¿Cuántos grupos participaron?»; respuesta de 1–2 clics o adjunto.
- Aplicar deduplicación de preguntas por persona/proyecto: no volver a pedir una información ya facilitada.
- Canal interno como base; avisos por correo optativo con control de frecuencia, no obligatorio para funcionar.
- Estado por dato: no solicitada / solicitada / respuesta recibida / validada / imposible de obtener.
- A partir de plazo y criticidad, remitir recordatorio al responsable; C2 solo recibe bloqueos persistentes y cuestiones de decisión.
- Permitir «No dispongo de información» y «No se realizó» como respuestas distintas.
- Formulario rápido para profesorado: nombre de actividad, qué se hizo, fecha aproximada y evidencia; completar por IA sin exigir nomenclatura del PIC.

### 7.4. Ingesta documental
DOCX, PDF, ODT, XLSX, CSV, TXT, imágenes PNG/JPG y ZIP de recursos didácticos, con restricciones de tamaño y análisis antivirus; evitar ejecutar contenido de archivos. La extracción de imágenes/OCR debe ser optativa y respetar disponibilidad del motor local. Documentos institucionales y proyectos pueden cargarse inicialmente en bloque. Se debe mostrar qué se ha extraído y cuál es la fuente exacta, no afirmar lectura si no pudo extraerse información.

---

## 8. Editor de planificación oficial PIC / correspondencia Laycos

### 8.1. Datos de entrada
Datos del C2, centro, niveles, grupos, cuestionario previo; DAFO, proyectos (6 declarables), aula ATECA, objetivos/acciones/indicadores, ODS y ODS canarios, composición CICLOPE, calendario y canales de difusión. Configuración de catálogo desde `config/pic_2026_2027_catalogo.json`, que conserva títulos y opciones originales del formulario.

### 8.2. Verificaciones obligatorias
- Antes de cerrar: cada cuadrante DAFO entre 1 y 3 situaciones; mínimo una acción seleccionada para cada objetivo; 1.1 y 1.2 seleccionadas; máximo tres acciones propias; todas las metas y riesgos presentes para **todos** los indicadores de acciones seleccionadas; valores con unidad correcta; riesgo numérico no cero (excepción booleana indicada); limitación de seis proyectos declarables; reuniones CICLOPE programadas; información de difusión y demás campos obligatorios del modelo.
- No cerrar si hay discrepancia entre valor alcanzado y origen de datos sin revisión.
- Distinguir «formulario internamente completo» de «presentado en Laycos».
- Firma o validación en aplicación implica revisión interna, **no firma electrónica oficial**.

### 8.3. Flujo de presentación manual
1. Generar **ficha Laycos por apartados 1–10** en el mismo orden del formulario; cada campo con etiqueta exacta, valor, botón «Copiar», indicador de certeza y origen.
2. Exportación Word/PDF, copia por bloques, JSON/CSV estructurado. No inventar un fichero que Laycos acepte sin evidencia.
3. Usuario autorizado presenta **manualmente** en Laycos.
4. Al regresar, registra fecha de presentación, identificador si existe y prueba documental (captura/acuse/justificante); estado «presentado» solo si lo confirma.
5. Conserva instantánea inmutable de lo presentado y diferencias entre «PIC inicialmente presentado» y «PIC actualizado».
6. En seguimientos aplica la misma lógica a secciones 11–13; memoria a sección 14; indicar cuándo se detectan cambios que requieren trasladarse manualmente a Laycos.

### 8.4. Versionado de la planificación
Una modificación posterior afecta al plan en vigor, no reescribe la copia histórica de octubre. Registrar autor, fecha, motivos, metas previas/nuevas y si el cambio se ha comunicado al C1 o trasladado a Laycos. Una actualización automática nunca debe marcar «publicada oficialmente» por sí sola.

---

## 9. Motor determinista de indicadores

Para cada indicador: `id` oficial, unidad, meta, riesgo, fecha y autor, procedimiento de cálculo, filtros de elegibilidad, valor acumulado o instantáneo, fuentes, validaciones y trazabilidad de cambios.

**Cálculos:**
- Recuento: número de entidades **únicas** elegibles y validadas.
- Porcentaje: numerador/denominador identificados y versionados, sin sumar porcentajes de trimestres.
- Sí/No: constancia documental, no deducir «SÍ» de un evento programado.
- Escala 1–5: media de respuestas válidas, indicación de tamaño muestral y redondeo a un decimal.
- Histórico: «LOGRADO» de cada trimestre como fotografía y valor vigente en la ficha oficial.
- Interpretación: logrado si valor >= meta, parcial cuando está entre riesgo y meta, no logrado cuando está por debajo de riesgo; reglas explícitas para booleanos y metas coincidentes con el riesgo.
- Correcciones retroactivas generan nueva versión y recalculan vistas sin borrar historiales.

**Mecanismos contra errores:** si un indicador requiere 4 reuniones, no permitir establecer 3 como meta, mostrar mínimo normativo; no computar automáticamente como «docente formado» a quien solo recibió una convocatoria; no confundir personas únicas y asistencias; no contar recursos borrador como recursos incorporados al repositorio; no confundir software «en desarrollo» con «implantado».

---

## 10. CICLOPE: módulo de secretaría, coordinación y convocatorias

### 10.1. Organización asignada
La persona C2 de Innovación operará el módulo de CICLOPE y convocará las sesiones **operativamente**, con visibilidad para el equipo directivo y para las coordinaciones de redes/FP Dual. Puede preparar y emitir las convocatorias a través de un canal institucional autorizado, con confirmación si la convocatoria requiere refrendo por dirección. No se asumirá automáticamente que las coordinaciones ajenas a Innovación son «C1 del centro».

### 10.2. Reuniones y documentos
- Registro de composición: personas, rol formal, familia profesional, correo corporativo, fecha de nombramiento/participación.
- Calendario de al menos cuatro sesiones planificadas para el año (inicio, seguimiento 1, seguimiento 2, cierre), adaptable según acuerdos.
- Preparar propuestas de fechas y comprobar solapamientos en calendario interno; integración opcional con calendario corporativo **solo autorizada**.
- Convocatoria con fecha/hora, enlace o lugar, objeto, documentación adjunta, destinatarios; previsualización y aprobación antes de envío.
- Orden del día basado en acuerdos pendientes, seguimiento de acciones PIC y aportaciones recibidas de participantes.
- Acta en borrador de IA basada en notas autorizadas, con apartados: convocatoria, asistentes, orden del día, desarrollo, acuerdos, responsables, plazos e incidencias; aprobación humana.
- Acuerdos como tareas con vencimiento y estado; recordatorios a responsables según preferencia, sin atribuir automáticamente funciones docentes.
- Documentos generados en DOCX y PDF y conservados versionados.
- Diferenciar `programada` / `convocada` / `celebrada` / `acta_borrador` / `acta_validada`.
- Reuniones C1-C2 separadas: convocatorias recibidas del CIFP, asistencia personal C2, acuerdos y comunicaciones a familias.

### 10.3. Registro inicial facilitado
Crear como **dato de ejemplo de configuración institucional (no ficticio)** la reunión externa del 21/10/2026 con C1 Aurelio Fernández, CIFP Gran Sur, inicio 11:15 y duración estimada 60 min. URL de Meet configurable en el expediente de usuario, no incluida como secreto o credencial en repositorios públicos. Los estados «asistencia», «confirmación de acceso Laycos», «cuestionario previo» y «CICLOPE constituida» arrancan en **pendiente de verificar**.

---

## 11. ATECA, FABLab, SCORM y proyecto «Innovando en FP»

### 11.1. Gestión de espacios y equipamientos
ATECA y FABLab tienen fichas independientes con tipo, finalidad, horario de referencia, personas responsables, recursos y servicios ofrecidos. FABLab está disponible durante todo el curso para todas las familias profesionales. Se registran talleres, uso de impresoras 3D, elaboración de modelos, prototipos y aplicaciones didácticas. No exigir inventario exhaustivo de consumibles ni mantenimiento si no sirve al PIC; una reserva de espacio no basta como evidencia de actividad realizada. Una actuación puede usar ambos espacios sin duplicarse.

### 11.2. Catálogo de software y productos propios
«Innovando en FP» se configura como proyecto transversal de desarrollo de software administrativo y educativo. **INNOVA-C2, CoordinacionFP y SafeExit** son productos con ficha individual: finalidad, destinatarios, módulos, responsable, repositorio opcional, fecha de inicio, versión, hitos, pruebas, estado (`idea`, `analisis`, `desarrollo`, `pruebas`, `piloto`, `implantado`, `mantenimiento`), centro de implantación, evidencias y resultados. Las versiones, tickets, capturas y manuales se vinculan con su proyecto padre.

No declarar resultados, aprobación oficial, seguridad verificada ni implantación sin evidencias y fecha confirmadas. El software también debe **autoregistrar sus propias entregas, versiones y pruebas como datos del proyecto**, sin contar el acto de programar como innovación implantada automáticamente.

### 11.3. SCORM e inteligencia artificial educativa
Registrar paquetes y herramientas con módulo profesional, familia, versión, RA/criterios, docente responsable, plataforma de implantación, estado, pruebas, disponibilidad, alumnos/grupos agregados, informes de impacto y material compartible. Puede vincularse a «FP Inteligente» y a «Innovando en FP» mediante relaciones explícitas si hay desarrollo de software. No asumir acceso directo a notas, datos personales ni calificaciones desde Moodle/SCORM Classroom: integración únicamente opcional y autorizada.

### 11.4. Transferencia y difusión por coordinación autonómica de familia profesional
Para Administración y Gestión: selección de recursos aptos para compartir, ficha didáctica, documentación técnica, paquete revisado, autorización de difusión, destinatarios y canal de envío, fecha, publicaciones, respuestas recibidas, centros interesados y centros con piloto **confirmado**. Diferenciar «compartido» de «instalado» y de «usado». Elaborar borradores de correos y presentaciones para la Coordinación de la Familia Profesional de Administración y Gestión de Canarias y resúmenes para C1; ejecutar los envíos autorizados a través del **Centro de Comunicaciones Resend** desde `iesmmg.org`.

---

## 12. Comunicación, actas y documentos oficiales

**Tipos de documentos generables:** PIC completo; ficha campo a campo para Laycos; anexo para PGA; presentación para Claustro; diagnósticos DAFO; órdenes del día; convocatorias; actas CICLOPE; informe a CCP/ETA; notas al C1; resumen de proyectos por familia; fichas de proyectos; informes de evaluación de impacto; seguimiento 1/2/3; memoria final; expediente de certificación; fichas de divulgación; dossier de transferencia SCORM/IA/FABLab/Innovando en FP.

**Plantillas:** DOCX administrables por perfil autorizado, marca de versión y campos enlazados a datos. Vista previa siempre; exportación PDF, DOCX y Markdown; archivos CSV/JSON cuando corresponda. Cada documento generado incorpora estado (borrador, revisado, aprobado, enviado/presentado manualmente) y enlaces a evidencias en el expediente; no incluir públicamente información reservada ni enlaces que requieran credenciales.

**Comunicación:** módulo bidireccional principal basado en **Resend**; correo saliente con `iesmmg.org`, recepción mediante buzón específico y webhooks, mensajes ordenados en conversaciones, segmentación, permisos, aprobaciones, trazabilidad, adjuntos y respuestas asistidas por IA. No afirmar envío, entrega, lectura o respuesta si no existe evento real. El núcleo de INNOVA-C2 no depende de Resend para continuar operativo; el canal queda en modo cola/borrador cuando Resend no está configurado o disponible.


### 12.1. Dominio, remitentes e infraestructura de correo (decisión del promotor)
**Dominio de envío establecido:** `iesmmg.org`. **Proveedor de envío y recepción:** Resend. No utilizar ni suplantar direcciones `@canariaseducacion.es` o `@gobiernodecanarias.org`; estas son direcciones de destinatarios y remitentes externos habituales. La comunicación con estos dominios se realizará como correo electrónico ordinario con entrega supeditada a las políticas de sus servidores.

**Identidades sugeridas, configurables y sujetas a alta/verificación:**

| Propósito | From propuesto | Reply-To propuesto |
|---|---|---|
| Coordinación de innovación | `innovacion@iesmmg.org` | `innovacion@buzon.iesmmg.org` |
| Convocatorias CICLOPE | `ciclope@iesmmg.org` | `innovacion@buzon.iesmmg.org` |
| Proyectos y transferencia | `proyectos@iesmmg.org` | `innovacion@buzon.iesmmg.org` |

**Diseño DNS:** registrar y verificar `iesmmg.org` para envío con los registros exactos que Resend muestre en la consola del equipo autorizado (DKIM y SPF/return-path específicos); comprobar política DMARC, sin sobrescribir registros existentes. Para recibir, utilizar **`buzon.iesmmg.org` con su MX de recepción indicado por Resend**, evitando modificar los MX preexistentes de `iesmmg.org`. Los registros de envío y recepción son independientes; no confundir el MX de *return-path* de envío con el MX de recepción de correspondencia. Si ya existe un buzón `innovacion@iesmmg.org` gestionado por otro proveedor y se desea que las respuestas lleguen allí, es necesaria una regla de reenvío/autorización; por defecto el Reply-To será el subdominio dedicado. Comprobar SPF, DKIM, alineación DMARC, dominio verificado y entrega a `@canariaseducacion.es` en una prueba controlada.

El dominio solo queda operativo tras prueba real de DNS, envío a una dirección de prueba, llegada a la bandeja, respuesta, webhook y procesamiento. **No inventar registros DNS ni alterar configuraciones existentes sin revisión previa.**

### 12.2. Bandeja única y conversaciones
- Carpetas/vistas: Entrada, Pendientes de IA, Revisión humana, Respondidas, Enviadas, Borradores, Programadas, Fallidas/rebotadas, Archivadas y Spam/Seguridad.
- Conversación por `Message-ID`, `In-Reply-To`, `References` y token correlativo firmado, sin confiar exclusivamente en asunto y nombre del remitente; conservación de histórico de respuestas y adjuntos con controles de acceso.
- Dirección real `From`, `To`, `CC`, `Reply-To`, identificador del proveedor, evento de recepción/entrega, sellos de tiempo, estado, familia profesional, proyecto, actuación PIC, convocatoria CICLOPE, tema, prioridad, responsable, historial de autorización y fuentes.
- Indexación de contactos y entidades con deduplicación de direcciones, segmentación por rol (dirección, jefaturas, profesorado, alumnado cuando autorizado, familias, empresa, coordinación C1, centros y coordinación de familia), opt-out para mensajes no obligatorios y grupos dinámicos verificables.
- Bandeja compartida con asignación de responsables y visibilidad por permisos, filtros y búsqueda; no existe bandeja indiscriminada para todos los usuarios.

### 12.3. Emisión y convocatorias
- Plantillas de convocatoria, orden del día, solicitud mínima de datos, recordatorio de plazo, acuse de recepción, difusión de SCORM/IA/FABLab y comunicación institucional; cada tipo con política de autorización.
- Envío individual/por lotes con vista previa, prueba a remitente autorizado, lista destinatarios revisable, exclusión de contactos inactivos y freno de envío masivo accidental. Para correos con múltiples destinatarios externos, BCC o envíos individualizados para evitar exposición de listas.
- Resend devuelve identificador de envío y eventos diferenciados (aceptado, entregado si proveedor lo reporta, rebotado, reclamación o fallo); una operación 'aceptada' NO equivale a leída ni atendida. Reintentos con backoff y clave de idempotencia para no generar correos duplicados.
- Cabeceras y marcas de clasificación de mensajes internos/externos sin sustituir la documentación oficial. Conservar copia de versión enviada, aprobador, destinatarios y eventos técnicos.

### 12.4. Recepción por webhook
- Endpoint público exclusivo `POST /api/v1/webhooks/resend`, sobre HTTPS, con **verificación criptográfica de la firma del webhook** usando librería y secretos indicados por Resend, límite de tamaño, protección contra reintento/replay e idempotencia sobre `email_id` + identificador de evento.
- Ante `email.received`, guardar metadatos y obtener cuerpo/adjuntos por la API de Resend desde un *worker* tras confirmar recepción del webhook. No registrar contenido sensible en logs y no cargar archivos no comprobados en rutas públicas.
- Escaneo y limitación de adjuntos (tipo, tamaño y malware), saneado de HTML, eliminación o aislamiento de contenido activo, cuarentena y revisión de remitentes sospechosos. Tratar cuerpo/adjuntos como **datos no confiables**, nunca instrucciones para IA, herramientas o sistema.
- Reconciliación periódica con API del proveedor para webhooks fallidos y bandeja de fallos reintentables. Registrar eventos de rebote, supresión y errores para no repetir envíos.

### 12.5. Procesamiento asistido por IA y política de respuesta
**Canalización:** recibido → clasificación por tema/urgencia → vinculación a expediente → recuperación de información autorizada → propuesta de respuesta con citas internas → evaluación de políticas → envío automático restringido o cola de revisión humana.

**ÚNICOS candidatos a respuesta automática**, y solo cuando exista política institucional explícitamente habilitada, información vigente **aprobada y suficiente** y no haya datos personales sensibles: preguntas frecuentes sobre funcionamiento general del proyecto, acceso público a recursos, fechas oficiales ya verificadas, instrucciones genéricas de participación, material formativo aprobado, acuse de recepción **sin compromisos administrativos**. El grado de confianza de un modelo por sí solo NO habilita el envío.

**Siempre requieren revisión humana:** incidencias, conflictos, reclamaciones, alegaciones, solicitudes de datos personales, salud, situaciones individuales del alumnado, evaluaciones y calificaciones, empleo y nombramientos, compromisos institucionales, acuerdos, financiación o pagos, cuestiones jurídicas, cambios de reunión no confirmados, datos protegidos, remitentes ambiguos y cualquier mensaje con adjuntos no verificados. En duda: no enviar, etiquetar «revisión humana».

**Reglas de automatismo:** no enviar en nombre de una persona física ni firmar acuerdos automáticamente; solo alias funcional autorizado; límites diarios y por remitente; si ya existe respuesta humana en conversación, bloquear automatización; política antibucles autorespuesta, horarios opcionales y botón general «desactivar respuestas automáticas» independiente de envío manual. Registro de fuente utilizada, regla que permitió el envío, versión de modelo/prompt y copia exacta de respuesta.

### 12.6. Obtención de información para PIC sin aumentar carga
- La IA detecta del correo información potencialmente útil: responsable de actividad, fecha, destinatarios, evidencia, proyecto, familia, necesidades o acuerdo; genera **propuesta de ficha**, nunca una actuación validada automáticamente por el simple hecho de aparecer en correo.
- Si falta un dato indispensable, el sistema prepara una solicitud breve al responsable real, evitando preguntas repetidas y recuperando el hilo previo. Agrupar solicitudes por persona; no remitir recordatorios en exceso.
- Un mensaje puede alimentar expediente, catálogo, indicador y borrador trimestral mediante vínculos a **un único registro origen**. Respuesta email no implica conformidad ni asistencia.
- Si el C2 aprueba extraer una evidencia, marcar procedencia e incorporar al expediente con política de conservación y restricciones de acceso.

### 12.7. Diseño de permisos, privacidad y cumplimiento
- El responsable institucional determinará finalidad, base jurídica, información a usuarios, conservación, encargos de tratamiento y condiciones de transferencia internacional antes de activar el envío de datos personales con Resend o IA externa. Revisar con DPD del centro/administración.
- Restringir campañas a destinatarios relevantes; mantener categorías separadas (comunicación organizativa, informativa, marketing/no obligatorio si existiera) y tratamiento separado de exclusiones y bajas cuando procedan. Evitar usar el módulo para enviar mensajes masivos a familias o menores ajenos al proyecto sin habilitación institucional expresa.
- Acceso por rol: C2 y perfiles delegados a comunicación, jefaturas solo sus hilos autorizados, equipo directivo en asuntos institucionales, docente solo asuntos propios. Auditoría de lecturas de mensajes sensibles y todas las respuestas.

### 12.8. Configuración y variables de entorno, no credenciales
Ejemplo exclusivamente referencial para archivo `.env.example` (ningún token real):

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

`EMAIL_ENABLED=false` por defecto, hasta configurar DNS, secretos, autorización y pruebas reales. El despliegue local puede seguir creando borradores y generando informes sin Resend; la recepción y el envío automáticos requieren acceso externo a la API de Resend y un webhook accesible desde Internet (por ejemplo, a través del túnel existente configurado por infraestructura).

### 12.9. Pruebas funcionales adicionales de comunicaciones (AT-41 a AT-52)
- **AT-41:** verifica dominio `iesmmg.org` antes de habilitar el remitente; errores DNS visibles sin alterar MX raíz.
- **AT-42:** envía un mensaje real de prueba de `innovacion@iesmmg.org` a destinatario autorizado; guarda ID del proveedor y estado real.
- **AT-43:** recibe una respuesta de un buzón `@canariaseducacion.es` dirigida al `Reply-To`, la presenta en el hilo correcto y conserva metadatos.
- **AT-44:** Resend recibidor utiliza MX de `buzon.iesmmg.org` y no cambia la recepción de `iesmmg.org`.
- **AT-45:** webhook con firma inválida es rechazado; webhook duplicado no crea mensajes duplicados.
- **AT-46:** correo con adjunto se somete a control de permisos, tamaño, saneado y aislamiento antes de procesarlo.
- **AT-47:** un correo de consulta frecuente con base documental aprobada recibe respuesta automática **solo si política explícita habilitada**.
- **AT-48:** consulta sobre un alumno, reclamación o compromiso del centro nunca se autoresponde; se asigna a revisión humana.
- **AT-49:** respuesta de IA carece de fuente suficiente → no envía y muestra «no hay información validada».
- **AT-50:** rebote, error de envío o desconexión de Resend no marca destinatario informado ni bloquea la gestión local.
- **AT-51:** sin Resend y sin IA, el programa crea borradores, procesa registros internos y mantiene PIC/seguimientos disponibles.
- **AT-52:** un correo vinculado a una actuación existente no duplica dicha actuación ni sus indicadores al recibir respuestas adicionales.

**Fuentes técnicas recomendadas:** `https://resend.com/features/inbound`, `https://resend.com/blog/inbound-emails`, `https://resend.com/migrate/mailchimp`, documentación vigente de Resend sobre verificación de dominios, webhooks y autenticación. Revisar esquema y nombres de eventos en SDK/API actualizado antes de implementación.

---

## 13. IA: arquitectura opcional, segura y verificable

**Patrón:** capa `AIProvider` desacoplada que admite `disabled`, `local` (endpoint en la infraestructura del centro) y `external_authorized` (API externa bajo contrato y decisión del responsable). Ninguna operación administrativa indispensable depende de la disponibilidad del proveedor de IA.

**Casos de uso:** propuesta de extracción documental; clasificación de actividad; hipótesis DAFO; redacción de actas a partir de notas; resúmenes para C1, CCP y Claustro; preparación de PIC/memoria; propuestas de comunicación; preguntas sobre el expediente con recuperación de fuentes (`RAG`) y respuesta trazable.

**Controles obligatorios:**
- Texto generado **borrador** hasta aprobación. La IA no modifica fechas/actas/indicadores validados sin operación explícita.
- Nunca marcar asistencia, constitución de CICLOPE, proyecto implantado, envío de correo o entrega Laycos por inferencia.
- Prompts de documentos y transcripciones tratados como datos no confiables; instrucciones incrustadas en fuentes no se ejecutan (defensa frente a prompt injection).
- Mostrar citas internas a `document_id/page/fragment` o `activity_id` por cada afirmación factual administrativa; si faltan pruebas, respuesta «No consta».
- Registro de petición/resultado con minimización; política clara de retención y ausencia de secretos en logs.
- Control de costes y cuota por centro, con alternativa sin IA y reintentos limitados; pruebas con proveedor simulado.
- Revisar RGPD, evaluación de impacto si corresponde y procedimientos del responsable y DPD antes de procesar información sensible o emplear servicios externos.

---

## 14. Seguridad, gestión documental y soberanía tecnológica

- Inicio de sesión local, recuperación segura, contraseñas con algoritmo actual (Argon2id), MFA opcional para perfiles con aprobación, bloqueo por intentos y sesión con caducidad.
- Autorización en servidor para cada entidad y archivo; protección frente a acceso horizontal entre personas/familias/centros.
- HTTPS obligatorio en producción detrás de proxy inverso; cookies Secure/HttpOnly/SameSite; validación y saneamiento de subida de ficheros; protección CSRF y XSS.
- Backups automáticos cifrados de PostgreSQL + repositorio documental; retención configurable y **restauración probada**.
- Auditoría de accesos y cambios en PIC, evidencias, indicadores, actas, usuarios y aprobación.
- Eliminación lógica controlada de registros con incidencia en informes; archivo irreversible bajo política de retención; exportación/portabilidad sin dependencia del proveedor de hosting.
- Evitar que el usuario distribuya contraseñas o enlaces privados en material público. Separar secretos en variables de entorno, nunca en repositorio.
- Migraciones versionadas, semillas de catálogos, versiones de plantillas y procedimientos de recuperación ante fallo de despliegue.

---

## 15. Arquitectura e instalación solicitadas a Replit

### 15.1. Stack de referencia
**Propuesta técnica por defecto:** React + TypeScript + Vite para interfaz; Python FastAPI para API y tareas asíncronas; PostgreSQL 16+; almacenamiento local privado mediante volumen persistente; LibreOffice headless para DOCX→PDF si está instalado en servicio aislado; Redis/RQ o scheduler persistente para tareas; contenedores Docker Compose para desarrollo y despliegue. Replit puede proponer alternativa equivalente **documentando motivos, impactos y compatibilidad de instalación**, pero no cambiar un requisito funcional.

El backend debe contener la lógica real de indicadores y flujos; no generar una maqueta con métricas codificadas ni requerir servicios exclusivos de Replit. Estándares: tipado, validación de schemas, documentación OpenAPI, controles de errores y pruebas automatizadas.

### 15.2. Despliegue en infraestructura del centro
Destino: Ubuntu en contenedor o máquina de Proxmox, inicialmente sin dependencias, con Cloudflare Tunnel gestionado **en un contenedor distinto**, sin imponer su instalación en el aplicativo. Entregar `install.sh` para instalación asistida o desatendida en Ubuntu compatible, un `docker-compose.yml` de producción, `env.example`, `README.md`, comandos de mantenimiento, certificados/proxy documentados y scripts de backup/restore. No asumir `curl` ni `git` preinstalados: bootstrap detecta gestor de paquetes e instala prerrequisitos previa comprobación de permisos y versión Ubuntu. Instalador idempotente y que no sobrescriba datos existentes.

Permitir prueba en Replit sin acoplar almacenamiento a él. **La entrega debe funcionar fuera de Replit** con instrucciones reproducibles, datos de ejemplo claramente ficticios y sin credenciales incrustadas.

### 15.3. Mantenimiento
Comandos verificables `up`, `down`, `backup`, `restore`, `migrate`, `health`, `logs`; endpoint `/health` con verificación de DB y almacenamiento, sin filtrar secretos. Documentar requisitos CPU/RAM/espacio, dependencias locales de IA (si se activa) y tamaño máximo de adjuntos. Renovación de copias y comprobaciones de integridad planificadas.

---

## 16. API propuesta y contratos

**Base:** `/api/v1` con OpenAPI. Todas las rutas protegidas salvo login, salud y recuperación controlada. Respuestas JSON con claves y errores estructurados; paginación y filtros obligatorios en colecciones.

| Módulo | Endpoints requeridos (orientativos) |
|---|---|
| Autenticación | `POST /auth/login`, `POST /auth/logout`, `GET /me`, `POST /auth/refresh` |
| Centro y curso | `GET/PUT /centers/{id}`, `GET/POST /years`, `GET/POST /assignments` |
| Catálogo oficial | `GET /catalogs/{year}`, `POST /admin/catalogs/import`, `GET /catalogs/{year}/validate` |
| PIC | `GET/PUT /plans/{id}`, `GET /plans/{id}/validation`, `POST /plans/{id}/snapshot` |
| DAFO/acciones | `GET/PUT /plans/{id}/dafo`, `GET/PUT /plans/{id}/actions` |
| Actuaciones | `GET/POST /activities`, `GET/PATCH /activities/{id}`, `POST /activities/{id}/validate` |
| Documentos | `POST /documents`, `GET /documents/{id}`, `POST /documents/{id}/versions` |
| Indicadores | `GET /plans/{id}/indicators`, `POST /indicators/recalculate`, `GET /indicators/{code}/trace` |
| Solicitudes | `POST /information-requests`, `GET /my-requests`, `POST /information-requests/{id}/respond` |
| CICLOPE | `GET/POST /meetings`, `POST /meetings/{id}/agenda`, `POST /meetings/{id}/minutes`, `POST /meetings/{id}/approve` |
| Actas/acuerdos | `GET/POST /agreements`, `PATCH /agreements/{id}` |
| ATECA/FABLab | `GET/POST /spaces`, `GET/POST /space-uses` |
| Productos software | `GET/POST /products`, `PATCH /products/{id}`, `GET /products/{id}/releases` |
| Difusión | `GET/POST /communications`, `POST /communications/{id}/approve` |
| Buzón y correos | `GET/POST /mail/messages`, `GET /mail/threads`, `POST /mail/drafts`, `POST /mail/drafts/{id}/approve`, `POST /mail/drafts/{id}/send`, `POST /mail/threads/{id}/assign`, `GET /mail/contacts`, `POST /mail/contacts/import`, `GET /mail/deliveries`, `GET /mail/approvals` |
| Resend webhooks y estado | `POST /webhooks/resend` (firma obligatoria), `GET /admin/mail/provider-status`, `POST /admin/mail/verify-config` (sin envío de prueba no autorizado) |
| IA correo | `POST /mail/threads/{id}/classify`, `POST /mail/threads/{id}/suggest-reply`, `POST /admin/mail/auto-reply-policies` (privilegiado) |
| Generación | `POST /exports/pic`, `POST /exports/laycos-fields`, `POST /exports/quarterly`, `POST /exports/final-report` |
| Entrega manual | `POST /submission-records` (fecha, documento y evidencia confirmada) |
| IA | `POST /ai/extract`, `POST /ai/suggest`, `POST /ai/ask` (si habilitada) |
| Auditoría | `GET /audit` (autorizado), `POST /admin/backups`, `POST /admin/restore/validate` |

Para escrituras sensibles, esquema de idempotencia y control de concurrencia (`updated_at`/ETag). `POST /meetings/{id}/approve` no permite suplantar aprobación institucional: verificar perfil y competencia configurada.

---

## 17. Tareas automáticas y planificador interno

- Resumen semanal de pendientes del C2, configurable, sin más de un resumen habitual por semana salvo urgencias.
- Revisión diaria de plazos PIC/seguimientos/memoria y vencimientos de acuerdos.
- Solicitudes de información agrupadas por responsable con recordatorios no invasivos.
- Recalcular indicadores cuando una actuación validada se crea/modifica/retira o su evidencia cambia.
- Preparar borradores trimestrales a partir de snapshots y documentos existentes.
- Verificar copias y espacio en disco; alertar solo ante fallo de integridad/backup.
- Nunca transmitir datos externos sin base de autorización y configuración de destino. Las respuestas automáticas solo pueden activarse para categorías preaprobadas de bajo riesgo conforme al módulo 12.5.
- Procesar cola de correo Resend con circuit breaker, idempotencia y reconciliación; consolidar eventos sin duplicar conversaciones o actuaciones.

---

## 18. Informes, exportaciones y métricas de reducción de carga

**Entregables de cada informe:** versión DOCX editable, PDF cerrado, lista de campos Laycos copiables y JSON de datos estructurados. Para indicador, mostrar valor y origen. Toda cifra debe rastrearse a una vista de datos y al conjunto de evidencias. Generación repetida no produce duplicados.

**Métricas de calidad del software:** tiempo de redacción del PIC, tiempo dedicado a cada seguimiento, porcentajes de campos autocompletados desde datos validados, preguntas duplicadas evitadas, documentos recuperados sin intervención del C2, actividades con evidencia, actividades pendientes por causa, recuentos no duplicados y errores en exportación.

No se establecerá «90 % de automatización real» sin medirlo; diseñar telemetría local de proceso, anonimizada y desactivable, para obtener datos verificables.

---

## 19. Plan de construcción por fases y entregas

**Fase 0: base y seguridad (entrega ejecutable).** Repositorio, Docker Compose, PostgreSQL, autenticación, RBAC, curso/centro, migraciones, backups básicos, importador JSON de catálogo y pruebas. Incluye instalador Ubuntu y README inicial. **No pasar de fase sin login y persistencia reales.**

**Fase 1: PIC completo sin IA.** Editor 1–10, diagnóstico DAFO, proyectos internos y selección de seis, catálogo de acciones/indicadores, unidades/meta/riesgo, validaciones y exportación Laycos manual/PIC DOCX/PDF. Al finalizar ya debe poder preparar el PIC de octubre.

**Fase 2: captura documental y distribución.** Documentos, solicitudes mínimas, fichas de actuaciones, deduplicación, confirmación por departamentos, referencias a evidencia y cálculo determinista de indicadores. Concurrencia y auditoría.

**Fase 3: CICLOPE y coordinación C2.** Convocatorias operativas y aprobación cuando proceda, órdenes del día, actas, asistencia, acuerdos, tareas, agenda de C1 y cuadro de cumplimiento. Pruebas del circuito completo.

**Fase 3B: centro de comunicaciones Resend.** Dominio `iesmmg.org` verificado para envíos; subdominio `buzon.iesmmg.org` para recepción mediante webhooks sin alterar MX raíz; contactos/segmentos, bandejas, conversación, plantillas, aprobación, adjuntos, seguridad, trazabilidad y cola tolerante a fallos. Pruebas AT-41–AT-46 y AT-50–AT-51; la activación de correo real exige permisos y DNS confirmados.

**Fase 4: seguimiento, memoria y certificación.** Partes 11–14 PIC, snapshots trimestrales, anexos, memoria, expediente de justificación, exportación coherente con Laycos y entrega manual confirmada.

**Fase 5: ATECA, FABLab, SCORM e Innovando en FP.** Espacios, usos, catálogo de productos, proyectos y transferencias a coordinación de familia profesional; indicadores asociados, sin duplicación.

**Fase 6: IA opcional.** Extracción y propuestas a partir de fuentes y RAG; proveedores local/deshabilitado; evidencia visible y aprobación humana; clasificación del buzón y respuesta automática **solo a consultas generales previamente autorizadas**, pruebas AT-47–AT-49 y AT-52, seguridad y límites adversariales.

**Fase 7: endurecimiento y puesta en producción.** Auditorías, restauración real, accesibilidad, cobertura de pruebas, rendimiento con datos de varios cursos, documentación final, despliegue Ubuntu/Proxmox, validación funcional piloto.

Cada fase concluye con rama/versión reproducible, migraciones, tests, guía de uso y un informe «completado / pendiente / incidencias». **No declarar una fase completada por presentar pantallas sin funcionalidad**.

---

## 20. Pruebas de aceptación obligatorias (AT-01 a AT-40; comunicaciones AT-41 a AT-52 en §12.9)

**A. PIC**
- AT-01: carga catálogo 2026-2027 con 6 objetivos, 24 acciones, 31 indicadores y opciones DAFO/ODS/cargos del JSON; no pierde tildes.
- AT-02: no se cierra un PIC sin las acciones 1.1 y 1.2.
- AT-03: no se cierra un PIC si un objetivo carece de acción.
- AT-04: rechaza 0 riesgos numéricos; acepta «NO» como riesgo booleano.
- AT-05: máximo 3 acciones propias; máximo 3 situaciones DAFO por cuadrante y mínimo 1.
- AT-06: inventario admite 9 proyectos, pero apartado 4 solo incluye 6 elegidos expresamente.
- AT-07: apartado 1–10 exportado en orden oficial, con todos los indicadores seleccionados y valores precisos.
- AT-08: marcado «presentado en Laycos» solo mediante acción explícita con fecha y registro de prueba.
- AT-09: se puede actualizar el plan y recuperar instantánea previamente presentada.
- AT-10: partes 11–14 preservan estado y versiones entre trimestres.

**B. Recogida y evidencias**
- AT-11: docente añade una actividad y una evidencia; C2 no vuelve a introducir esos datos.
- AT-12: documento duplicado por dos canales se vincula a una sola actuación.
- AT-13: «Sin información» no incrementa indicadores ni se representa como «No realizado».
- AT-14: pregunta a responsable solo campos esenciales ausentes; las respuestas se reutilizan.
- AT-15: un usuario de otra familia no ve documentos restringidos sin permiso.
- AT-16: cada «LOGRADO» contiene fórmula o confirmación, evidencias y persona validadora.
- AT-17: retirar una actuación validada deja historial y corrige los recuentos actuales.
- AT-18: nadie puede modificar un documento ya aprobado sin generar nueva versión.

**C. CICLOPE**
- AT-19: C2 configura y convoca operativamente cuatro reuniones CICLOPE del curso.
- AT-20: convocatoria requiere validación institucional si el centro la ha configurado como necesaria.
- AT-21: reunión programada no cuenta como celebrada.
- AT-22: acta generada por IA permanece borrador hasta validación competente.
- AT-23: los acuerdos se convierten en tareas y quedan enlazados al acta original.
- AT-24: registrar asistencia C2 a reunión C1 sin convertirlo en asistencia a CICLOPE.
- AT-25: recordatorio de acuerdo se dirige al responsable, no se traslada automáticamente al C2.

**D. Espacios, productos y transferencia**
- AT-26: FABLab y ATECA son espacios diferentes y compartidos por todas las familias.
- AT-27: una actividad que utiliza ambos espacios cuenta como una sola actuación.
- AT-28: «Innovando en FP» agrupa INNOVA-C2, CoordinacionFP y SafeExit en productos separados.
- AT-29: un producto «en pruebas» no se computa como «implantado».
- AT-30: recurso SCORM difundido no se da por implantado en otro centro sin confirmación.

**E. IA y seguridad**
- AT-31: sistema funciona sin proveedor IA configurado.
- AT-32: IA propone datos sin aprobar actuaciones o inventar indicadores.
- AT-33: pregunta administrativa devuelve fuentes internas o «No consta».
- AT-34: archivo malicioso o contenido de prompt injection no permite ejecución de órdenes.
- AT-35: no hay contraseñas en código, exports de demostración ni logs.
- AT-36: una persona sin permiso no puede acceder a documento privado mediante URL directa.
- AT-37: un backup y una restauración reales recuperan DB, documentos y vínculos.
- AT-38: instalación en Ubuntu limpio funciona sin depender de servicios específicos de Replit.
- AT-39: comprobación de teclado y etiquetas pasa un análisis WCAG automatizado y revisión manual.
- AT-40: exportación puede copiarse campo a campo en Laycos manualmente; no existe integración ni código de automatización de Laycos.

---

## 21. Datos semilla del centro y datos que NO se deben suponer

**Semillas confirmadas por la persona promotora:** centro piloto IES Manuel Martín González; curso 2026-2027; proyecto «Innovando en FP» con productos INNOVA-C2, CoordinacionFP y SafeExit; existencia permanente de FABLab de diseño y fabricación 3D para todas las familias; existencia de aula ATECA; líneas de FP Inteligente con SCORM/IA; relación operativa de C1 CIFP Gran Sur/Aurelio Fernández según convocatoria; C2 asume gestión operativa/convocatorias CICLOPE.

**Pendientes de confirmación:** titularidad y administración DNS de `iesmmg.org`, registros SPF/DKIM/DMARC/MX actuales, cuenta y autorización Resend, dominio de recepción, legitimación institucional del tratamiento de comunicaciones, encargos y revisión DPD, número real de grupos, relación nominativa de docentes y coordinadores, nombramientos, composición formal de CICLOPE, identidad exacta de firmantes, fechas reales de constitución, relaciones de proyectos activos y sus estados, indicadores iniciales, evidencias de actuaciones, autorizaciones para correo/IA/documentos, servidores concretos, credenciales, existencia de acuerdos o autorizaciones de difusión, asistencia real a reuniones, presentación en Laycos.

En primera instalación mostrar un asistente con estas necesidades, pero permitir saltar los datos no imprescindibles y volver después. Semillas oficiales NO deben ser cifras inventadas ni contenidos de prueba mezclados con los datos reales.

---

## 22. Entrega contractual solicitada a Replit

1. Repositorio completo, con frontend/backend, migraciones, modelos, tareas y catálogo oficial JSON.
2. README exhaustivo (desarrollo Replit, instalación Ubuntu, variables de entorno, red, cuentas, restauración y actualización).
3. Instalador Ubuntu inicial e idempotente, `docker-compose.yml`, `env.example` y comandos de mantenimiento.
4. Manual C2, manual docentes/jefaturas, manual administración técnica y guía de preparación manual de Laycos.
5. Exportaciones reales DOCX/PDF y pruebas de correspondencia con el modelo fuente.
6. Tests unitarios, integración, e2e de flujos críticos, permisos y backups, más informe de resultados reproducibles.
7. Dataset **ficticio** de demostración claramente separado de los datos reales del centro.
8. Informe de limitaciones restantes, permisos pendientes, riesgos de seguridad y decisiones por confirmar.
9. Mecanismo de exportación de datos completo y documentado para que el centro pueda migrar a otro servidor.
10. Revisión final conjunta con el C2 y lista de aceptación firmable de AT-01 a AT-52.

### 22.1. Orden de prioridad no negociable
**P0:** persistencia, roles, captura de información, PIC completo, motor de indicadores, exportaciones, backup/restauración, Laycos manual.  
**P1:** CICLOPE con gestión operativa por C2, actas, **centro de comunicaciones bidireccionales Resend con dominio `iesmmg.org`** (cuando se configure), seguimiento y memoria.  
**P2:** ATECA, FABLab, productos Innovando en FP, SCORM, transferencia autonómica.  
**P3:** IA avanzada, respuestas automáticas restringidas del buzón, conectores opcionales y funciones de análisis no imprescindibles.

### 22.2. Regla final de calidad
> Se considerará exitoso INNOVA-C2 solo cuando un coordinador pueda preparar y mantener el PIC, documentar CICLOPE, registrar actuaciones y elaborar los seguimientos **sin reescribir la información ya existente y sin depender de Laycos para gestionar el trabajo interno**. Los actos oficiales seguirán requiriendo su validación y presentación manual donde proceda.

---

## 23. Referencias documentales de esta especificación

- *Plan de Innovación del Centro (PIC), Coordinación C2, curso 2026-2027* (modelo DOCX proporcionado).
- *Guía de referencia C2 · Red de Innovación* (2026-2027).
- *Guía de trabajo C2 · Red de Innovación* (2026-2027).
- *Cómo se rellenan los indicadores: Meta, Riesgo y Logrado*, 2026-2027.
- *Cronograma de la Red de Innovación 2026-2027*, versiones para pantalla y A4.
- *Cuestionario previo C2*, 2026-2027.
- *Guías C1 de referencia y trabajo*, 2026-2027, para delimitar C1 frente a C2.
- Convocatoria comunicada por Aurelio Fernández (CIFP Gran Sur) para el 21/10/2026, facilitada por el promotor.
- Requisitos y contexto adicionales comunicados por el promotor sobre FABLab, ATECA, SCORM, IA, CoordinacionFP, SafeExit, «Innovando en FP» y coordinación operativa CICLOPE.
- Decisión del promotor (17/10/2026): uso de Resend como correo bidireccional, **`iesmmg.org` como dominio de envío**, intercambio con `@canariaseducacion.es` y buzón IA de respuestas; subdominio técnico recomendado para recepción sin sustituir MX raíz.
- Documentación técnica Resend: https://resend.com/features/inbound y https://resend.com/blog/inbound-emails.

**Nota de control:** la especificación toma como referencia los modelos entregados para el curso 2026-2027. Antes de una presentación real, el C2 verificará que el formulario Laycos vigente mantiene los mismos campos. El programa deberá permitir actualizar el catálogo de forma versionada sin reescribir expedientes históricos.
