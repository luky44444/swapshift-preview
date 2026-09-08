import { randomUUID } from "node:crypto";
import {
  deleteCategory,
  deleteRole,
  getCategory,
  getRole,
  getShop,
  insertCategory,
  insertRole,
  listCategories,
  listPeople,
  listPersonRoles,
  listRoles,
  renameRoleEverywhere,
  roleInUse,
  updateCategory,
  updateRoleRow,
  updateShop,
} from "./db.js";
import { parseKind, rolesFor } from "./kinds.js";

const KIND_LABEL = {
  cafe: { en: "Cafe", cs: "Kavárna" },
  retail: { en: "Shop", cs: "Obchod" },
  gym: { en: "Gym", cs: "Fitko" },
  clinic: { en: "Clinic", cs: "Ordinace" },
};

function cleanName(raw) {
  const name = String(raw ?? "").trim();
  if (!name || name.length > 40) return { error: "name_required" };
  return name;
}

export function seedCatalog(kind, lang) {
  if (!listCategories().length) {
    const label = KIND_LABEL[kind]?.[lang] || KIND_LABEL.cafe[lang] || "Cafe";
    const cat = insertCategory({ id: randomUUID(), name: label });
    for (const name of rolesFor(kind, lang)) {
      insertRole({ id: randomUUID(), name, elevated: false });
    }
    updateShop({ categoryId: cat.id });
  }
  for (const person of listPeople()) {
    const names = listPersonRoles(person.id);
    for (const name of names) {
      if (!name) continue;
      if (!listRoles().some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        insertRole({ id: randomUUID(), name, elevated: false });
      }
    }
  }
}

export function applyKind(kind, lang) {
  const k = parseKind(kind);
  updateShop({ kind: k });
  for (const name of rolesFor(k, lang)) ensureRole(name);
}

export function addCategory(nameRaw) {
  const name = cleanName(nameRaw);
  if (name.error) return name;
  if (listCategories().some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return { error: "name_required" };
  }
  return { category: insertCategory({ id: randomUUID(), name }) };
}

export function editCategory(id, nameRaw) {
  if (!getCategory(id)) return { error: "not_found" };
  const name = cleanName(nameRaw);
  if (name.error) return name;
  return { category: updateCategory(id, name) };
}

export function removeCategoryById(id) {
  const shop = getShop();
  const list = listCategories();
  if (list.length <= 1) return { error: "last_category" };
  if (!getCategory(id)) return { error: "not_found" };
  deleteCategory(id);
  if (shop?.category_id === id) {
    const next = listCategories()[0];
    updateShop({ categoryId: next.id });
  }
  return { ok: true };
}

export function addRole(nameRaw, elevated) {
  const name = cleanName(nameRaw);
  if (name.error) return name;
  if (listRoles().some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    return { error: "name_required" };
  }
  return { role: insertRole({ id: randomUUID(), name, elevated: Boolean(elevated) }) };
}

export function editRole(id, { name: nameRaw, elevated }) {
  const current = getRole(id);
  if (!current) return { error: "not_found" };
  let name = current.name;
  if (nameRaw != null) {
    const next = cleanName(nameRaw);
    if (next.error) return next;
    name = next;
    if (name !== current.name) renameRoleEverywhere(current.name, name);
  }
  return { role: updateRoleRow(id, { name, elevated }) };
}

export function removeRoleById(id) {
  const current = getRole(id);
  if (!current) return { error: "not_found" };
  if (listRoles().length <= 1) return { error: "last_role" };
  if (roleInUse(current.name)) return { error: "role_in_use" };
  deleteRole(id);
  return { ok: true };
}

export function ensureRole(nameRaw) {
  const name = String(nameRaw ?? "").trim();
  if (!name) return null;
  const existing = listRoles().find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  return insertRole({ id: randomUUID(), name, elevated: false });
}
