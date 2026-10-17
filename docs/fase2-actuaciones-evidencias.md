# Fase 2: actuaciones, documentos e indicadores

Recuperación de versiones en cuarentena y pruebas contra el motor ClamAV real:
[procedimiento Ubuntu y comprobaciones aisladas](clamav-cuarentena.md).

## Uso

1. Administración técnica asigna una familia oficial al profesorado, jefaturas
   y coordinación de red desde **Usuarios**. Puede hacerlo al dar de alta o
   modificar una cuenta existente. Una asignación concurrente obsoleta se
   rechaza; el cambio se audita.
2. C2 prepara el PIC vigente y sus indicadores en **Plan PIC**.
3. En **Actuaciones y evidencias**, el personal registra título, descripción,
   fecha, familia y procedencia. Puede relacionar indicadores seleccionados en
   el plan. El responsable confirma los datos y C2 valida la actuación.
4. En **Documentos**, se suben archivos reales, privados, con hash SHA-256.
   Se admiten únicamente los formatos y firmas que valida la API, hasta 8 MB.
   Cada nueva versión conserva los bytes de las anteriores.
5. Un archivo solo se puede descargar o aprobar tras un resultado limpio de
   ClamAV. La falta de configuración o un fallo del antivirus mantiene el
   archivo en cuarentena; nunca se simula un resultado limpio.
6. C2 puede conceder o revocar accesos expresos a documentos restringidos o
   compartidos por familia. La visibilidad de documentos de centro es más
   amplia; no se deben utilizar para documentación sensible de un departamento.
7. C2 solicita únicamente información esencial ausente. El destinatario puede
   responder, indicar **Sin información** o **No realizada**. C2 revisa y
   valida; las respuestas válidas completan los datos ausentes sin reintroducirlos.
8. La retirada de una actuación conserva su historial y la excluye de los
   recuentos actuales.

## Indicadores

Los códigos y tipos proceden del catálogo oficial y de la selección del PIC.
El recuento operativo de actuaciones utiliza actuaciones únicas confirmadas y
validadas con evidencia aprobada y limpia, vinculada expresamente al indicador.
Los booleanos exigen confirmación C2 con evidencia; los porcentajes conservan
numerador, denominador y cálculo del servidor. No se confunde ausencia de datos
con incumplimiento.

Estos métodos operativos no sustituyen una fórmula normativa: el catálogo
marca los métodos que deben configurar y validar C2. Se conserva la fórmula,
la persona validadora y las referencias de evidencia de cada observación.

## Almacenamiento y despliegue

- PostgreSQL guarda metadatos, historial, permisos, solicitudes y observaciones.
- `DATA_DIR` guarda archivos fuera del directorio público, con nombres internos
  aleatorios y permisos privados. Se debe copiar junto a PostgreSQL.
- `CLAMAV_HOST` y `CLAMAV_PORT` conectan la API al servicio real por INSTREAM.
  Docker Compose incluye el servicio en la red interna, sin publicar su puerto.
- Si falta el antivirus, la captura sigue guardando documentación en cuarentena.
  No hay todavía una acción de reanálisis de versiones ya almacenadas: deben
  permanecer bloqueadas hasta incorporar ese circuito. No se deben alterar
  manualmente sus estados para eludirlo.

## Informe de verificación

**Completado y comprobado:** contrato generado, comprobación TypeScript,
compilación y pruebas reales por HTTP contra PostgreSQL aislado para las fases
0, 1 y 2. La fase 2 comprueba separación por familias, asignaciones y concurrencia,
deduplicación, respuestas diferenciadas, persistencia documental/versiones,
concesiones expresas, cuarentena y reglas de evidencia. La limpieza de los datos
de prueba respeta las referencias protegidas de las versiones.

**Comprobado en navegador con base aislada:** alta y edición de actuación,
persistencia después de recargar, subida de evidencia vinculada, conservación de
metadatos, segunda versión con nombre distinto e historial de ambas versiones.
Se verificaron los controles bloqueados en cuarentena y la disposición de la
pantalla autenticada en escritorio y móvil de 390 px.

**Pendiente de validación de despliegue:** detección limpia/infectada con ClamAV
real, circuito de aprobación posterior y restauración completa sobre Ubuntu.
No se declara certificada toda la fase mientras falten estas comprobaciones.

**Fuera de esta fase:** cierre y apertura de cursos, consulta histórica por IA,
CICLOPE operativo, bandejas Resend y memoria trimestral. El curso activo actual
delimita las actuaciones; no existe aún un selector histórico en estas pantallas.
