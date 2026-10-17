import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BrandMark } from './components/BrandMark';
import { CommunicationsPage } from './components/CommunicationsPage';
import { AdminConfigurationPage } from './components/AdminConfigurationPage';
import { hasCoordinationAccess } from './lib/role-access';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight,
  CalendarDays, CircleHelp, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Menu,
  Mail, RefreshCw, Settings, ShieldCheck, Users, X,
} from 'lucide-react';
import {
  UserRole, getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey,
  getGetSetupStatusQueryKey, getGetCurrentCatalogQueryKey, getListUsersQueryKey,
  getHealthCheckQueryKey, useHealthCheck, useGetSetupStatus, useInitializeSetup, useLogin, useLogout,
  useGetCurrentUser, useGetDashboardSummary, useListUsers, useCreateUser,
  useGetCurrentCatalog, useImportCatalog, setCsrfToken,
  useRequestPasswordReset, useCompletePasswordReset,
} from '@workspace/api-client-react';
import type { UserRole as UserRoleValue, User, PicDafoCategory, CatalogImportInput } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PicPlanPage } from '@/components/PicPlanPage';
import { ActivitiesPhaseTwo } from '@/components/ActivitiesPhaseTwo';
import { UserFamilyAssignment } from '@/components/UserFamilyAssignment';
import { AccountPage } from '@/components/AccountPage';
import { SchoolYearsPage } from '@/components/SchoolYearsPage';
import { CiclopePage } from '@/components/CiclopePage';

const loginTeamPhoto = new URL('./assets/innova-c2-login-team.jpg', import.meta.url).href;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true } },
});

const roleNames: Record<UserRoleValue, string> = {
  admin_tecnico: 'Administración técnica',
  c2_innovacion: 'Coordinación C2 de innovación',
  equipo_directivo: 'Equipo directivo',
  coordinacion_red: 'Coordinación de red',
  jefatura_departamento: 'Jefatura de departamento',
  profesorado: 'Profesorado',
  consulta_c1: 'Consulta C1',
  consulta_auditora: 'Consulta auditora',
};

const routeLabels: Record<string, string> = {
  '/cuenta': 'Mi cuenta',
  '/cursos': 'Cursos académicos',
  '/': 'Panel de coordinación', '/usuarios': 'Gestión de usuarios', '/configuracion': 'Configuración técnica', '/comunicaciones': 'Comunicaciones institucionales', '/catalogo': 'Catálogo oficial', '/plan-pic': 'Plan de Innovación del Centro', '/actuaciones': 'Actuaciones y evidencias', '/ciclope': 'CICLOPE · reuniones y actas',
};
const restrictedCommunicationRoles: readonly UserRoleValue[] = [UserRole.consulta_c1, UserRole.consulta_auditora];

function messageFor(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'No se ha podido completar la solicitud. Inténtalo de nuevo.';
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Routed />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Routed() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/setup" component={SetupPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/usuarios"><ProtectedPage page="users" /></Route>
        <Route path="/configuracion"><ProtectedPage page="configuration" /></Route>
        <Route path="/comunicaciones"><ProtectedPage page="communications" /></Route>
        <Route path="/cuenta"><ProtectedPage page="account" /></Route>
        <Route path="/cursos"><ProtectedPage page="years" /></Route>
        <Route path="/catalogo"><ProtectedPage page="catalog" /></Route>
        <Route path="/plan-pic"><ProtectedPage page="pic" /></Route>
        <Route path="/ciclope"><ProtectedPage page="ciclope" /></Route>
        <Route path="/actuaciones"><ProtectedPage page="activities" /></Route>
        <Route path="/"><ProtectedPage page="dashboard" /></Route>
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function ProtectedPage({ page }: { page: 'dashboard' | 'users' | 'configuration' | 'communications' | 'catalog' | 'pic' | 'activities' | 'account' | 'years' | 'ciclope' }) {
  const [, setLocation] = useLocation();
  const status = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: false } });
  const current = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false, refetchOnMount: 'always' },
  });

  useEffect(() => {
    if (status.data && !status.data.initialized) setLocation('/setup');
  }, [status.data, setLocation]);
  useEffect(() => {
    if (current.isError && status.data?.initialized) setLocation('/login');
  }, [current.isError, status.data, setLocation]);
  useEffect(() => {
    if (current.data?.csrfToken) setCsrfToken(current.data.csrfToken);
  }, [current.data]);

  if (status.isLoading || current.isLoading || !status.data?.initialized || !current.data) {
    return <LoadingScreen label="Preparando el espacio de coordinación" />;
  }
  if (current.isError) return <LoadingScreen label="Redirigiendo al acceso" />;
  if (page === 'years' && !hasCoordinationAccess(current.data.user.role)) return <NotFound />;
  if (page === 'configuration' && current.data.user.role !== UserRole.admin_tecnico) return <NotFound />;
  if (page === 'communications' && restrictedCommunicationRoles.includes(current.data.user.role)) return <NotFound />;
  if (
    page === 'activities' &&
    ![
      UserRole.admin_tecnico,
      UserRole.c2_innovacion,
      UserRole.coordinacion_red,
      UserRole.jefatura_departamento,
      UserRole.profesorado,
    ].some(role => role === current.data.user.role)
  ) {
    return <NotFound />;
  }
  return (
    <Workspace user={current.data.user}>
      {page === 'communications' ? <CommunicationsPage userId={current.data.user.id} /> : page === 'configuration' ? <AdminConfigurationPage /> : page === 'ciclope' ? <CiclopePage user={current.data.user} /> : page === 'years' ? <SchoolYearsPage /> : page === 'account' ? <AccountPage user={current.data.user} /> : page === 'dashboard' ? <DashboardPage user={current.data.user} /> :
        page === 'users' ? <UsersPage /> : page === 'catalog' ? <CatalogPage user={current.data.user} /> : page === 'pic' ? <PicPlanPage user={current.data.user} /> : <ActivitiesPhaseTwo user={current.data.user} />}
    </Workspace>
  );
}

