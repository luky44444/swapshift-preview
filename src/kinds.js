export const KINDS = ["cafe", "retail", "gym", "clinic"];

export const ROLES_BY_KIND = {
  cafe: {
    en: ["Barista", "Kitchen", "Floor", "Till"],
    cs: ["Barista", "Kuchyně", "Sál", "Pokladna"],
  },
  retail: {
    en: ["Floor", "Till", "Stock", "Fitting"],
    cs: ["Prodejna", "Pokladna", "Sklad", "Zkušebna"],
  },
  gym: {
    en: ["Coach", "Reception", "Floor"],
    cs: ["Trenér", "Recepce", "Sál"],
  },
  clinic: {
    en: ["Reception", "Nurse", "Therapist"],
    cs: ["Recepce", "Sestra", "Terapeut"],
  },
};

export const TIMES_BY_KIND = {
  cafe: [
    ["07:00", "15:00"],
    ["09:00", "17:00"],
    ["15:00", "21:00"],
  ],
  retail: [
    ["09:00", "17:00"],
    ["10:00", "18:00"],
    ["12:00", "20:00"],
  ],
  gym: [
    ["06:00", "14:00"],
    ["08:00", "16:00"],
    ["14:00", "22:00"],
  ],
  clinic: [
    ["07:00", "15:00"],
    ["08:00", "16:00"],
    ["12:00", "20:00"],
  ],
};

export function parseKind(raw) {
  return KINDS.includes(String(raw)) ? raw : "cafe";
}

export function rolesFor(kind, lang) {
  const pack = ROLES_BY_KIND[parseKind(kind)] || ROLES_BY_KIND.cafe;
  return pack[lang] || pack.en;
}

export function timesFor(kind) {
  return TIMES_BY_KIND[parseKind(kind)] || TIMES_BY_KIND.cafe;
}

export function defaultRole(kind, lang) {
  return rolesFor(kind, lang)[0];
}

export function isTitleNotJob(role) {
  return /^(owner|majitel|manager|vedoucí|vedouci|provozní|provozni|boss|admin)$/i.test(
    String(role ?? "").trim(),
  );
}
