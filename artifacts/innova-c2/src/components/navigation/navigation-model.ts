import type { UserRole } from '@workspace/api-client-react';
import { hasCoordinationAccess } from '../../lib/role-access';

export type NavIconKey =
  | 'panel' | 'pic' | 'innovation' | 'coordination' | 'management' | 'account'
  | 'plan-pic' | 'actuaciones' | 'seguimientos' | 'catalogo' | 'espacios' | 'productos'
  | 'ciclope' | 'comunicaciones' | 'cursos' | 'usuarios' | 'configuracion';

export type NavGroupId = 'pic' | 'innovacion' | 'coordinacion' | 'gestion';

export interface NavRouteDef {
  href: string;
  label: string;
  icon: NavIconKey;
  testId: string;
  isVisible: (role: UserRole) => boolean;
}

export interface NavGroupDef {
  id: NavGroupId;
  label: string;
  icon: NavIconKey;
  items: readonly NavRouteDef[];
}

export interface NavModel {
  top: NavRouteDef[];
  groups: (Omit<NavGroupDef, 'items'> & { items: NavRouteDef[] })[];
  bottom: NavRouteDef[];
}

const always = () => true;
const activitiesRoles: readonly UserRole[] = ['admin_tecnico', 'c2_innovacion', 'coordinacion_red', 'jefatura_departamento', 'profesorado'];
const restrictedCommunicationRoles: readonly UserRole[] = ['consulta_c1', 'consulta_auditora'];

const route = (href: string, label: string, icon: NavIconKey, isVisible: (role: UserRole) => boolean): NavRouteDef => ({
  href, label, icon, isVisible, testId: `link-nav-${href === '/' ? 'panel' : href.slice(1)}`,
});

/** Visibility mirrors the original App.tsx sidebar conditions exactly. */
export const NAV_TOP: readonly NavRouteDef[] = [route('/', 'Panel principal', 'panel', always)];
export const NAV_BOTTOM: readonly NavRouteDef[] = [route('/cuenta', 'Mi cuenta', 'account', always)];
export const NAV_GROUPS: readonly NavGroupDef[] = [
  { id: 'pic', label: 'PIC y seguimiento', icon: 'pic', items: [
    route('/plan-pic', 'Plan PIC', 'plan-pic', hasCoordinationAccess),
    route('/actuaciones', 'Actuaciones y evidencias', 'actuaciones', role => activitiesRoles.includes(role)),
    route('/seguimientos', 'Seguimientos PIC', 'seguimientos', hasCoordinationAccess),
    route('/catalogo', 'Catálogo oficial', 'catalogo', always),
  ] },
  { id: 'innovacion', label: 'Innovación', icon: 'innovation', items: [
    route('/espacios', 'ATECA y FABLab', 'espacios', always),
    route('/productos', 'Productos propios', 'productos', always),
  ] },
  { id: 'coordinacion', label: 'Coordinación', icon: 'coordination', items: [
    route('/ciclope', 'Reuniones · CICLOPE', 'ciclope', always),
    route('/comunicaciones', 'Comunicaciones', 'comunicaciones', role => !restrictedCommunicationRoles.includes(role)),
  ] },
  { id: 'gestion', label: 'Gestión del centro', icon: 'management', items: [
    route('/cursos', 'Cursos académicos', 'cursos', hasCoordinationAccess),
    route('/usuarios', 'Usuarios y permisos', 'usuarios', role => role === 'admin_tecnico'),
    route('/configuracion', 'Configuración', 'configuracion', role => role === 'admin_tecnico'),
  ] },
];

/** All route definitions in display order. */
export function getAllNavRoutes(): NavRouteDef[] {
  return [...NAV_TOP, ...NAV_GROUPS.flatMap(g => g.items), ...NAV_BOTTOM];
}

/** Role-filtered model; empty groups removed. */
export function buildNavModel(role: UserRole): NavModel {
  return {
    top: NAV_TOP.filter(r => r.isVisible(role)),
    groups: NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(r => r.isVisible(role)) })).filter(g => g.items.length > 0),
    bottom: NAV_BOTTOM.filter(r => r.isVisible(role)),
  };
}

/** Flat list of hrefs visible to a role. */
export function getVisibleNavHrefs(role: UserRole): string[] {
  const m = buildNavModel(role);
  return [...m.top, ...m.groups.flatMap(g => g.items), ...m.bottom].map(r => r.href);
}

/** Group containing the location (exact match), or null for Panel/Mi cuenta/unknown. */
export function findGroupForLocation(location: string): NavGroupId | null {
  return NAV_GROUPS.find(g => g.items.some(i => i.href === location))?.id ?? null;
}
