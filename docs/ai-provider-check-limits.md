# Límites compartidos de comprobación de IA

La comprobación técnica sigue siendo manual y usa exclusivamente muestras
sintéticas y el proveedor guardado. No ejecuta reintentos automáticos.

## Cuotas y almacenamiento

- Una comprobación por usuario cada minuto, incluso si cambia de centro.
- Tres por centro cada cinco minutos, sumando todas las sesiones y réplicas.
- Una sola comprobación en curso por usuario y por centro.
- Los intentos admitidos consumen cuota aunque el proveedor falle. Los rechazados
  no consumen cuota ni abren conexiones con el proveedor.
- PostgreSQL conserva únicamente identificadores de reserva, usuario y centro,
  fecha de inicio y fin del plazo de seguridad. No guarda claves, endpoints,
  modelos, muestras, respuestas ni resultados diagnósticos.
- Las ventanas usan el reloj de PostgreSQL, no los relojes de cada réplica.
  Los registros fuera de la ventana y sin reserva vigente se eliminan durante
  admisiones posteriores. No se modifican los ajustes del proveedor.

La migración `0016_ai_provider_check_usage.sql` añade una tabla independiente y
sus índices. Está registrada en el diario de migraciones y el esquema Drizzle;
se aplica con el procedimiento normal de actualización de la instalación.
Si falta la tabla o no se puede consultar la base, la API devuelve 503 sin
iniciar la comprobación; no sustituye la base por contadores en memoria.

## Concurrencia y recuperación

Cada admisión toma dos bloqueos consultivos de sesión, uno por identidad, en una
conexión PostgreSQL reservada hasta terminar ambas llamadas HTTP. No espera por
un bloqueo ocupado: devuelve 429 y `Retry-After`. La lectura de cuotas y la
inserción de la reserva se hacen dentro de una transacción con ambos bloqueos.

Un bloqueo de sesión vivo **no caduca**, aunque transcurra la ventana de cuota o
se pause el proceso. No basta con que caduque una reserva para sustituir a un
proceso que conserva sus bloqueos. El transporte tiene un plazo por llamada de
20 segundos y un límite conjunto de 25 segundos contado desde antes de solicitar
la admisión; también comprueba ese límite justo antes de abrir cada socket.

Si el proceso muere, PostgreSQL libera sus bloqueos al cerrar la sesión.
Si se pierde la conexión con la base, se cancela el transporte HTTP. La reserva
persistente mantiene un margen de seguridad de 60 segundos desde la admisión:
otra réplica no puede sustituirla antes, aunque ya no exista la sesión.
Después puede recuperarla, siempre respetando las cuotas de inicio.
Una liberación normal borra solo la reserva activa, no el consumo.

**Requisito de conexión:** todas las réplicas deben consultar la misma base
PostgreSQL. Los bloqueos requieren afinidad de sesión: una conexión directa o un
intermediario en modo *session pooling*. Un intermediario en modo *transaction
pooling* o *statement pooling* no es compatible.

Estos controles limitan las solicitudes que inicia la aplicación y cancelan sus
conexiones. Ningún cliente HTTP puede garantizar que un proveedor remoto deje de
procesar una petición ya recibida al cerrar la conexión: una garantía sobre sus
trabajos internos requeriría cancelación o identificadores de exclusión admitidos
por ese proveedor. Tampoco se garantiza disponibilidad durante una caída de la
base; se prioriza impedir consumo no controlado.

## Pruebas sin proveedores reales

```sh
pnpm run test:ai-provider-check
pnpm run test:ai-provider-check-shared
pnpm run typecheck
```

La primera suite mantiene las pruebas de permisos, CSRF, confirmación, revisión,
configuración inmutable y transporte HTTP con un adaptador de límites en memoria
exclusivamente para pruebas y reloj controlado. No verifica PostgreSQL.

La segunda crea su propio clúster PostgreSQL sin listener TCP, aplica las
migraciones reales y ejecuta tres procesos independientes con el limitador de
producción y proveedores HTTP locales simulados. No acepta URLs de bases
aportadas por el entorno. Comprueba cuotas tras reinicios, carreras de admisión,
independencia entre centros, exclusión de reservas vivas aun con fechas vencidas,
recuperación tras matar un proceso, cancelación al terminar la sesión PostgreSQL,
cuota tras fallos y ausencia de contenido sensible en la tabla.

Para no esperar cinco minutos, algunas pruebas adelantan exclusivamente las
fechas de sus registros aislados; no cambian el reloj del sistema ni comprueban
cinco minutos de tiempo real. La suite detiene su clúster y elimina sus archivos
en la limpieza; si no puede detenerlo, conserva el directorio y falla.
