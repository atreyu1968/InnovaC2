import type {
  PicPlanContent,
  PicPlanIssue,
  PicPlanValidation,
} from "@workspace/api-zod";

type CatalogIndicator = {
  id: string;
  descripcion: string;
  tipo: string;
  minimo_normativo: number | null;
};

type CatalogAction = {
  codigo: string;
  titulo: string;
  obligatoria: boolean;
  indicadores: CatalogIndicator[];
};

type CatalogObjective = {
  codigo: string;
  titulo: string;
  acciones: CatalogAction[];
};

export type OfficialPicCatalog = {
  id: string;
  version: string;
  reglas: {
    acciones_minimas_por_objetivo: number;
    acciones_obligatorias: string[];
    otras_acciones_maximo: number;
    proyectos_maximo_formulario: number;
    dafo_por_cuadrante_minimo: number;
    dafo_por_cuadrante_maximo: number;
    reuniones_CICLOPE_minimo: number;
  };
  objetivos: CatalogObjective[];
  familias_profesionales: string[];
  dafo_categorias: Record<string, { categoria: string; opciones: string[] }[]>;
  ods_2030: string[];
  ods_canarios: string[];
  cargos_ciclope: string[];
};

const QUADRANTS = [
  "debilidades",
  "fortalezas",
  "amenazas",
  "oportunidades",
] as const;

const blankText = (value: string | undefined): boolean => !value?.trim();
const normalized = (value: string): string =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function createEmptyPicPlanContent(): PicPlanContent {
  return {
    coordinator: {
      profile: "C2",
      firstName: "",
      lastName: "",
      corporateEmail: "",
      phone: "",
      professionalFamily: "",
    },
    center: {
      professionalFamily: "",
      levels: [],
      groupCount: 0,
      familyProfiles: [],
    },
    dafo: [],
    projectsInCenter: false,
    projects: [],
    ateca: { available: false, referenceCenter: "" },
    selectedActions: [],
    customActions: [],
    odsLinks: [],
    ciclopeMembers: [],
    calendar: { redMeetingDates: [], ciclopeMeetingDates: [], notes: "" },
    diffusion: { onlineChannels: [], offlineChannels: [] },
  };
}

