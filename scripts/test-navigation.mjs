import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require(require.resolve("esbuild", { paths: [`${root}artifacts/api-server`] }));
const compiled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { Router } from 'wouter';
      import { SidebarNavigation } from './src/components/navigation/SidebarNavigation';
      export * from './src/components/navigation/navigation-model';
      export function render(role, location, collapsed, mobileOpen) {
        return renderToStaticMarkup(React.createElement(Router, { ssrPath: location }, React.createElement(SidebarNavigation, {
          role, location, collapsed, mobileOpen, onExpand() {}, onSelect() {}
        })));
      }
    `,
    resolveDir: `${root}artifacts/innova-c2`,
    loader: "tsx",
  },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, logLevel: "silent",
});
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
  createRequire(`${root}artifacts/innova-c2/package.json`), loaded, loaded.exports,
);
const { buildNavModel, getAllNavRoutes, getVisibleNavHrefs, findGroupForLocation, render } = loaded.exports;
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const roles = ["admin_tecnico", "c2_innovacion", "coordinacion_red", "jefatura_departamento",
  "profesorado", "equipo_directivo", "consulta_c1", "consulta_auditora"];
const all = getAllNavRoutes();
equal(all.length, 13);
equal(new Set(all.map(r => r.href)).size, 13);
const memberships = {
  pic: ["/plan-pic", "/actuaciones", "/seguimientos", "/catalogo"],
  innovacion: ["/espacios", "/productos"],
  coordinacion: ["/ciclope", "/comunicaciones"],
  gestion: ["/cursos", "/usuarios", "/configuracion"],
};
for (const [group, paths] of Object.entries(memberships)) {
  for (const path of paths) equal(findGroupForLocation(path), group);
}
for (const path of ["/", "/cuenta", "/no-existe"]) equal(findGroupForLocation(path), null);
for (const role of roles) {
  // Independent baseline: precisely the visibility conditions of the original flat sidebar.
  const expected = ["/", "/ciclope", "/espacios", "/productos", "/catalogo", "/cuenta"];
  if (!["consulta_c1", "consulta_auditora"].includes(role)) expected.push("/comunicaciones");
  if (["admin_tecnico", "c2_innovacion"].includes(role)) expected.push("/plan-pic", "/seguimientos", "/cursos");
  if (["admin_tecnico", "c2_innovacion", "coordinacion_red", "jefatura_departamento", "profesorado"].includes(role)) expected.push("/actuaciones");
  if (role === "admin_tecnico") expected.push("/usuarios", "/configuracion");
  equal(getVisibleNavHrefs(role).sort(), expected.sort());
  const model = buildNavModel(role);
  equal(model.top.map(r => r.href), ["/"]);
  equal(model.bottom.map(r => r.href), ["/cuenta"]);
  equal(model.groups.every(g => g.items.length > 0), true);
  equal(model.groups.some(g => g.id === "gestion"), ["admin_tecnico", "c2_innovacion"].includes(role));
  for (const group of model.groups) {
    equal(group.items.map(r => r.href), memberships[group.id].filter(p => expected.includes(p)));
  }
  const compact = render(role, "/productos", true, false);
  equal((compact.match(/data-testid="link-nav-/g) ?? []).length, 2);
  equal((compact.match(/data-testid="button-nav-group-/g) ?? []).length, model.groups.length);
  equal(compact.includes('data-testid="link-nav-productos"'), false);
  const expanded = render(role, "/productos", false, false);
  equal((expanded.match(/aria-expanded="true"/g) ?? []).length, 1);
  equal((expanded.match(/aria-current="page"/g) ?? []).length, 1);
  equal((expanded.match(/hidden=""/g) ?? []).length, model.groups.length - 1);
  const mobile = render(role, "/productos", true, true);
  equal((mobile.match(/aria-expanded="true"/g) ?? []).length, 1);
  equal(mobile.includes('data-testid="link-nav-productos"'), true);
  equal(mobile.includes('data-testid="text-sidebar-access"'), true);
}
equal((render("admin_tecnico", "/", false, false).match(/aria-expanded="true"/g) ?? []).length, 0);
console.log(`PASS: ${checks} comprobaciones de navegación: 13 accesos, permisos de 8 perfiles y estructura contraída/desplegada/móvil renderizada con React.`);