function Workspace({ user, children }: { user: User; children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [, setLocation] = useLocation();
  const logout = useLogout();
  const client = useQueryClient();
  const label = routeLabels[location] ?? 'Espacio de coordinación';
  const signOut = () => logout.mutate(undefined, {
    onSuccess: () => {
      setCsrfToken(null);
      client.clear();
      setLocation('/login');
    },
  });
  return (
    <div className="app-shell">
      <header className="workspace-header">
        <button className="workspace-menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir navegación" aria-controls="primary-navigation" aria-expanded={mobileOpen} data-testid="button-open-navigation"><Menu size={20} /></button>
        <div className="workspace-brand">
          <BrandMark className="shrink-0" />
          <div className="min-w-0"><p className="workspace-brand-name">INNOVA-C2</p><p className="workspace-brand-school">IES Manuel Martín González</p></div>
        </div>
        <div className="workspace-account">
          <div className="workspace-avatar" aria-hidden="true">{user.name.split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase()}</div>
          <div className="workspace-account-copy"><p className="truncate text-xs font-bold" data-testid="text-current-user">{user.name}</p><p className="truncate text-[10px]">{roleNames[user.role]}</p></div>
          <button onClick={signOut} disabled={logout.isPending} title="Cerrar sesión" aria-label="Cerrar sesión" className="workspace-logout" data-testid="button-logout"><LogOut size={16} /><span className="hidden sm:inline">{logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}</span></button>
        </div>
      </header>
      <div className="workspace-body">
        {mobileOpen && <button aria-label="Cerrar navegación" className="workspace-scrim" onClick={() => setMobileOpen(false)} data-testid="button-close-navigation" />}
        <aside className={`workspace-sidebar ${mobileOpen ? 'is-mobile-open' : ''} ${collapsed ? 'is-collapsed' : 'is-expanded'}`} aria-label="Navegación del espacio">
          <div className="workspace-sidebar-mobile-head">
            <span className="eyebrow">Coordinación</span>
            <button className="workspace-close-menu" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" data-testid="button-close-menu"><X size={18} /></button>
          </div>
          <nav id="primary-navigation" className="workspace-nav" aria-label="Navegación principal">
            <NavItem href="/" active={location === '/'} icon={<LayoutDashboard size={18} />} label="Panel principal" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />
            {user.role === UserRole.admin_tecnico && <NavItem href="/usuarios" active={location === '/usuarios'} icon={<Users size={18} />} label="Usuarios y permisos" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />}
            {user.role === UserRole.admin_tecnico && <NavItem href="/configuracion" active={location === '/configuracion'} icon={<Settings size={18} />} label="Configuración" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />}
            {!restrictedCommunicationRoles.includes(user.role) && <NavItem href="/comunicaciones" active={location === '/comunicaciones'} icon={<Mail size={18} />} label="Comunicaciones" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />}
            {hasCoordinationAccess(user.role) && <NavItem href="/plan-pic" active={location === '/plan-pic'} icon={<ClipboardList size={18} />} label="Plan PIC" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />}
            {hasCoordinationAccess(user.role) && <NavItem href="/cursos" active={location === '/cursos'} icon={<CalendarDays size={18} />} label="Cursos académicos" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />}
            {[UserRole.admin_tecnico, UserRole.c2_innovacion, UserRole.coordinacion_red, UserRole.jefatura_departamento, UserRole.profesorado].some(role => role === user.role) && <NavItem href="/actuaciones" active={location === '/actuaciones'} icon={<Activity size={18} />} label="Actuaciones y evidencias" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />}
            <NavItem href="/ciclope" active={location === '/ciclope'} icon={<Users size={18} />} label="CICLOPE" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />
            <NavItem href="/catalogo" active={location === '/catalogo'} icon={<BookOpen size={18} />} label="Catálogo oficial" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />
            <NavItem href="/cuenta" active={location === '/cuenta'} icon={<ShieldCheck size={18} />} label="Mi cuenta" collapsed={collapsed} onSelect={() => setMobileOpen(false)} />
          </nav>
          <div className="workspace-sidebar-bottom">
            {!collapsed && <div className="workspace-role-note"><div className="flex items-center gap-2 text-[11px] font-bold"><ShieldCheck size={15} />{user.role === UserRole.admin_tecnico ? 'Acceso completo del centro' : 'Acceso por roles'}</div><p className="mt-1.5 text-[10px] leading-relaxed">{user.role === UserRole.admin_tecnico ? 'Incluye las funciones de todos los roles. Las intervenciones se registran con tu identidad.' : 'Cada cuenta dispone únicamente de los permisos asignados.'}</p></div>}
          </div>
        </aside>
        <button className="workspace-collapse-button" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expandir navegación' : 'Contraer navegación'} aria-controls="primary-navigation" aria-expanded={!collapsed} title={collapsed ? 'Expandir navegación' : 'Contraer navegación'} data-testid="button-collapse-navigation"><ChevronRight size={18} className={collapsed ? '' : 'rotate-180'} /><span className="sr-only">{collapsed ? 'Expandir navegación' : 'Contraer navegación'}</span></button>
        <main className="workspace-main">
          <div className="workspace-content" data-page={location}>
            {location !== '/' && <div className="workspace-page-heading"><h1 data-testid="text-page-title">{label}</h1><p>IES Manuel Martín González · Espacio de coordinación</p></div>}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ href, active, icon, label, collapsed, onSelect }: { href: string; active: boolean; icon: ReactNode; label: string; collapsed: boolean; onSelect: () => void }) {
  return <Link href={href} className={`sidebar-link ${active ? 'active' : ''}`} title={collapsed ? label : undefined} aria-label={label} onClick={onSelect} data-testid={`link-nav-${href === '/' ? 'panel' : href.slice(1)}`}>{icon}<span className="sidebar-link-label">{label}</span></Link>;
}

function DashboardPage({ user }: { user: User }) {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchOnMount: 'always' } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: false, refetchInterval: 60_000 } });
  const summaryData = summary.data;
  return (
    <div className="dashboard-page fade-up">
      <section className="dashboard-heading">
        <div><h1 data-testid="text-page-title">Panel Principal</h1><p>Bienvenido/a, {user.name}. Ámbito del centro educativo.</p></div>
        <div className={`dashboard-health ${health.isError ? 'is-error' : ''}`} data-testid="status-api-health"><span className="health-dot" />{health.isLoading ? 'Comprobando servicio' : health.isError ? 'Servicio no disponible' : `Servicio ${health.data?.status ?? 'sin estado'}`}</div>
      </section>
      {summary.isLoading ? <SummarySkeleton /> : summary.isError ? <ErrorNotice text={messageFor(summary.error)} onRetry={() => summary.refetch()} /> : summaryData ? <>
        <section className="dashboard-metrics" aria-label="Resumen del centro">
          <MetricTile label="Cuentas de usuario" value={summaryData.userCount} detail="Cuentas registradas" icon={<Users size={17} />} testId="metric-users" />
          <MetricTile label="Objetivos oficiales" value={summaryData.objectiveCount} detail="Catálogo oficial" icon={<GraduationCap size={17} />} testId="metric-objectives" />
          <MetricTile label="Acciones oficiales" value={summaryData.actionCount} detail="Acciones del catálogo" icon={<ClipboardList size={17} />} testId="metric-actions" />
          <MetricTile label="Indicadores" value={summaryData.indicatorCount} detail="Indicadores asociados" icon={<Activity size={17} />} testId="metric-indicators" />
          <MetricTile label="Curso escolar" value={summaryData.schoolYear} detail="Curso activo del centro" icon={<GraduationCap size={17} />} testId="metric-school-year" />
          <MetricTile label="Versión del catálogo" value={summaryData.catalogVersion} detail="Referencia oficial PIC" icon={<BookOpen size={17} />} testId="metric-catalog-version" />
        </section>
        <section className="dashboard-panels">
          <div className="panel institution-panel p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Datos del centro</p><h3 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold">Configuración institucional</h3></div><span className="rounded-full bg-[#e7f1eb] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#31745e]">Activa</span></div>
            <div className="mt-5 grid gap-x-8 gap-y-4 border-t border-[#eee9df] pt-5 sm:grid-cols-2">
              <Definition label="Centro educativo" value={summaryData.centerName} testId="value-center-name" />
              <Definition label="Curso escolar" value={summaryData.schoolYear} testId="value-school-year" />
              <Definition label="Versión del catálogo" value={summaryData.catalogVersion} testId="value-catalog-version" />
              <Definition label="Sesión actual" value={roleNames[user.role]} testId="value-current-role" />
            </div>
          </div>
          <div className="panel flex flex-col p-5 md:p-6">
            <p className="eyebrow">Accesos de gestión</p><h3 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold">Herramientas del espacio</h3>
            <div className="mt-4 divide-y divide-[#eee9df]">
              {user.role === UserRole.admin_tecnico && <QuickLink href="/usuarios" icon={<Users size={17} />} title="Usuarios y permisos" text="Gestiona cuentas y roles de acceso" />}
              <QuickLink href="/catalogo" icon={<BookOpen size={17} />} title="Catálogo oficial" text="Consulta objetivos, acciones e indicadores" />
            </div>
            <div className="mt-auto flex items-center gap-2 pt-5 text-[11px] text-[#77817c]"><ShieldCheck size={14} /> Datos persistidos del centro</div>
          </div>
        </section>
      </> : <EmptyNotice title="Sin resumen disponible" text="Todavía no hay datos del centro para mostrar." />}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5dfd2] pt-4 text-[10px] tracking-wide text-[#7d8580]"><span>INNOVA-C2 · Coordinación educativa</span><span>Cuenta: {user.email}</span></footer>
    </div>
  );
}

