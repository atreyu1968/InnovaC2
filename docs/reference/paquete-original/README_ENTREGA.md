# Paquete para desarrollo de INNOVA-C2 en Replit — versión 1.1

## Contenidos
- `ESPECIFICACION_FUNCIONAL_TECNICA_INNOVA_C2.docx`: documento formal de alcance, reglas, flujos, estructura administrativa, arquitectura y criterios de aceptación.
- `ESPECIFICACION_FUNCIONAL_TECNICA_INNOVA_C2.md`: mismo contenido, apto para ingestión por agentes de programación.
- `ENCARGO_DIRECTO_PARA_REPLIT.md`: instrucciones breves de inicio para el agente.
- `config/pic_2026_2027_catalogo.json`: catálogo oficial C2 transcrito del modelo entregado: 6 objetivos, 24 acciones, 31 indicadores, familias, ODS, cargos y opciones DAFO. Estado inicial de transcripción «para revisión»; comparar con fuente.
- `config/pic_2026_2027_acciones.csv`: tabla de inspección para el equipo técnico.
- `build_catalog.py`: script reproducible que regenera el catálogo desde el DOCX oficial; requiere acceso local al documento en ruta indicada y python-docx.

## Orden de entrega a Replit
1. Subir los archivos del paquete al proyecto Replit, preservando la carpeta `config`.
2. Abrir el archivo `ENCARGO_DIRECTO_PARA_REPLIT.md` y entregar al agente su contenido.
3. Pedir que consulte íntegra la especificación funcional, el catálogo JSON y sus pruebas de aceptación antes de implementar.
4. Priorizar la Fase 0 y Fase 1 del documento: la autonomía, los datos y el PIC son más urgentes que la IA.
5. Exigir pruebas ejecutadas y código exportable a Ubuntu/Proxmox después de cada fase.

## Módulo de comunicaciones añadido en versión 1.1
Se ha definido el envío con **Resend desde `iesmmg.org`**, la recepción en **`buzon.iesmmg.org`** con buzón bidireccional, Reply-To dedicado y clasificación de respuestas con IA. Mantener el MX del dominio raíz sin modificaciones y exigir aprobación previa para correspondencia institucional. Autorespuesta IA únicamente para FAQ seguras según políticas aprobadas. Las pruebas **AT-41…AT-52** son obligatorias y complementan el alcance original.

## Límites
La aplicación no puede integrarse con Laycos. La presentación oficial se realiza manualmente. No se incluyen credenciales institucionales. Los datos de personas, indicadores y estados de proyectos que no se hayan confirmado son **pendientes de verificar**.

## Documentación oficial y verificación
- `fuentes/` contiene el modelo PIC original y las guías C2, indicadores y cronograma facilitados para esta planificación. Son referencias del curso 2026-2027, no una API de Laycos.
- `qa/validate_catalog.py` valida automáticamente que el catálogo tiene seis objetivos, 24 acciones y 31 indicadores sin códigos duplicados.
- `qa/CONFORMIDAD_ENTREGA.md` ofrece una lista de revisión de la futura aplicación. Los estados permanecen **pendientes** hasta disponer de pruebas realizadas.

## Contexto organizativo incorporado
La persona C2 de Innovación gestionará operativamente la coordinación y convocatorias de CICLOPE, con la participación y los refrendos institucionales que correspondan al equipo directivo. Se distinguen FABLab y aula ATECA. El proyecto transversal «Innovando en FP» engloba el desarrollo de software administrativo/educativo: INNOVA-C2, CoordinacionFP y SafeExit.
