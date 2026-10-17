# INNOVA-C2

Aplicación local para la coordinación del programa PIC de innovación y mejora del IES Manuel Martín González. Las cuentas, permisos, centros, cursos y catálogos se guardan en PostgreSQL; no usar valores simulados en paneles ni en informes.

## Ejecutar y comprobar

- `pnpm --filter @workspace/api-server run dev` — API en el puerto configurado por `PORT`.
- `pnpm run typecheck` — comprobación de TypeScript del workspace.
- `pnpm run build` — comprobación y construcción de paquetes.
- `pnpm --filter @workspace/api-spec run codegen` — regenerar cliente y validadores desde `lib/api-spec/openapi.yaml`.
- `pnpm --filter @workspace/db run push` — sincronizar el esquema de la base de desarrollo, nunca producción.
- `pnpm --filter @workspace/db run generate` / `migrate` — crear y aplicar migraciones versionadas.
- `pnpm run test:phase0` — prueba real de API/PostgreSQL; exige que el asistente de configuración siga sin completar.
- `pnpm run test:password-change` — prueba del cambio desde la cuenta; exige `TEST_DATABASE_URL` de una base temporal vacía con el esquema aplicado y «test» en su nombre, distinta de `DATABASE_URL`.
- `python3 docs/reference/paquete-original/qa/validate_catalog.py config/pic_2026_2027_catalogo.json` — comprobar el catálogo original.

Variables mínimas de Replit: `DATABASE_URL` y `SESSION_SECRET` (mínimo 32 caracteres, guardado en Secrets).

## Estructura del proyecto

- `artifacts/innova-c2/` — interfaz React/Vite, configuración inicial, panel, gestión de usuarios y consulta/importación del catálogo.
- `artifacts/api-server/` — API Express, autenticación local y autorización por rol.
- `lib/api-spec/openapi.yaml` — contrato versionado en `/api/v1`.
- `lib/db/src/schema/` y `lib/db/drizzle/` — esquema PostgreSQL Drizzle y migraciones.
- `config/pic_2026_2027_catalogo.json` — catálogo PIC usado por instalación y prueba; su fuente original se conserva en `docs/reference/paquete-original/`.
- `docs/reference/paquete-original/` — contenido completo del ZIP recibido; no modificar para sustituir las fuentes.
- `scripts/` — instalación y mantenimiento de la versión independiente de Replit.

## Despliegue independiente

Requisitos: Ubuntu 22.04 o posterior, arquitectura compatible con Docker Engine, al menos 2 vCPU, 4 GB RAM y almacenamiento suficiente para documentos y copias. El instalador comprueba Ubuntu, instala Docker Compose v2 si falta, genera secretos locales con permisos `0600`, construye la imagen y arranca PostgreSQL y la aplicación:

```bash
chmod +x scripts/*.sh
sudo scripts/install.sh
```

La primera visita conduce a una configuración de un solo uso que crea centro, curso y primera cuenta `admin_tecnico`; no se crea ningún usuario o centro de muestra. La interfaz inicial está en `http://SERVIDOR:8080` según `APP_PORT`. Para producción, publicar detrás de un proxy inverso HTTPS, configurar `COOKIE_SECURE=true` y `TRUST_PROXY=1` solo si el proxy de confianza sobrescribe correctamente `X-Forwarded-*`. No exponer PostgreSQL a Internet.

Comandos:

```bash
docker compose up -d
docker compose down
scripts/backup.sh
scripts/restore.sh backups/AAAAMMDDTHHMMSSZ
scripts/migrate.sh
scripts/health.sh
docker compose logs --tail=100 -f
```

Las copias incluyen PostgreSQL y el volumen documental, cifrados con `BACKUP_ENCRYPTION_KEY`; conservan checksums. Guárdese esa clave fuera del servidor. La restauración reemplaza datos: pide confirmación escrita y debe hacerse después de crear una copia del estado actual. Retención y destino externo de las copias quedan bajo responsabilidad del centro.

## Seguridad y alcance por fases

- Sesiones opacas persistidas, contraseñas Argon2id, cookies HttpOnly/SameSite, token CSRF, caducidad y bloqueo persistente por intentos.
- RBAC comprobado en la API. Por indicación del usuario, `admin_tecnico` acumula los permisos de todos los roles, incluida coordinación C2, sin cambiar de cuenta ni suplantar identidades. Esta decisión sustituye la separación funcional inicial de la especificación; conserva el ámbito del centro, la auditoría, CSRF, los controles de integridad y el bloqueo de archivos en cuarentena.
- Catálogo importado a PostgreSQL con hash SHA-256, validación de 6 objetivos, 24 acciones, 31 indicadores y conservación de versiones previas.
- Se auditan altas, accesos y cambios de catálogo. No almacenar contraseñas en texto claro ni en logs.
- La aplicación no se integra con Laycos: prepara exportaciones/campos para entrega manual.
- Resend y la IA están desactivados; no enviar comunicaciones externas ni introducir proveedores externos hasta disponer de autorización, configuración y pruebas específicas.

Fase 0 cubre la base ejecutable, seguridad, centro/curso, catálogo y administración inicial. Los módulos de planificación PIC, gestión documental y demás fases deben completarse según la especificación antes de considerar la aplicación como entrega final.

## Fuentes y decisiones técnicas

- Por confirmación del usuario, el apartado 2 del PIC representa al conjunto del centro: desglose por familia profesional y totales del centro. No debe limitarse a la familia de la persona C2. Los datos antiguos no se reparten por inferencia y las versiones históricas permanecen inmutables.

Se mantiene el monorepo pnpm del proyecto (React/TypeScript, Express 5, PostgreSQL/Drizzle y OpenAPI/Orval) como alternativa equivalente al stack de referencia FastAPI, documentando la decisión para poder construir el mismo sistema con Docker sin servicios propios de Replit. El ZIP original y la captura de referencia se conservan en `docs/reference/paquete-original/` y `attached_assets/`.