function MetricTile({ label, value, detail, icon, testId }: { label: string; value: number | string; detail: string; icon: ReactNode; testId: string }) {
  return <article className="panel metric-tile"><div className="metric-tile-top"><span className="eyebrow !tracking-[.08em]">{label}</span><span className="metric-icon">{icon}</span></div><p className="metric-value" data-testid={testId}>{value}</p><p className="metric-detail">{detail}</p></article>;
}
function Definition({ label, value, testId }: { label: string; value: string; testId: string }) {
  return <div><p className="text-[11px] text-[#7c8580]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[#34444a]" data-testid={testId}>{value}</p></div>;
}
function QuickLink({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return <Link href={href} className="group flex items-center gap-3 py-4 text-left no-underline"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef2ec] text-[#347b69]">{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[#34444a]">{title}</span><span className="mt-0.5 block text-[11px] text-[#7b8580]">{text}</span></span><ArrowRight size={16} className="text-[#8b9690] transition-transform group-hover:translate-x-1" /></Link>;
}

function UsersPage() {
  const client = useQueryClient();
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey(), refetchOnMount: 'always' } });
  const catalog = useGetCurrentCatalog({ query: { queryKey: getGetCurrentCatalogQueryKey(), retry: false } });
  const create = useCreateUser();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRoleValue>(UserRole.profesorado);
  const familyRequired = [UserRole.profesorado, UserRole.jefatura_departamento, UserRole.coordinacion_red].some(role => role === selectedRole);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSuccess('');
    const formElement = event.currentTarget;
    const form = new FormData(event.currentTarget);
    const professionalFamily = String(form.get('professionalFamily') ?? '').trim();
    const data = { email: String(form.get('email')).trim(), name: String(form.get('name')).trim(), role: String(form.get('role')) as UserRoleValue, temporaryPassword: String(form.get('temporaryPassword')), professionalFamily: professionalFamily || null };
    create.mutate({ data }, {
      onSuccess: created => {
        client.setQueryData<User[]>(getListUsersQueryKey(), old => old ? [created, ...old] : [created]);
        setSuccess(`La cuenta de ${created.name} se ha creado correctamente.`);
        formElement.reset();
        setSelectedRole(UserRole.profesorado);
      },
      onError: issue => setError(messageFor(issue)),
    });
  };
  return <div className="fade-up space-y-6">
    <PageIntro eyebrow="Administración de acceso" title="Usuarios y permisos" description="Crea cuentas para el equipo y revisa el rol asignado a cada persona." />
    <div className="grid items-start gap-5 xl:grid-cols-[.85fr_1.4fr]">
      <section className="panel p-5 md:p-6">
        <div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eaf1eb] text-[#347b69]"><Users size={18} /></span><div><p className="eyebrow">Nueva cuenta</p><h2 className="font-[var(--app-font-serif)] text-base font-bold">Añadir usuario</h2></div></div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="Nombre completo" id="user-name"><input id="user-name" name="name" className="field" required maxLength={160} autoComplete="name" data-testid="input-user-name" /></Field>
          <Field label="Correo electrónico" id="user-email"><input id="user-email" name="email" type="email" className="field" required autoComplete="email" data-testid="input-user-email" /></Field>
          <Field label="Rol de acceso" id="user-role"><select id="user-role" name="role" className="field" value={selectedRole} onChange={event => setSelectedRole(event.target.value as UserRoleValue)} data-testid="select-user-role">{Object.entries(roleNames).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></Field>
          <Field label="Familia profesional" id="user-family"><select id="user-family" name="professionalFamily" className="field" required={familyRequired} defaultValue="" data-testid="select-user-family"><option value="">Selecciona una familia</option>{catalog.data?.familias_profesionales.map(family => <option key={family} value={family}>{family}</option>)}</select>{familyRequired && <span className="mt-1 block text-[10px] text-[#77817c]">Necesaria para limitar las actuaciones al ámbito de esta cuenta.</span>}{catalog.isError && <span className="mt-1 block text-[10px] text-[#9b4337]">No se han podido cargar las familias del catálogo oficial.</span>}</Field>
          <Field label="Contraseña temporal" id="user-password"><input id="user-password" name="temporaryPassword" type="password" className="field" required minLength={12} autoComplete="new-password" data-testid="input-user-password" /><span className="mt-1 block text-[10px] text-[#77817c]">Mínimo 12 caracteres.</span></Field>
          {error && <InlineAlert text={error} kind="error" />}
          {success && <InlineAlert text={success} kind="success" />}
          <button type="submit" className="primary-action w-full" disabled={create.isPending} data-testid="button-create-user">{create.isPending ? 'Creando cuenta…' : 'Crear cuenta'}</button>
        </form>
      </section>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9df] px-5 py-4 md:px-6"><div><p className="eyebrow">Acceso al espacio</p><h2 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold">Cuentas registradas</h2></div><button className="quiet-action flex items-center gap-2" onClick={() => users.refetch()} disabled={users.isFetching} data-testid="button-refresh-users"><RefreshCw size={14} className={users.isFetching ? 'animate-spin' : ''} />Actualizar</button></div>
         {users.isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(n => <div key={n} className="skeleton h-12" />)}</div> : users.isError ? <div className="p-6"><ErrorNotice text={messageFor(users.error)} onRetry={() => users.refetch()} /></div> : users.data?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-[#f7f5ef] text-[10px] uppercase tracking-wider text-[#7b8580]"><tr><th className="px-5 py-3 font-bold">Persona</th><th className="px-4 py-3 font-bold">Rol</th><th className="px-4 py-3 font-bold">Familia profesional</th><th className="px-4 py-3 font-bold">Estado</th><th className="px-4 py-3 font-bold">Alta</th></tr></thead><tbody className="divide-y divide-[#eee9df]">{users.data.map(person => <tr key={person.id} data-testid={`row-user-${person.id}`}><td className="px-5 py-3.5"><p className="text-sm font-bold text-[#34444a]" data-testid={`text-user-name-${person.id}`}>{person.name}</p><p className="mt-0.5 text-[11px] text-[#7b8580]">{person.email}</p></td><td className="px-4 py-3.5 text-xs text-[#53615c]">{roleNames[person.role]}</td><td className="px-4 py-3.5 text-xs text-[#53615c]"><UserFamilyAssignment key={`${person.id}-${person.professionalFamily}`} person={person} families={catalog.data?.familias_profesionales ?? []} /></td><td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${person.active ? 'text-[#347b69]' : 'text-[#838783]'}`}><span className={`h-1.5 w-1.5 rounded-full ${person.active ? 'bg-[#58a47e]' : 'bg-[#a8aaa4]'}`} />{person.active ? 'Activa' : 'Inactiva'}</span></td><td className="px-4 py-3.5 text-xs text-[#6f7974]">{formatDate(person.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyNotice title="No hay cuentas adicionales" text="Cuando se creen usuarios, aparecerán aquí con su rol y estado." />}
        <div className="border-t border-[#eee9df] px-5 py-3 md:px-6"><button className="flex items-center gap-2 text-xs font-semibold text-[#52625d] hover:text-[#347b69]" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} data-testid="button-toggle-roles"><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />{expanded ? 'Ocultar' : 'Revisar'} matriz de roles</button>
          {expanded && <div className="mt-3 grid gap-2 border-t border-[#eee9df] pt-3 sm:grid-cols-2">{Object.entries(roleNames).map(([role, title]) => <div key={role} className="flex items-start gap-2 rounded-md bg-[#f7f5ef] p-2.5" data-testid={`role-${role}`}><ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#347b69]" /><div><p className="text-xs font-bold text-[#405057]">{title}</p><p className="mt-0.5 font-mono text-[9px] text-[#84908a]">{role}</p></div></div>)}</div>}
        </div>
      </section>
    </div>
  </div>;
}

function CatalogPage({ user }: { user: User }) {
  const client = useQueryClient();
  const catalog = useGetCurrentCatalog({ query: { queryKey: getGetCurrentCatalogQueryKey(), refetchOnMount: 'always' } });
  const importCatalog = useImportCatalog();
  const [search, setSearch] = useState('');
  const [openCodes, setOpenCodes] = useState<string[]>([]);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [importing, setImporting] = useState(false);
  const data = catalog.data;
  const dafoGroups = data
    ? Object.entries(data.dafo_categorias) as [string, PicDafoCategory[]][]
    : [];
  const handleCatalogFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setImportError('');
    setImportSuccess('');
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text()) as CatalogImportInput['catalog'];
      importCatalog.mutate({ data: { catalog: parsed } }, {
        onSuccess: async result => {
          setImportSuccess(`Catálogo ${result.version} importado. ${result.objectiveCount} objetivos, ${result.actionCount} acciones y ${result.indicatorCount} indicadores.`);
          await Promise.all([
            catalog.refetch(),
            client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
          ]);
          setImporting(false);
        },
        onError: issue => {
          setImportError(messageFor(issue));
          setImporting(false);
        },
      });
    } catch {
      setImportError('El archivo no contiene un JSON válido.');
      setImporting(false);
    }
  };
  const filteredObjectives = data?.objetivos.filter(obj => !search || `${obj.codigo} ${obj.titulo} ${obj.acciones.map(a => `${a.codigo} ${a.titulo} ${a.indicadores.map(i => `${i.id} ${i.descripcion}`).join(' ')}`).join(' ')}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <div className="fade-up space-y-6">
    <PageIntro eyebrow="Referencia institucional" title="Catálogo oficial" description="Consulta la estructura vigente de objetivos, acciones e indicadores del programa." />
    {user.role === UserRole.admin_tecnico && <section className="panel flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div><p className="eyebrow">Administración del catálogo</p><h2 className="mt-1 font-[var(--app-font-serif)] text-base font-bold">Importar una versión oficial</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#6e7974]">El servidor valida la estructura y conserva las versiones anteriores. Solo se activa una versión nueva si el JSON cumple las comprobaciones del PIC.</p>
        {importError && <div className="mt-3"><InlineAlert text={importError} kind="error" /></div>}
        {importSuccess && <div className="mt-3"><InlineAlert text={importSuccess} kind="success" /></div>}
      </div>
      <label className={`primary-action shrink-0 cursor-pointer text-center ${importing ? 'pointer-events-none opacity-60' : ''}`} data-testid="button-import-catalog">{importing ? 'Validando e importando…' : 'Seleccionar JSON oficial'}<input type="file" accept=".json,application/json" className="sr-only" disabled={importing} onChange={handleCatalogFile} data-testid="input-import-catalog" /></label>
    </section>}
    {catalog.isLoading ? <CatalogSkeleton /> : catalog.isError ? <ErrorNotice text={messageFor(catalog.error)} onRetry={() => catalog.refetch()} /> : data ? <>
      <section className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl bg-[#263c42] p-5 text-white md:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow text-[#9bc7b5]">Catálogo de referencia</p><h2 className="mt-2 font-[var(--app-font-serif)] text-2xl font-bold">PIC · {data.version}</h2><p className="mt-1 text-xs text-[#c4d1ce]">Estado: {data.estado}</p></div><span className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold text-[#dbe8df]" data-testid="catalog-state">{data.estado}</span></div><div className="mt-5 grid gap-3 border-t border-white/15 pt-4 sm:grid-cols-2"><div><p className="text-[10px] uppercase tracking-wider text-[#a6b8b3]">Fecha de corte</p><p className="mt-1 text-sm font-semibold" data-testid="catalog-cutoff">{data.fecha_corte}</p></div><div><p className="text-[10px] uppercase tracking-wider text-[#a6b8b3]">Fuente</p><p className="mt-1 break-words text-sm font-semibold" data-testid="catalog-source">{data.fuente}</p></div></div></div>
        <div className="grid grid-cols-2 gap-3"><CatalogCount label="Objetivos" value={data.objetivos.length} /><CatalogCount label="Acciones" value={data.objetivos.reduce((n, o) => n + o.acciones.length, 0)} /><CatalogCount label="Indicadores" value={data.objetivos.reduce((n, o) => n + o.acciones.reduce((m, a) => m + a.indicadores.length, 0), 0)} /><CatalogCount label="Familias profesionales" value={data.familias_profesionales.length} /></div>
      </section>
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eee9df] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6"><div><p className="eyebrow">Estructura del programa</p><h2 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold">Objetivos y acciones oficiales</h2></div><label className="relative block sm:w-[280px]"><span className="sr-only">Buscar en el catálogo</span><input className="field !min-h-[38px] !py-2 text-xs" type="search" placeholder="Buscar objetivo, acción o indicador" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-catalog-search" /></label></div>
        {filteredObjectives?.length ? <div className="divide-y divide-[#eee9df]">{filteredObjectives.map(obj => {
          const open = openCodes.includes(obj.codigo);
          return <article key={obj.codigo} data-testid={`catalog-objective-${obj.codigo}`}>
            <button className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#faf9f5] md:px-6" onClick={() => setOpenCodes(open ? openCodes.filter(code => code !== obj.codigo) : [...openCodes, obj.codigo])} aria-expanded={open} data-testid={`button-objective-${obj.codigo}`}><span className="grid h-8 w-12 shrink-0 place-items-center rounded-md bg-[#eaf1eb] font-mono text-xs font-bold text-[#347b69]">{obj.codigo}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[#34444a]">{obj.titulo}</span><span className="mt-1 block text-[10px] text-[#7b8580]">{obj.acciones.length} acciones oficiales</span></span><ChevronDown size={16} className={`shrink-0 text-[#77817c] transition-transform ${open ? 'rotate-180' : ''}`} /></button>
            {open && <div className="space-y-3 bg-[#f8f6f0] px-4 pb-4 md:px-6 md:pl-[92px]">{obj.acciones.map(action => <div key={action.codigo} className="rounded-lg border border-[#e6e1d7] bg-[#fffefa] p-4" data-testid={`catalog-action-${action.codigo}`}><div className="flex flex-wrap items-start gap-2"><span className="font-mono text-[11px] font-bold text-[#347b69]">{action.codigo}</span><h3 className="min-w-[180px] flex-1 text-xs font-bold leading-relaxed text-[#35464b]">{action.titulo}</h3><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${action.obligatoria ? 'bg-[#f3e7d5] text-[#8a6234]' : 'bg-[#edf0eb] text-[#68746e]'}`}>{action.obligatoria ? 'Obligatoria' : 'No obligatoria'}</span></div>
              {action.indicadores.length > 0 ? <div className="mt-3 border-t border-[#eee9df] pt-3"><p className="eyebrow !text-[9px]">Indicadores asociados</p><div className="mt-2 grid gap-2 md:grid-cols-2">{action.indicadores.map(ind => <div key={ind.id} className="rounded-md bg-[#f8f6f0] p-3" data-testid={`catalog-indicator-${ind.id}`}><div className="flex items-start justify-between gap-2"><span className="font-mono text-[10px] font-bold text-[#347b69]">{ind.id}</span><span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-[#67736d]">{ind.tipo.replaceAll('_', ' ')}</span></div><p className="mt-1.5 text-xs font-semibold leading-relaxed text-[#46554f]">{ind.descripcion}</p>{ind.minimo_normativo !== null && <p className="mt-1 text-[10px] text-[#7b8580]">Mínimo normativo: {ind.minimo_normativo}</p>}<p className="mt-2 text-[10px] leading-relaxed text-[#78827c]">{ind.metodo_calculo}</p><p className="mt-1 text-[10px] text-[#78827c]">Evidencia: {ind.fuente_evidencia} · Conteo: {ind.conteo}</p></div>)}</div></div> : <p className="mt-3 border-t border-[#eee9df] pt-3 text-[11px] text-[#78827c]">Esta acción no tiene indicadores asociados en el catálogo.</p>}</div>)}</div>}
          </article>;
        })}</div> : <EmptyNotice title="Sin coincidencias" text="Prueba con otros términos de búsqueda." />}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReferenceList title="Familias profesionales" eyebrow="Oferta formativa" list={data.familias_profesionales} testPrefix="family" />
        <ReferenceList title="Objetivos de Desarrollo Sostenible" eyebrow="Agenda 2030" list={data.ods_2030} testPrefix="ods-2030" />
        <ReferenceList title="ODS de Canarias" eyebrow="Marco autonómico" list={data.ods_canarios} testPrefix="ods-canarias" />
        <ReferenceList title="Cargos CICLOPE" eyebrow="Estructura de coordinación" list={data.cargos_ciclope} testPrefix="ciclope" />
      </div>
        <section className="panel p-5 md:p-6"><p className="eyebrow">Análisis del entorno</p><h2 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold">Categorías DAFO</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{dafoGroups.map(([key, categories]) => <div className="rounded-lg border border-[#e7e2d9] p-3" key={key} data-testid={`dafo-${key}`}><h3 className="text-xs font-bold capitalize text-[#347b69]">{key}</h3>{categories.length ? <ul className="mt-2 space-y-2">{categories.map((cat, index) => <li key={`${cat.categoria}-${index}`} className="border-t border-[#eee9df] pt-2"><p className="text-[11px] font-semibold text-[#4b5954]">{cat.categoria}</p><p className="mt-1 text-[10px] leading-relaxed text-[#7b8580]">{cat.opciones.join(' · ')}</p></li>)}</ul> : <p className="mt-2 text-[10px] text-[#87918b]">Sin categorías registradas.</p>}</div>)}</div></section>
    </> : <EmptyNotice title="Catálogo no disponible" text="No se ha encontrado un catálogo oficial vigente." />}
  </div>;
}

function CatalogCount({ label, value }: { label: string; value: number }) {
  return <div className="panel p-4"><p className="eyebrow !tracking-[.08em]">{label}</p><p className="mt-2 font-[var(--app-font-serif)] text-2xl font-extrabold text-[#2b4146]" data-testid={`catalog-count-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p></div>;
}
function ReferenceList({ title, eyebrow, list, testPrefix }: { title: string; eyebrow: string; list: string[]; testPrefix: string }) {
  return <section className="panel p-5 md:p-6"><p className="eyebrow">{eyebrow}</p><h2 className="mt-1 font-[var(--app-font-serif)] text-base font-bold">{title}</h2>{list.length ? <div className="mt-4 flex flex-wrap gap-2">{list.map((item, i) => <span className="rounded-md border border-[#e7e2d9] bg-[#f8f6f0] px-2.5 py-1.5 text-[11px] text-[#596660]" key={`${item}-${i}`} data-testid={`${testPrefix}-item-${i}`}>{item}</span>)}</div> : <p className="mt-3 text-xs text-[#7c8580]">Sin referencias registradas.</p>}</section>;
}

function SetupPage() {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const status = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: false } });
  const initialize = useInitializeSetup();
  const [error, setError] = useState('');
  useEffect(() => { if (status.data?.initialized) setLocation('/login'); }, [status.data, setLocation]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    initialize.mutate({ data: {
      email: String(form.get('email')).trim(), name: String(form.get('name')).trim(),
      password: String(form.get('password')), centerName: String(form.get('centerName')).trim(),
      schoolYear: String(form.get('schoolYear')).trim(),
    } }, { onSuccess: session => {
      setCsrfToken(session.csrfToken);
      client.setQueryData(getGetCurrentUserQueryKey(), session);
      client.setQueryData(getGetSetupStatusQueryKey(), { initialized: true });
      setLocation('/');
    }, onError: issue => setError(messageFor(issue)) });
  };
  if (status.isLoading) return <LoadingScreen label="Comprobando configuración inicial" />;
  if (status.isError) return <AuthFrame><ErrorNotice text={messageFor(status.error)} onRetry={() => status.refetch()} /></AuthFrame>;
  if (status.data?.initialized) return <LoadingScreen label="La configuración ya está completada" />;
  return <AuthFrame><div className="mb-7"><p className="eyebrow">Puesta en marcha · paso único</p><h1 className="mt-2 font-[var(--app-font-serif)] text-3xl font-extrabold tracking-tight text-[#26383d]">Configura tu espacio</h1><p className="mt-2 text-sm leading-relaxed text-[#6e7974]">Registra el centro y crea la cuenta administradora inicial para comenzar.</p></div>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre de la persona administradora" id="setup-name"><input id="setup-name" name="name" className="field" required maxLength={160} autoComplete="name" data-testid="input-setup-name" /></Field><Field label="Correo electrónico" id="setup-email"><input id="setup-email" name="email" type="email" className="field" required autoComplete="email" data-testid="input-setup-email" /></Field></div>
      <Field label="Contraseña" id="setup-password"><input id="setup-password" name="password" type="password" className="field" required minLength={12} autoComplete="new-password" data-testid="input-setup-password" /><span className="mt-1 block text-[10px] text-[#77817c]">Mínimo 12 caracteres.</span></Field>
      <div className="border-t border-[#eee9df] pt-4"><p className="eyebrow mb-3">Datos del centro</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre del centro" id="center-name"><input id="center-name" name="centerName" className="field" required maxLength={200} data-testid="input-center-name" /></Field><Field label="Curso escolar" id="school-year"><input id="school-year" name="schoolYear" className="field" required pattern="\d{4}-\d{4}" placeholder="2025-2026" data-testid="input-school-year" /><span className="mt-1 block text-[10px] text-[#77817c]">Formato: AAAA-AAAA</span></Field></div></div>
      {error && <InlineAlert text={error} kind="error" />}
      <button type="submit" className="primary-action mt-2 w-full" disabled={initialize.isPending} data-testid="button-initialize-setup">{initialize.isPending ? 'Configurando el espacio…' : 'Crear espacio y administrador'}</button>
    </form>
    <p className="mt-5 flex items-center gap-2 border-t border-[#eee9df] pt-4 text-[11px] leading-relaxed text-[#78827c]"><ShieldCheck size={15} className="shrink-0 text-[#347b69]" />Esta configuración solo se realiza una vez y establece la cuenta con acceso técnico inicial.</p>
  </AuthFrame>;
}

function LoginPage() {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const status = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: false } });
  const login = useLogin();
  const [error, setError] = useState('');
  useEffect(() => { if (status.data && !status.data.initialized) setLocation('/setup'); }, [status.data, setLocation]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    login.mutate({ data: { email: String(form.get('email')).trim(), password: String(form.get('password')) } }, {
      onSuccess: session => {
        setCsrfToken(session.csrfToken);
        client.setQueryData(getGetCurrentUserQueryKey(), session);
        setLocation('/');
      },
      onError: issue => setError(messageFor(issue)),
    });
  };
  if (status.isLoading) return <LoadingScreen label="Comprobando espacio de trabajo" />;
  if (status.isError) return <AuthFrame variant="login">
    <div className="login-heading">
      <p className="login-kicker">IES Manuel Martín González</p>
      <h1 id="login-title">Acceso al espacio</h1>
      <p>No se ha podido comprobar el estado del espacio de trabajo.</p>
    </div>
    <ErrorNotice text={messageFor(status.error)} onRetry={() => status.refetch()} />
  </AuthFrame>;
  return <AuthFrame variant="login">
    <div className="login-heading">
      <p className="login-kicker">IES Manuel Martín González</p>
      <h1 id="login-title">Tu espacio de innovación</h1>
      <p>Accede a la coordinación y mejora educativa de nuestro centro.</p>
    </div>
    <form onSubmit={submit} className="login-form" aria-labelledby="login-title">
      <Field label="Correo electrónico" id="login-email"><input id="login-email" name="email" type="email" className="field login-field" required autoComplete="username" data-testid="input-login-email" /></Field>
      <Field label="Contraseña" id="login-password"><input id="login-password" name="password" type="password" className="field login-field" required autoComplete="current-password" data-testid="input-login-password" /></Field>
      <Link href="/forgot-password" className="auth-link">¿Has olvidado tu contraseña?</Link>
      {error && <InlineAlert text={error} kind="error" />}
      <button type="submit" className="primary-action login-submit" disabled={login.isPending} data-testid="button-login">
        <span>{login.isPending ? 'Verificando acceso…' : 'Iniciar sesión'}</span>
        {!login.isPending && <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
    <p className="login-assurance"><ShieldCheck size={16} aria-hidden="true" />Acceso reservado a cuentas autorizadas del centro.</p>
  </AuthFrame>;
}

function ForgotPasswordPage() {
  const [, setLocation] = useLocation();
  const reset = useRequestPasswordReset();
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    reset.mutate({ data: { email: String(form.get('email')).trim() } }, {
      onSuccess: () => setSubmitted(true),
      onError: issue => setError(messageFor(issue)),
    });
  };

  return <AuthFrame variant="login">
    <div className="login-heading">
      <p className="login-kicker">Recuperar acceso</p>
      <h1 id="login-title">Restablecer contraseña</h1>
      <p>Escribe el correo asociado a tu cuenta y te enviaremos un enlace si existe una cuenta activa.</p>
    </div>
    {submitted ? <div className="auth-result" role="status">
      <InlineAlert text="Si existe una cuenta activa con ese correo, recibirás un enlace para cambiar la contraseña." kind="success" />
      <p className="mt-4 text-sm leading-relaxed text-[#6e807b]">Revisa tu correo. El enlace caduca en 30 minutos y solo se puede utilizar una vez.</p>
    </div> : <form onSubmit={submit} className="login-form" aria-labelledby="login-title">
      <Field label="Correo electrónico" id="reset-request-email"><input id="reset-request-email" name="email" type="email" className="field login-field" required maxLength={254} autoComplete="email" data-testid="input-reset-request-email" /></Field>
      {error && <InlineAlert text={error} kind="error" />}
      <button type="submit" className="primary-action login-submit" disabled={reset.isPending} data-testid="button-reset-request">
        <span>{reset.isPending ? 'Enviando solicitud…' : 'Enviar enlace'}</span>
        {!reset.isPending && <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>}
    <Link href="/login" className="auth-return" data-testid="link-back-to-login"><ArrowLeft size={15} aria-hidden="true" />Volver al acceso</Link>
  </AuthFrame>;
}

function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const reset = useCompletePasswordReset();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    const confirmation = String(form.get('confirmPassword'));
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    reset.mutate({ data: { token, password } }, {
      onSuccess: () => {
        window.history.replaceState({}, '', window.location.pathname);
        setCompleted(true);
      },
      onError: () => setError('El enlace no es válido, ha caducado o ya se ha utilizado. Solicita uno nuevo.'),
    });
  };

  return <AuthFrame variant="login">
    <div className="login-heading">
      <p className="login-kicker">Recuperar acceso</p>
      <h1 id="login-title">Crea una contraseña nueva</h1>
      <p>Elige una contraseña de al menos 12 caracteres para proteger tu cuenta.</p>
    </div>
    {completed ? <div className="auth-result" role="status">
      <InlineAlert text="Tu contraseña se ha actualizado. Ya puedes iniciar sesión." kind="success" />
    </div> : !token ? <div className="auth-result">
      <InlineAlert text="Este enlace no es válido o ya no está disponible. Solicita uno nuevo." kind="error" />
    </div> : <form onSubmit={submit} className="login-form" aria-labelledby="login-title">
      <Field label="Contraseña nueva" id="reset-password"><input id="reset-password" name="password" type="password" className="field login-field" required minLength={12} maxLength={1024} autoComplete="new-password" data-testid="input-reset-password" /></Field>
      <Field label="Repite la contraseña nueva" id="reset-password-confirm"><input id="reset-password-confirm" name="confirmPassword" type="password" className="field login-field" required minLength={12} maxLength={1024} autoComplete="new-password" data-testid="input-reset-password-confirm" /></Field>
      {error && <InlineAlert text={error} kind="error" />}
      <button type="submit" className="primary-action login-submit" disabled={reset.isPending} data-testid="button-reset-password">
        <span>{reset.isPending ? 'Actualizando contraseña…' : 'Guardar contraseña nueva'}</span>
        {!reset.isPending && <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>}
    {completed ? <button type="button" className="auth-return" onClick={() => setLocation('/login')} data-testid="button-reset-to-login"><ArrowLeft size={15} aria-hidden="true" />Ir al acceso</button> : <Link href="/forgot-password" className="auth-return" data-testid="link-request-another-reset"><ArrowLeft size={15} aria-hidden="true" />Solicitar un enlace nuevo</Link>}
  </AuthFrame>;
}

