# INNOVA-C2

Aplicación web para preparar y gestionar el Plan de Gestión de la Innovación
de Formación Profesional del centro. La documentación funcional y el catálogo
oficial del curso 2026–2027 se conservan en `docs/reference/paquete-original/`.

## Estado de las fases

- **Fase 0 — base y seguridad: implementada.** PostgreSQL persistente,
  autenticación real, control de permisos por rol, protección CSRF, auditoría,
  configuración inicial, importación versionada del catálogo y despliegue
  autónomo con Docker Compose.
- **Fase 1 — PIC 1–10: implementada y probada por API.** Editor del PIC,
  diagnóstico DAFO, inventario y selección de proyectos, ATECA, las seis
  acciones/indicadores oficiales, ODS, CICLOPE, calendario, difusión,
  validación, control de concurrencia, snapshots inmutables, exportación
  campo a campo para transcripción manual a Laycos y documentos DOCX/PDF.
  El justificante de presentación se conserva con hash SHA-256.
- **Fases posteriores: pendientes.** Gestión y distribución documental,
  circuitos completos de CICLOPE, comunicaciones reales por Resend, memoria,
  ATECA/FABLab y asistente IA se habilitarán según la especificación, con sus
  pruebas. No se sustituyen por envíos, respuestas o integraciones simuladas.

El PIC de 2024–2025 facilitado como referencia se ha resumido de forma
anonimizada en `docs/reference/pic-2024-25-aportes-anonimizados.md`. Sus
ejemplos son orientativos e históricos: no reemplazan el catálogo ni las reglas
oficiales de 2026–2027 y no se precargan en los planes de los centros.

## Arquitectura

- `artifacts/innova-c2`: interfaz React, Vite y TypeScript, con diseño adaptable
  inspirado en el portal de coordinación de referencia.
- `artifacts/api-server`: API REST Express, autenticación de sesión y reglas de
  negocio.
- `lib/db`: PostgreSQL y esquema/migraciones Drizzle.
- `lib/api-spec`: contrato OpenAPI; las validaciones Zod y el cliente React se
  generan desde ese contrato.
- `config/pic_2026_2027_catalogo.json`: catálogo PIC fuente de datos para las
  seis metas, 24 acciones, 31 indicadores y opciones dependientes.
- `scripts/` y `docker-compose.yml`: instalación, migraciones, copias cifradas,
  restauración y pruebas de fase.

Los documentos de presentación se generan en el servidor. Laycos no recibe
envíos automáticos: la aplicación prepara los campos ordenados y registra la
presentación manual con su justificante. Los archivos de evidencia se guardan
en el volumen persistente indicado por `DATA_DIR`.

## Instalación autónoma en Ubuntu / Proxmox

Requisitos: Ubuntu 22.04 o posterior, arquitectura compatible con Docker
Engine y permisos de `root` o `sudo`. El instalador instala Docker Engine y el
plugin Compose si faltan, genera secretos aleatorios en `.env` sin imprimirlos
y arranca PostgreSQL y la aplicación:

```bash
git clone https://github.com/atreyu1968/InnovaC2.git
cd InnovaC2
sudo ./scripts/install.sh
```

Abre `http://<servidor>:8080` (o el puerto definido por `APP_PORT`) y completa
la configuración inicial para crear el primer administrador técnico, centro y
curso. El servicio de PostgreSQL no publica su puerto fuera de la red interna de
Compose.

Antes de exponer el sistema a Internet, configura HTTPS en un proxy inverso
confiable y cambia `COOKIE_SECURE=true`. Activa `TRUST_PROXY=1` únicamente si
el proxy elimina y vuelve a establecer `X-Forwarded-*`. No publiques `.env`,
las claves de copia, los datos del volumen `postgres_data` ni los documentos
del volumen `documents_data`.

Operaciones:

```bash
docker compose ps
docker compose logs -f api
./scripts/migrate.sh
./scripts/backup.sh
```

`backup.sh` genera copias cifradas de la base de datos y de los documentos en
`backups/`; conserva `BACKUP_ENCRYPTION_KEY` fuera del servidor y por separado
de esas copias. `scripts/restore.sh` reemplaza los datos existentes: verifica
las sumas y conserva una copia previa, pero ejecútalo solo durante una
restauración planificada.

## Desarrollo y pruebas

El proyecto usa pnpm workspaces. Tras instalar dependencias y tener configurada
una base PostgreSQL de desarrollo:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
pnpm -w run typecheck
pnpm run test:phase0
pnpm run test:phase1
BASE_PATH=/ PORT=3000 pnpm -w run build
```

Las pruebas de fase 0 y 1 inicializan cuentas, centro y planes temporales en la
base real configurada, y los eliminan al terminar. Ejecútalas solo contra una
base de desarrollo aislada, nunca contra producción. `test:phase1` verifica
permisos, edición, validación oficial, concurrencia, snapshots, exportaciones
DOCX/PDF, salida Laycos y almacenamiento/descarga del justificante.

Variables de ejemplo: `.env.example`. La API sirve el frontend compilado y
responde en `/api/v1/health`.