export function validatePicPlan(
  content: PicPlanContent,
  catalog: OfficialPicCatalog,
): PicPlanValidation {
  const issues: PicPlanIssue[] = [];
  const add = (
    code: string,
    section: number,
    severity: "error" | "warning",
    message: string,
  ) => issues.push({ code, section, severity, message });

  const required = (value: string, section: number, label: string) => {
    if (blankText(value)) {
      add(`section_${section}_required`, section, "error", `${label}: campo obligatorio.`);
    }
  };

  const { coordinator, center, dafo, projects, ateca, selectedActions } = content;
  required(coordinator.firstName, 1, "Nombre de coordinación");
  required(coordinator.lastName, 1, "Apellidos de coordinación");
  required(coordinator.corporateEmail, 1, "Correo corporativo de coordinación");
  if (
    coordinator.corporateEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coordinator.corporateEmail)
  ) {
    add("coordinator_email_invalid", 1, "error", "El correo de coordinación no tiene un formato válido.");
  } else if (
    coordinator.corporateEmail &&
    !/@(?:canariaseducacion\.es|gobiernodecanarias\.org)$/i.test(
      coordinator.corporateEmail,
    )
  ) {
    add(
      "coordinator_email_domain_review",
      1,
      "warning",
      "Confirma que el correo de coordinación es el corporativo requerido por la convocatoria.",
    );
  }
  required(coordinator.phone, 1, "Teléfono de contacto");
  if (
    coordinator.professionalFamily &&
    !catalog.familias_profesionales.includes(coordinator.professionalFamily)
  ) {
    add("coordinator_family_unknown", 1, "error", "La familia profesional de coordinación no pertenece al Anexo I.");
  }

  required(center.professionalFamily, 2, "Familia profesional del centro");
  if (
    center.professionalFamily &&
    !catalog.familias_profesionales.includes(center.professionalFamily)
  ) {
    add("center_family_unknown", 2, "error", "La familia profesional seleccionada no pertenece al Anexo I.");
  }
  if (center.levels.length === 0) {
    add("center_levels_missing", 2, "error", "Selecciona al menos un nivel impartido.");
  }
  if (center.groupCount < 1) {
    add("center_groups_missing", 2, "error", "Indica el número de grupos de enseñanzas profesionales.");
  }
  if (!center.familyProfiles?.length) {
    add("center_breakdown_missing", 2, "error", "Completa el desglose por familia profesional. Los datos anteriores no se distribuyen automáticamente.");
  } else {
    const seen = new Set<string>();
    center.familyProfiles.forEach((family, index) => {
      if (!catalog.familias_profesionales.includes(family.professionalFamily)) {
        add(`center_family_unknown_${index}`, 2, "error", `Familia ${index + 1}: selecciona una familia oficial del Anexo I.`);
      }
      if (seen.has(family.professionalFamily)) {
        add(`center_family_duplicate_${index}`, 2, "error", `La familia ${family.professionalFamily} aparece más de una vez.`);
      }
      seen.add(family.professionalFamily);
      if (!family.levels.length || family.groupCount < 1) {
        add(`center_family_incomplete_${index}`, 2, "error", `${family.professionalFamily}: indica al menos un nivel y un grupo.`);
      }
    });
  }

  const dafoRules = catalog.reglas;
  for (const quadrant of QUADRANTS) {
    const entries = dafo.filter((entry) => entry.quadrant === quadrant);
    if (
      entries.length < dafoRules.dafo_por_cuadrante_minimo ||
      entries.length > dafoRules.dafo_por_cuadrante_maximo
    ) {
      add(
        `dafo_${quadrant}_count`,
        3,
        "error",
        `${quadrant}: registra entre ${dafoRules.dafo_por_cuadrante_minimo} y ${dafoRules.dafo_por_cuadrante_maximo} situaciones.`,
      );
    }
    const choices = catalog.dafo_categorias[quadrant] ?? [];
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const key = `${entry.category}\u0000${entry.situation}`;
      if (seen.has(key)) {
        add(`dafo_${quadrant}_duplicate_${index}`, 3, "error", `${quadrant}: no repitas la misma situación.`);
      }
      seen.add(key);
      const category = choices.find((item) => item.categoria === entry.category);
      if (!category) {
        add(`dafo_${quadrant}_category_${index}`, 3, "error", `${quadrant}: selecciona una categoría oficial del Anexo V.`);
        return;
      }
      if (!category.opciones.includes(entry.situation)) {
        add(`dafo_${quadrant}_situation_${index}`, 3, "error", `${quadrant}: selecciona una situación de la categoría elegida.`);
      }
      if (
        normalized(entry.situation).startsWith("otra situacion") &&
        blankText(entry.customDetail)
      ) {
        add(`dafo_${quadrant}_other_${index}`, 3, "error", `${quadrant}: describe la otra situación.`);
      }
    });
  }

  const selectedProjects = projects.filter((project) => project.includedInPic);
  if (!content.projectsInCenter && selectedProjects.length > 0) {
    add("projects_selected_when_none", 4, "error", "Desmarca los proyectos del PIC si el centro no desarrolla ningún proyecto de innovación.");
  }
  if (content.projectsInCenter && selectedProjects.length === 0) {
    add("projects_none_selected", 4, "error", "Selecciona al menos un proyecto del inventario para el PIC.");
  }
  if (selectedProjects.length > catalog.reglas.proyectos_maximo_formulario) {
    add(
      "projects_max_selected",
      4,
      "error",
      `Solo se pueden incluir ${catalog.reglas.proyectos_maximo_formulario} proyectos en el PIC.`,
    );
  }
  projects.forEach((project, index) => {
    if (!content.projectsInCenter || !project.includedInPic) return;
    required(project.name, 4, `Proyecto ${index + 1}: nombre`);
    required(project.coordinatorName, 4, `Proyecto ${index + 1}: coordinación`);
    if (
      !blankText(project.coordinatorEmail) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(project.coordinatorEmail)
    ) {
      add(`project_email_${index}`, 4, "error", `Proyecto ${index + 1}: el correo no tiene un formato válido.`);
    }
    if (
      project.coordinatingFamily &&
      !catalog.familias_profesionales.includes(project.coordinatingFamily)
    ) {
      add(`project_family_${index}`, 4, "error", `Proyecto ${index + 1}: familia profesional fuera del Anexo I.`);
    }
  });

  if (!ateca.available && blankText(ateca.referenceCenter)) {
    add("ateca_reference_missing", 5, "error", "Indica el aula ATECA de referencia que se prevé utilizar.");
  }

  const objectives = new Map(catalog.objetivos.map((objective) => [objective.codigo, objective]));
  const actions = new Map(
    catalog.objetivos.flatMap((objective) =>
      objective.acciones.map((action) => [action.codigo, { objective, action }] as const),
    ),
  );
  const actionCodes = new Set(selectedActions.map((selection) => selection.actionCode));
  for (const mandatory of catalog.reglas.acciones_obligatorias) {
    if (!actionCodes.has(mandatory)) {
      add(
        `mandatory_action_${mandatory}`,
        6,
        "error",
        `La acción obligatoria ${mandatory} debe estar seleccionada.`,
      );
    }
  }
  for (const objective of catalog.objetivos) {
    const selectedForObjective = selectedActions.filter(
      (selection) => selection.objectiveCode === objective.codigo,
    );
    if (selectedForObjective.length < catalog.reglas.acciones_minimas_por_objetivo) {
      add(
        `objective_${objective.codigo}_without_action`,
        6,
        "error",
        `Selecciona al menos una acción para el objetivo ${objective.codigo}.`,
      );
    }
  }
  selectedActions.forEach((selection, selectionIndex) => {
    const catalogAction = actions.get(selection.actionCode);
    if (
      !catalogAction ||
      catalogAction.objective.codigo !== selection.objectiveCode ||
      !objectives.has(selection.objectiveCode)
    ) {
      add(`action_unknown_${selectionIndex}`, 6, "error", `La acción ${selection.actionCode} no coincide con el catálogo oficial.`);
      return;
    }
    const indicators = new Map(
      catalogAction.action.indicadores.map((indicator) => [indicator.id, indicator]),
    );
    const seenIndicators = new Set<string>();
    if (selection.indicators.length !== indicators.size) {
      add(
        `action_indicators_${selection.actionCode}`,
        6,
        "error",
        `Completa todos los indicadores de la acción ${selection.actionCode}.`,
      );
    }
    selection.indicators.forEach((entry, indicatorIndex) => {
      const indicator = indicators.get(entry.indicatorId);
      if (!indicator || entry.actionCode !== selection.actionCode) {
        add(`indicator_unknown_${selection.actionCode}_${indicatorIndex}`, 6, "error", "El indicador no corresponde a la acción seleccionada.");
        return;
      }
      if (seenIndicators.has(entry.indicatorId)) {
        add(`indicator_duplicate_${entry.indicatorId}`, 6, "error", `El indicador ${entry.indicatorId} está duplicado.`);
      }
      seenIndicators.add(entry.indicatorId);
      const type = indicator.tipo;
      const unit = normalized(entry.unit);
      const isBoolean = type === "booleano";
      const expectedUnit =
        type === "porcentaje"
          ? "%"
          : type === "escala_1_5"
            ? "escala 1-5"
            : isBoolean
              ? "si/no"
              : type === "numero"
                ? "numero"
                : "";
      if (expectedUnit && unit !== expectedUnit) {
        add(
          `indicator_unit_${indicator.id}`,
          6,
          "error",
          `${indicator.id}: usa la unidad ${isBoolean ? "Sí/No" : expectedUnit}.`,
        );
      }
      if (type === "revisar_unidad") {
        if (blankText(entry.unit)) {
          add(`indicator_unit_review_${indicator.id}`, 6, "error", `${indicator.id}: define y contrasta la unidad con C2.`);
        } else {
          add(
            `indicator_unit_review_${indicator.id}`,
            6,
            "warning",
            `${indicator.id}: confirma con C2 que la unidad «${entry.unit}» es adecuada.`,
          );
        }
      }
      if (entry.targetValue === null || entry.riskValue === null) {
        add(`indicator_values_${indicator.id}`, 6, "error", `${indicator.id}: completa la meta y el valor de riesgo.`);
        return;
      }
      if (isBoolean) {
        if (
          typeof entry.targetValue !== "boolean" ||
          typeof entry.riskValue !== "boolean" ||
          entry.targetValue !== true ||
          entry.riskValue !== false
        ) {
          add(
            `indicator_boolean_${indicator.id}`,
            6,
            "error",
            `${indicator.id}: la meta debe ser «Sí» y el riesgo «No».`,
          );
        }
        return;
      }
      if (
        typeof entry.targetValue !== "number" ||
        typeof entry.riskValue !== "number" ||
        !Number.isFinite(entry.targetValue) ||
        !Number.isFinite(entry.riskValue)
      ) {
        add(`indicator_numeric_${indicator.id}`, 6, "error", `${indicator.id}: meta y riesgo deben ser numéricos.`);
        return;
      }
      if (entry.targetValue <= 0 || entry.riskValue <= 0) {
        add(`indicator_positive_${indicator.id}`, 6, "error", `${indicator.id}: la meta y el riesgo numéricos deben ser mayores que cero.`);
      }
      if (entry.riskValue > entry.targetValue) {
        add(`indicator_risk_above_target_${indicator.id}`, 6, "error", `${indicator.id}: el riesgo no puede superar la meta.`);
      }
      if (
        type === "porcentaje" &&
        (entry.targetValue > 100 || entry.riskValue > 100)
      ) {
        add(`indicator_percentage_${indicator.id}`, 6, "error", `${indicator.id}: los porcentajes deben estar entre 0 y 100.`);
      }
      if (
        type === "escala_1_5" &&
        (entry.targetValue > 5 || entry.riskValue > 5)
      ) {
        add(`indicator_scale_${indicator.id}`, 6, "error", `${indicator.id}: la escala permitida va de 1 a 5.`);
      }
      if (
        indicator.minimo_normativo !== null &&
        entry.targetValue < indicator.minimo_normativo
      ) {
        add(
          `indicator_normative_minimum_${indicator.id}`,
          6,
          "error",
          `${indicator.id}: la meta mínima normativa es ${indicator.minimo_normativo}.`,
        );
      }
    });
  });

  if (content.customActions.length > catalog.reglas.otras_acciones_maximo) {
    add(
      "custom_actions_max",
      6,
      "error",
      `El catálogo permite un máximo de ${catalog.reglas.otras_acciones_maximo} acciones propias.`,
    );
  }
  content.customActions.forEach((action, index) => {
    if (!objectives.has(action.objectiveCode)) {
      add(`custom_action_objective_${index}`, 6, "error", "Asocia cada acción propia a uno de los seis objetivos.");
    }
    required(action.title, 6, `Acción propia ${index + 1}`);
    required(action.indicatorLabel, 6, `Acción propia ${index + 1}: indicador`);
    required(action.unit, 6, `Acción propia ${index + 1}: unidad`);
    if (action.targetValue === null || action.riskValue === null) {
      add(`custom_action_values_${index}`, 6, "error", `Acción propia ${index + 1}: completa meta y riesgo.`);
    } else if (typeof action.targetValue === "number" || typeof action.riskValue === "number") {
      if (
        typeof action.targetValue !== "number" ||
        typeof action.riskValue !== "number" ||
        action.targetValue <= 0 ||
        action.riskValue <= 0 ||
        action.riskValue > action.targetValue
      ) {
        add(`custom_action_risk_${index}`, 6, "error", `Acción propia ${index + 1}: la meta debe ser positiva y el riesgo positivo, no superior a la meta.`);
      }
    } else if (action.targetValue !== true || action.riskValue !== false) {
      add(`custom_action_boolean_${index}`, 6, "error", `Acción propia ${index + 1}: para Sí/No usa meta «Sí» y riesgo «No».`);
    }
  });

  const objectiveCodes = new Set(catalog.objetivos.map((objective) => objective.codigo));
  const ods2030 = new Set(catalog.ods_2030);
  const odsCanarios = new Set(catalog.ods_canarios);
  content.odsLinks.forEach((link, index) => {
    const validCodes = link.agenda === "ods_2030" ? ods2030 : odsCanarios;
    if (!validCodes.has(link.odsCode)) {
      add(`ods_unknown_${index}`, 7, "error", "Selecciona un ODS vigente del anexo correspondiente.");
    }
    if (
      link.objectiveCodes.length === 0 ||
      link.objectiveCodes.some((code) => !objectiveCodes.has(code))
    ) {
      add(`ods_objectives_${index}`, 7, "error", "Vincula cada ODS con al menos un objetivo PIC válido.");
    }
  });
  if (!content.odsLinks.some((link) => link.agenda === "ods_2030")) {
    add("ods_2030_missing", 7, "warning", "Vincula el plan con al menos un ODS de la Agenda 2030.");
  }
  if (!content.odsLinks.some((link) => link.agenda === "ods_canarios")) {
    add("ods_canarios_missing", 7, "warning", "Vincula el plan con al menos un ODS canario.");
  }

  const ciclopeRoles = content.ciclopeMembers.map((member) => normalized(member.role));
  const requiredCiclopeRoles = [
    ["innovacion", "coordinador/a de la red de innovacion"],
    ["dual", "coordinador/a de fp dual"],
    ["direccion", "representante del equipo directivo"],
  ] as const;
  for (const [code, rolePattern] of requiredCiclopeRoles) {
    if (!ciclopeRoles.some((role) => role.includes(rolePattern))) {
      add(
        `ciclope_role_${code}`,
        8,
        "error",
        `Incluye en CICLOPE al menos una persona con el cargo «${rolePattern}».`,
      );
    }
  }
  content.ciclopeMembers.forEach((member, index) => {
    required(member.name, 8, `Miembro CICLOPE ${index + 1}: nombre`);
    if (!catalog.cargos_ciclope.includes(member.role)) {
      add(`ciclope_role_unknown_${index}`, 8, "error", `Miembro CICLOPE ${index + 1}: cargo fuera del Anexo IV.`);
    }
    if (
      member.professionalFamily &&
      member.professionalFamily !== "No procede" &&
      !catalog.familias_profesionales.includes(member.professionalFamily)
    ) {
      add(`ciclope_family_${index}`, 8, "error", `Miembro CICLOPE ${index + 1}: familia fuera del Anexo I.`);
    }
  });

  if (content.calendar.ciclopeMeetingDates.length < catalog.reglas.reuniones_CICLOPE_minimo) {
    add(
      "ciclope_meetings_min",
      9,
      "error",
      `Programa al menos ${catalog.reglas.reuniones_CICLOPE_minimo} reuniones de CICLOPE.`,
    );
  }
  if (content.calendar.redMeetingDates.length === 0) {
    add("red_meetings_missing", 9, "warning", "Añade las fechas previstas para las reuniones de la Red de Innovación.");
  }
  if (new Set(content.calendar.ciclopeMeetingDates).size !== content.calendar.ciclopeMeetingDates.length) {
    add("ciclope_meetings_duplicate", 9, "error", "No repitas fechas de reunión de CICLOPE.");
  }

  if (content.diffusion.onlineChannels.length === 0) {
    add("diffusion_online_missing", 10, "error", "Selecciona al menos un canal de difusión en línea.");
  }
  if (content.diffusion.offlineChannels.length === 0) {
    add("diffusion_offline_missing", 10, "error", "Selecciona al menos un canal de difusión fuera de línea.");
  }

  const errorsCount = issues.filter((issue) => issue.severity === "error").length;
  const warningsCount = issues.filter((issue) => issue.severity === "warning").length;
  return { valid: errorsCount === 0, errorsCount, warningsCount, issues };
}
