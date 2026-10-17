import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  Activity, BookOpen, Boxes, Building2, CalendarDays, ChevronDown, ClipboardList, FileCheck2,
  FolderKanban, LayoutDashboard, Lightbulb, Mail, Settings, ShieldCheck, Users, UsersRound, Landmark,
} from 'lucide-react';
import type { UserRole } from '@workspace/api-client-react';
import { buildNavModel, findGroupForLocation, type NavGroupId, type NavIconKey, type NavRouteDef } from './navigation-model';

const icons: Record<NavIconKey, ReactNode> = {
  panel: <LayoutDashboard size={18} />, pic: <FolderKanban size={18} />, innovation: <Lightbulb size={18} />,
  coordination: <UsersRound size={18} />, management: <Landmark size={18} />, account: <ShieldCheck size={18} />,
  'plan-pic': <ClipboardList size={16} />, actuaciones: <Activity size={16} />, seguimientos: <FileCheck2 size={16} />,
  catalogo: <BookOpen size={16} />, espacios: <Building2 size={16} />, productos: <Boxes size={16} />,
  ciclope: <Users size={16} />, comunicaciones: <Mail size={16} />, cursos: <CalendarDays size={16} />,
  usuarios: <Users size={16} />, configuracion: <Settings size={16} />,
};

interface Props {
  role: UserRole;
  location: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onExpand: () => void;
  onSelect: () => void;
}

export function SidebarNavigation({ role, location, collapsed, mobileOpen, onExpand, onSelect }: Props) {
  const model = buildNavModel(role);
  const activeGroup = findGroupForLocation(location);
  const [openGroup, setOpenGroup] = useState<NavGroupId | null>(activeGroup);
  useEffect(() => { if (activeGroup) setOpenGroup(activeGroup); }, [location, activeGroup]);
  const rail = collapsed && !mobileOpen;

  const link = (r: NavRouteDef, child = false) => (
    <Link key={r.href} href={r.href} className={`sidebar-link ${child ? 'sidebar-sublink' : ''} ${location === r.href ? 'active' : ''}`}
      aria-current={location === r.href ? 'page' : undefined} title={rail ? r.label : undefined} aria-label={r.label}
      onClick={onSelect} data-testid={r.testId}>
      {icons[r.icon]}<span className="sidebar-link-label">{r.label}</span>
    </Link>
  );

  return (
    <>
      <nav id="primary-navigation" className="workspace-nav" aria-label="Navegación principal">
        {model.top.map(r => link(r))}
        <div className="sidebar-groups">
          {model.groups.map(g => {
            const isActive = activeGroup === g.id;
            if (rail) {
              return (
                <button key={g.id} type="button" className={`sidebar-link sidebar-group-rail ${isActive ? 'active' : ''}`}
                  aria-expanded={false} aria-controls={`nav-group-${g.id}`}
                  title={g.label} aria-label={`${g.label}: abrir área`} data-testid={`button-nav-group-${g.id}`}
                  onClick={() => { setOpenGroup(g.id); onExpand(); }}>
                  {icons[g.icon]}<span className="sidebar-link-label">{g.label}</span>
                </button>
              );
            }
            const open = openGroup === g.id;
            const panelId = `nav-group-${g.id}`;
            return (
              <div key={g.id} className={`sidebar-group ${open ? 'is-open' : ''}`}>
                <button type="button" className={`sidebar-group-toggle ${isActive ? 'has-active' : ''}`} aria-expanded={open} aria-controls={panelId}
                  data-testid={`button-nav-group-${g.id}`} onClick={() => setOpenGroup(open ? null : g.id)}>
                  {icons[g.icon]}<span className="sidebar-link-label">{g.label}</span>
                  <ChevronDown size={15} className="sidebar-group-chevron" aria-hidden="true" />
                </button>
                <div id={panelId} className="sidebar-group-items" role="group" aria-label={g.label} hidden={!open}>
                  {g.items.map(r => link(r, true))}
                </div>
              </div>
            );
          })}
        </div>
      </nav>
      <div className="workspace-sidebar-bottom">
        {model.bottom.map(r => link(r))}
        {!rail && <p className="sidebar-role-badge" data-testid="text-sidebar-access"><ShieldCheck size={12} aria-hidden="true" />{role === 'admin_tecnico' ? 'Acceso completo' : 'Acceso por roles'}</p>}
      </div>
    </>
  );
}
