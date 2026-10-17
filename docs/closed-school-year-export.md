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

### Paquete separado de originales

**Descargar originales autorizados (ZIP)** exige acceso actual a documentos y
autorización C2 del curso histórico, o administración técnica dentro del centro.
No cambia la descarga JSON ni su manifiesto versión 1. El ZIP contiene:

- `expediente.json`: el mismo expediente y manifiesto compatible, sin rutas privadas.
- `informe-originales.json`: curso, huella de la instantánea, identificadores
  inmutables de documento y versión, resultado por versión y, solo para incluidos,
  nombre dentro del ZIP, tamaño y SHA-256.
- `originales/…`: únicamente los bytes que coinciden con el SHA-256 y tamaño
  archivados, con análisis limpio tanto archivado como vigente. No se usa
  `currentVersion`, ni se alteran documentos, permisos, análisis o versiones PIC.

Resultados del informe:

- `included`: original incluido.
- `missing`: versión o archivo ausente.
- `checksum_mismatch`: bytes o tamaño distintos de la referencia archivada.
- `security_blocked`: cuarentena, análisis pendiente/no disponible/no limpio,
  referencia inconsistente, archivo no regular, enlace simbólico, ruta insegura
  o acceso al almacenamiento denegado. No se reanaliza ni libera cuarentena.

Los nombres del ZIP se generan a partir de identificadores, versión y extensión
segura; nunca contienen ubicaciones del servidor. Los originales de todas las
versiones archivadas elegibles se incluyen, no solo la última. El informe puede
indicar omisiones o no incluir ningún original: **no es una copia de seguridad**.
No incluye archivos binarios ajenos a `document_versions` (por ejemplo, adjuntos
de entregas PIC); conserva sus metadatos en el expediente.

Hay un límite de 2000 versiones y 128 MiB de originales incluidos por paquete,
y 8 MiB por archivo conforme al límite de subida. Exceder el límite del paquete
rechaza toda la descarga (413), no entrega un ZIP truncado. Solo se prepara un
paquete simultáneo por proceso (429 para el siguiente). Los archivos temporales
se crean con acceso privado y se eliminan al terminar o fallar la descarga.
Los fallos de disco al preparar el ZIP abortan la descarga. La auditoría registra
la huella y recuentos por resultado, nunca ubicaciones de almacenamiento.

Tras extraer el ZIP, verifica `expediente.json` con el comando de abajo.
Para cada entrada `included`, compara el SHA-256 y tamaño del archivo indicado
con el informe. Estos checksums verifican coherencia, no autenticidad ni firma.

### Manifiesto del expediente JSON

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
