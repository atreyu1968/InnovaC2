# Regresión de las comprobaciones manuales de IA

Desde la raíz del proyecto:

```sh
pnpm install --frozen-lockfile
pnpm run test:ai-provider-ui
pnpm run test:ai-provider-check
```

`test:ai-provider-ui` comprueba los tipos de los tests y ejecuta el componente
`AdminAIProviderConfiguration` y los hooks reales de `lib/api-client-react`
con React Testing Library, JSDOM y el ejecutor de pruebas de Node. No requiere
servidores, sesión, base de datos, claves ni configuración de IA. No es una
prueba de navegador completo ni verifica el diseño visual.

Todas las llamadas a `fetch` se interceptan. Solo se permiten la lectura de
ajustes ficticios y el POST de diagnóstico simulado; cualquier escritura de
ajustes u otra petición hace fallar la prueba, sin salir a la red.

Se verifica:

- Abrir, remontar con caché nueva (equivalente a recargar), refrescar los ajustes,
  recuperar el foco o reconectar no envía diagnósticos.
- Cada envío exige confirmar las muestras sintéticas; cancelar no envía nada.
- Durante una respuesta retenida, los botones quedan bloqueados y los clics
  repetidos no duplican el POST.
- El cuerpo contiene solo la revisión guardada y la confirmación sintética.
- HTTP 429 muestra el mensaje de espera del servidor con `Retry-After`.
- HTTP 500, errores de red y fallos de modelo no producen reintentos, tampoco
  al esperar, recuperar el foco o reconectar.
- Un proveedor desactivado o cambios sin guardar impiden comprobar.
- Los fallos de lectura solo se vuelven a consultar mediante la acción manual.
- El hook de diagnóstico desactiva los reintentos aunque el `QueryClient` o su
  llamador los habiliten. La configuración de Orval conserva esta protección al
  regenerar el cliente.

Los tiempos se adelantan con un reloj simulado, por encima de la espera del
servidor y del intervalo de reintentos. El componente se monta en `StrictMode`.
El tsconfig de pruebas incluye también el componente para transformarlo con
el mismo JSX automático que usa Vite.

`scripts/test-ai-provider-check.mjs` complementa esta suite: ejercita el router,
los permisos y CSRF, las cuotas y la concurrencia con un proveedor HTTP falso
y una base simulada. Ninguna de las dos suites usa un proveedor real ni cambia
los ajustes de la aplicación.
