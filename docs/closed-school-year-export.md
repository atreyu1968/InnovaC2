# Descargar y verificar un expediente cerrado

En **Cursos → Expediente histórico**, selecciona un curso cerrado y pulsa
**Descargar expediente**. La descarga exige el mismo acceso actual y del curso
histórico que la consulta. Administración técnica conserva su excepción de acceso
global dentro del centro.

El JSON contiene la instantánea capturada al cerrar, la identificación del curso,
la validación de cierre (incluidos sus avisos), el catálogo referenciado y un
manifiesto que identifica cada fuente y su checksum SHA-256. No consulta los
datos del curso activo ni crea versiones del PIC. Solo registra la descarga en
auditoría.

## Qué incluye y qué no

- Datos y metadatos archivados de planes, actuaciones, indicadores, documentos,
  versiones y demás fuentes de la instantánea, incluso si el PIC faltaba o era
  borrador.
- No incluye los archivos binarios originales, rutas de almacenamiento privadas,
  contraseñas ni sesiones.
- No es una copia de seguridad para restaurar ni un mecanismo para importar datos
  a otro curso. El cierre y esta exportación no certifican aprobación o entrega.

## Verificar sin conexión

Desde la carpeta del proyecto, con Node.js instalado, ejecuta:

```sh
node scripts/verify-school-year-export.mjs /ruta/al/expediente.json
```

No necesita base de datos ni acceso al servidor. Sale con código distinto de cero
si falta una fuente, cambia su identidad o no coincide un checksum. La
serialización verificada es JSON UTF-8 sin espacios, con claves ordenadas
recursivamente por orden UTF-16 y arrays en su orden original. Se calcula sobre
`content` y sobre cada objeto completo de `content.sources`, no sobre los bytes
del archivo con su formato legible.

`archive.sourceHash` es la huella de la instantánea privada original. El servidor
la coteja **antes** de retirar las ubicaciones privadas y rechaza la descarga si
no coincide. Por eso es distinta de `manifest.contentSha256`, que corresponde al
contenido público y puede recalcularse sin conexión.

Los checksums detectan cambios respecto al manifiesto, pero no son firmas
digitales: alguien que modifique tanto los datos como sus checksums podría
superar esta comprobación. Conserva el archivo en un medio de confianza y
contrasta la huella archivada con la consulta del curso en el sistema de origen.
La comprobación sin conexión no permite reconstruir ni verificar por sí sola la
instantánea privada omitida.
