# Fase 5 — Catálogo «Innovando en FP»

## Alcance operativo

La sección **Productos propios** utiliza PostgreSQL, autenticación, asignaciones
anuales, permisos y protección CSRF existentes. C2 y administración técnica
gestionan el catálogo; los demás perfiles autorizados del curso lo consultan.
No requiere servicios de Replit, Resend ni un proveedor IA.

La inicialización es explícita. Crea el proyecto padre «Innovando en FP» y tres
fichas independientes: INNOVA-C2, CoordinacionFP y SafeExit. Sus nombres proceden
de la especificación; no se inventan responsables, centros, impacto o aprobación.
El estado inicial `idea` es una declaración pendiente de revisión, no una
afirmación de que no exista código o uso previo. Vincular el padre a un proyecto
PIC existente no lo selecciona para el PIC ni altera el límite de seis proyectos.

Cada ficha contiene finalidad, destinatarios, módulos, responsable activo,
inicio, versión declarada, repositorio HTTPS opcional, estado, centro/fecha de
piloto o implantación, resultados, fechas confirmadas y referencias documentales.
Los estados son `idea`, `analisis`, `desarrollo`, `pruebas`, `piloto`,
`implantado` y `mantenimiento`. Para avanzar desde idea se exige finalidad y
responsable del curso. Las URL no admiten credenciales ni parámetros de consulta.

## Declaraciones y evidencias

- Piloto, implantación y mantenimiento necesitan centro, fecha confirmada y
  evidencia. Resultados, aprobación oficial y revisión de seguridad necesitan
  sus propias fechas confirmadas y evidencia.
- Solo se admiten versiones documentales aprobadas, limpias, compartidas con el
  centro y accesibles al actor, del mismo centro/curso.
- Se fija versión y SHA-256, nunca una ruta privada ni el contenido del archivo.
  La captura de referencias se protege frente a cambios simultáneos en
  aprobación o análisis antivirus.
- Si se retira el acceso, la aprobación o la limpieza, se muestra advertencia y
  se oculta el título en ficha, registros e historial. La referencia histórica
  no se sustituye silenciosamente por una versión posterior.
- Estas son declaraciones humanas con respaldo documental. El sistema no
  certifica que el documento demuestre por sí mismo seguridad o aprobación
  oficial. Ni una entrega técnica ni programar un módulo certifican innovación
  implantada; no se crean actuaciones ni se incrementan indicadores.

## Entregas, pruebas e historial

Se añaden registros de entrega/versionado, hito, prueba, ticket, captura o manual,
con fecha, detalle, resultado y documentos. Capturas y manuales deben referenciar
documentos; una entrega necesita versión. Se pueden planificar hitos/pruebas
futuros, pero no declararlos completados antes de su fecha.

Los registros son inmutables. Una rectificación añade otro registro del mismo
tipo y conserva el anterior, indicando a cuál sustituye; no modifica una entrega
importada ni borra hechos. Los guardados usan revisión esperada: un conflicto no
sobrescribe datos. La interfaz conserva el borrador y exige revisar/adoptar
explícitamente la revisión actual antes de guardar sobre ella.

`config/innova-deliveries.json` es el manifiesto versionado de entregas técnicas
efectivamente comprobadas. Se importa automáticamente al inicializar la ficha de
INNOVA-C2. **Importar entregas instaladas** incorpora las nuevas entradas sin
teclear de nuevo sus pruebas y sin duplicarlas; cambiar una entrada ya registrada
sin otra identificación se rechaza. No cambia estado, versión declarada,
implantación, resultados ni aprobaciones del producto. La versión instalada y la
declarada se muestran por separado. El manifiesto no es una firma, certificado
de seguridad ni prueba de instalación en otros centros.

Fichas, registros y versiones se archivan con el cierre del curso, quedan
bloqueados en la base y no se copian automáticamente al siguiente. Los datos
anteriores siguen en la instantánea archivada, no en el catálogo activo.

## Verificación y actualización

`pnpm run test:products` usa el mismo aprovisionador aislado que las pruebas de
espacios, en una rama independiente de pruebas. Provisiona un clúster nuevo,
aplica migraciones, verifica repetición segura de guardas y arranca una API real.
Prueba permisos/CSRF, datos persistidos, fechas, evidencias, restricciones de
declaraciones, versiones, rectificaciones, concurrencia, retirada de evidencias,
autoregistro idempotente, cierre y separación entre cursos. No toca la base real.

Las migraciones `0016_software_products` y `0017_software_guards` son aditivas.
Se actualiza la referencia del preflight exclusivamente desde un clúster aislado.
En Ubuntu se mantiene el procedimiento de copia comprobada, preflight y
actualización documentado; no ejecutar `push-force` ni recrear bases existentes.

Pendientes: SCORM/FP Inteligente y el circuito autonómico de transferencia.
No hay envío institucional ni declaración de centros instalados o usuarios
activos derivados de este catálogo.
