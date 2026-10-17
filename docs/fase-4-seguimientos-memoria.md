# Fase 4 · Seguimientos trimestrales, memoria y expediente del PIC

Esta guía describe la implementación de los apartados 11–14 de la especificación del PIC y su uso en INNOVA-C2. Los informes pertenecen al PIC y al curso activo del centro; no se trasladan datos de cursos anteriores al actual.

## Correspondencia con la plantilla oficial

| Informe | Apartado | Contenido editable |
| --- | --- | --- |
| Primer trimestre | 11 | Estado y observación por cada acción seleccionada, actuaciones, incidencias y ajustes |
| Segundo trimestre | 12 | Los mismos campos que el primer trimestre |
| Tercer trimestre | 13 | Los mismos campos y fecha del traslado del resumen al CCP o ETA |
| Memoria final | 14 | Aspectos positivos, dificultades, explicación de objetivos no alcanzados, mejoras para el curso siguiente y fecha de incorporación a la memoria del centro |
| Justificación | Expediente interno | Lista de comprobación manual y referencias/anexos; no es un certificado |

Las filas de acción salen de las acciones seleccionadas en el PIC vigente. El seguimiento no permite añadir o quitar acciones. Cada estado y observación se introduce o confirma por una persona; la aplicación no calcula un grado de logro para la memoria.

## Reutilización de información y límites de afirmación

- Actuaciones: solo se ofrecen actuaciones validadas y confirmadas del mismo centro y curso.
- Evidencias: solo se ofrecen evidencias validadas asociadas a documentos aprobados, limpios y compartidos con el centro. No se amplía su alcance de acceso.
- Actas y acuerdos CICLOPE: solo se ofrecen acuerdos de actas validadas. La tarea muestra literalmente si CICLOPE la conserva abierta o marcada como completada; eso no la convierte en logro del PIC.
- Agenda C1: se puede citar como agenda recibida o planificación. No demuestra asistencia, participación ni cumplimiento.
- Indicadores: solo se ofrecen observaciones del PIC con `validatedBy`. Se presenta el valor registrado sin recalcular el grado de logro.
- Anexos: son referencias a versiones limpias de documentos aprobados y compartidos con el centro en el curso activo. Se conserva el identificador de versión y su SHA-256; no se copian ni se modifican los archivos.

La sección de certificación exige confirmaciones manuales para asistencia C1, presentación del PIC, plazos de los informes y solicitud de certificación. La lista no emite aprobación, certificado, horas certificadas ni pagos. La agenda C1 no se acepta como fuente de asistencia.

## Borradores, snapshots y cierre de curso

1. Guarda cada informe como borrador con revisión optimista. Un guardado basado en una revisión antigua devuelve conflicto y no sustituye la versión más reciente.
2. Cuando el contenido esté revisado, crea una instantánea con un motivo. La instantánea conserva una copia del informe, su revisión, referencias y anexos, advertencias de integridad y una huella SHA-256.
3. Las instantáneas y recibos de entrega son solo de inserción: la base de datos rechaza su actualización o borrado. Editar posteriormente el borrador crea una revisión nueva; no altera los snapshots.
4. El cierre anual incluye borradores, instantáneas y recibos en el expediente inmutable del curso. Los avisos de informes o instantáneas faltantes no certifican el cumplimiento y no cambian el contenido histórico.

La API y la pantalla solo consultan el PIC del curso activo. Centro, curso y PIC se vuelven a comprobar al guardar, congelar, exportar y registrar una entrega. No se modifica un informe de un curso cerrado desde este flujo.

## Exportación y transcripción a Laycos

- DOCX, PDF y JSON se generan únicamente desde una instantánea seleccionada. Incluyen versión, revisión, motivo, huella, fuentes y avisos de revisión.
- Los campos Laycos se ordenan por el apartado oficial (11, 12, 13 o 14) y se copian al portapapeles para transcripción manual. El expediente interno de justificación no se exporta como formulario Laycos.
- INNOVA-C2 no inicia sesión en Laycos, no envía informes ni infiere que se recibieron, leyeron o aprobaron.
- Para dejar constancia, una persona coordinadora selecciona un snapshot, identifica un documento aprobable del centro y curso con una versión limpia, marca la confirmación y aporta una nota de al menos 15 caracteres. El recibo inmutable conserva fecha, persona, referencia externa opcional, texto de confirmación, documento, versión y hash. Es una anotación de la persona; no prueba aceptación de Laycos.

## API disponible

Las rutas se montan bajo `/api/v1`:

- `GET /plans/{planId}/followups`: informes, acciones del PIC, fuentes y documentos anexables del curso activo.
- `GET /plans/{planId}/followups/{reportType}`: borrador y snapshots del informe.
- `PUT /plans/{planId}/followups/{reportType}`: guardar una revisión mediante `expectedRevision`.
- `POST /plans/{planId}/followups/{reportType}/snapshots`: crear snapshot con revisión esperada y motivo.
- `GET /plans/{planId}/followups/{reportType}/deliveries`: recibos de transcripción manual.
- `POST /plans/{planId}/followups/{reportType}/deliveries`: registrar una entrega confirmada por una persona con prueba documental elegible.
- `GET /plans/{planId}/followups/{reportType}/snapshots/{snapshotId}/exports/laycos`: campos para copiar, nunca una transmisión.
- `GET /plans/{planId}/followups/{reportType}/snapshots/{snapshotId}/exports/{format}`: exportar `docx`, `pdf` o `json`.

Los endpoints verifican autenticación, CSRF en escrituras, permiso de PIC, rol de coordinación y pertenencia al curso activo. No reciben ni devuelven claves de almacenamiento ni contenido binario de anexos.

## Migraciones, generación y pruebas aisladas

Desde la raíz del workspace:

```sh
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run migrate
pnpm run test:pic-followups
```

`test:pic-followups` crea un clúster PostgreSQL nuevo en un directorio temporal, ejecuta todas las migraciones, arranca una API aislada y lo elimina al finalizar. Filtra `DATABASE_URL`, `TEST_DATABASE_URL`, secretos de sesión y rutas de datos existentes antes de crear su propia configuración temporal. Comprueba las fuentes elegibles, permisos, revisiones, snapshots inmutables, formatos de exportación, confirmación humana, restricciones del justificante y conservación en el archivo anual.

Las migraciones nuevas están versionadas y no reescriben los documentos de referencia originales ni snapshots históricos.

El comando `migrate` anterior solo inicializa directamente una base nueva.
Para instalaciones existentes, seguir [la actualización con respaldo y preflight](database-upgrades.md).
Tras añadir migraciones, regenerar la referencia en el clúster aislado y ejecutar
`pnpm run test:migrations`; no fabricar un ledger a partir de la mera existencia
de tablas.