function AuthFrame({ children, variant }: { children: ReactNode; variant?: 'login' }) {
  if (variant === 'login') {
    return <main className="login-app">
      <div className="login-stage">
        <div className="login-composition">
          <section className="login-story" aria-label="Coordinación para innovar juntos">
            <div className="story-topline"><span className="story-dot" />PROYECTO DE INNOVACIÓN DEL CENTRO</div>
            <figure className="story-art">
              <img
                className="story-photo"
                src={loginTeamPhoto}
                alt="Dos profesionales consultan una tableta juntos; fotografía ilustrativa."
              />
            </figure>
            <div className="story-copy">
              <h2>Tu centro, en movimiento</h2>
              <p>Ideas que se coordinan y proyectos que avanzan.</p>
              <p className="photo-credit">
                Imagen ilustrativa · Foto de{' '}
                <a href="https://www.pexels.com/photo/man-and-woman-looking-at-a-digital-tablet-5955023/" target="_blank" rel="noreferrer">
                  Theo Decker / Pexels
                </a>
              </p>
            </div>
            <div className="story-bottom">
              <img
                className="school-logo"
                src={`${import.meta.env.BASE_URL}branding/ies-manuel-martin-gonzalez.png`}
                alt="Logo del IES Manuel Martín González"
                width={112}
                height={72}
                decoding="async"
              />
              <p><strong>IES Manuel Martín González</strong><br />Coordinación educativa · Canarias</p>
              <span className="story-year">PIC <i /> CENTRO</span>
            </div>
          </section>
          <section className="login-card" aria-labelledby="login-title">
            <div className="login-brand">
              <BrandMark className="login-brand-mark" />
              <div className="login-wordmark"><p>INNOVA-C2</p><span>ESPACIO DE COORDINACIÓN</span></div>
            </div>
            {children}
            <footer className="login-footer">INNOVA-C2 · Coordinación educativa del centro</footer>
          </section>
        </div>
      </div>
    </main>;
  }
  return <main className="app-shell flex min-h-[100dvh] flex-col"><header className="flex h-[68px] items-center gap-3 border-b border-[#e5dfd2] bg-[#f8f6ef] px-5 md:px-10"><BrandMark /><div><p className="font-[var(--app-font-serif)] text-sm font-extrabold tracking-tight text-[#26383d]">INNOVA-C2</p><p className="text-[9px] tracking-[.12em] text-[#7b8580]">ESPACIO DE COORDINACIÓN</p></div><span className="ml-auto hidden text-xs text-[#737e78] sm:block">IES Manuel Martín González</span></header><div className="flex flex-1 items-start justify-center px-4 py-10 md:items-center md:py-14"><section className="panel w-full max-w-[620px] p-6 md:p-9">{children}</section></div><footer className="px-5 py-4 text-center text-[10px] tracking-wide text-[#7d8580]">INNOVA-C2 · Coordinación educativa</footer></main>;
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="flex flex-col gap-4 border-b border-[#e5dfd2] pb-5 md:flex-row md:items-end md:justify-between"><div><p className="eyebrow">{eyebrow}</p><h2 className="mt-1 font-[var(--app-font-serif)] text-2xl font-extrabold tracking-tight text-[#26383d] md:text-[28px]">{title}</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#6e7974]">{description}</p></div></div>;
}
function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="space-y-1.5"><label htmlFor={id} className="block text-xs font-semibold text-[#43534f]">{label}</label>{children}</div>;
}
function InlineAlert({ text, kind }: { text: string; kind: 'error' | 'success' }) {
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2.5 text-xs leading-relaxed ${kind === 'error' ? 'bg-[#fae9e5] text-[#923f36]' : 'bg-[#e8f3eb] text-[#2c7055]'}`} data-testid={`status-${kind}`}>{text}</div>;
}
function ErrorNotice({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="rounded-lg border border-[#ead2ca] bg-[#fff9f6] p-5" role="alert" data-testid="status-load-error"><p className="text-sm font-bold text-[#89463d]">No se han podido cargar los datos</p><p className="mt-1 break-words text-xs text-[#805d57]">{text}</p><button className="quiet-action mt-3" onClick={onRetry} data-testid="button-retry">Reintentar</button></div>;
}
function EmptyNotice({ title, text }: { title: string; text: string }) {
  return <div className="grid min-h-[180px] place-items-center p-7 text-center" data-testid="state-empty"><div><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#edf1eb] text-[#678276]"><CircleHelp size={19} /></span><h3 className="mt-3 text-sm font-bold text-[#43534f]">{title}</h3><p className="mt-1 max-w-sm text-xs leading-relaxed text-[#79837d]">{text}</p></div></div>;
}
function SummarySkeleton() {
  return <div className="space-y-5" aria-label="Cargando resumen"><div className="dashboard-metrics">{[1,2,3,4,5,6].map(i => <div key={i} className="panel metric-tile"><div className="skeleton h-3 w-24" /><div className="skeleton mt-4 h-8 w-12" /><div className="skeleton mt-3 h-3 w-28" /></div>)}</div><div className="dashboard-panels"><div className="panel skeleton h-48" /><div className="panel skeleton h-48" /></div></div>;
}
function CatalogSkeleton() {
  return <div className="space-y-4" aria-label="Cargando catálogo"><div className="skeleton h-40 rounded-xl" /><div className="panel space-y-3 p-5">{[1,2,3,4].map(i => <div className="skeleton h-12" key={i} />)}</div></div>;
}
function LoadingScreen({ label }: { label: string }) {
  return <main className="app-shell grid min-h-[100dvh] place-items-center p-5"><div className="w-full max-w-sm panel p-6" role="status" aria-label={label}><div className="flex items-center gap-3"><BrandMark /><div className="skeleton h-4 w-40" /></div><div className="skeleton mt-6 h-3 w-3/4" /><div className="skeleton mt-3 h-3 w-1/2" /><p className="mt-5 text-xs text-[#6e7974]">{label}…</p></div></main>;
}
function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
}
function NotFound() {
  return <main className="app-shell grid min-h-[100dvh] place-items-center p-5"><section className="panel max-w-lg p-8 text-center md:p-10"><div className="brand-mark mx-auto">IC</div><p className="eyebrow mt-6">Error 404</p><h1 className="mt-2 font-[var(--app-font-serif)] text-3xl font-extrabold text-[#26383d]">Esta página no existe</h1><p className="mt-3 text-sm leading-relaxed text-[#6e7974]">La dirección no corresponde a ninguna sección del espacio de coordinación.</p><Link href="/" className="primary-action mt-6 inline-flex items-center gap-2 no-underline" data-testid="link-return-home"><ArrowDownRight size={15} className="-rotate-45" />Volver al panel</Link></section></main>;
}

export default App;
