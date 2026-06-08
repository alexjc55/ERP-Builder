/**
 * Production ERP Configuration V1 setup.
 *
 * One-off configuration utility: wipes all demo content (pages, entities,
 * fields, records, statuses, transitions, relations, views, widgets) and
 * builds the V1 configuration described in
 * attached_assets/Pasted--Production-ERP-Configuration-V1--*.txt
 *
 * Uses ONLY existing platform features (metadata rows). No app functionality
 * or architecture is added. Re-runnable: it wipes then rebuilds each run.
 *
 *   pnpm --filter @workspace/scripts run setup-erp-v1
 */
import { sql } from "drizzle-orm";
import {
  db,
  pool,
  pagesTable,
  entitiesTable,
  entityFieldsTable,
  entityStatusesTable,
  entityTransitionsTable,
  viewsTable,
  rolesTable,
  usersTable,
  NO_ACCESS_PERMS,
  type RolePermissions,
  type FieldPermissions,
} from "@workspace/db";

type ML = { ru: string; en: string; he: string };
const ml = (ru: string, en: string, he: string): ML => ({ ru, en, he });

// bcrypt hash (cost 10, bcryptjs — same lib the API uses) of a shared temporary
// producer password that is communicated to the operator out-of-band, never
// stored here in plaintext. Producers should change it on first login (or an
// admin can reset it).
const PRODUCER_PW_HASH = "$2b$10$rYOOH6u41nS22Af2jfinjepm5nhDLkW9sujg9PE/E3pxDm/iXIB02";

// ── Field definitions (real column names from the Google Sheets table) ────────
type FieldDef = {
  key: string;
  name: ML;
  type?: string;
  required?: boolean;
  filterable?: boolean;
  perms?: FieldPermissions;
  userAllowedRoleIds?: number[];
};

// Financial fields hidden from the Производитель role (set after we know its id).
const PRODUCER_ROLE_ID = 4;
const FINANCIAL_HIDDEN_FROM_PRODUCER = new Set([
  "client_unit_price",
  "client_total_price",
  "designer_cost",
]);

const FIELDS: FieldDef[] = [
  { key: "project_manager", name: ml("Менеджер проекта", "Project Manager", "מנהל פרויקט") },
  { key: "project_name", name: ml("Проект", "Project", "פרויקט"), filterable: true },
  { key: "item_name", name: ml("Изделие", "Item", "פריט") },
  { key: "order_number", name: ml("Номер заказа", "Order Number", "מספר הזמנה") },
  { key: "drawing_link", name: ml("Чертёж", "Drawing", "שרטוט"), type: "url" },
  { key: "ral_color", name: ml("Цвет RAL", "RAL Color", "צבע RAL") },
  { key: "quantity", name: ml("Количество", "Quantity", "כמות"), type: "number" },
  { key: "client_unit_price", name: ml("Цена за единицу (клиент)", "Client Unit Price", "מחיר יחידה ללקוח"), type: "number" },
  { key: "client_total_price", name: ml("Сумма (клиент)", "Client Total", "סה״כ ללקוח"), type: "number" },
  { key: "materials_cost", name: ml("Стоимость материалов", "Materials Cost", "עלות חומרים"), type: "number" },
  { key: "designer", name: ml("Дизайнер", "Designer", "מעצב") },
  { key: "designer_cost", name: ml("Оплата дизайнеру", "Designer Cost", "עלות מעצב"), type: "number" },
  { key: "entry_date", name: ml("Дата ввода", "Entry Date", "תאריך הזנה"), type: "date" },
  { key: "manufacturer", name: ml("Производитель", "Manufacturer", "יצרן"), type: "user", filterable: true, userAllowedRoleIds: [PRODUCER_ROLE_ID] },
  { key: "manufacturer_order_number", name: ml("Номер заказа производителя", "Manufacturer Order #", "מספר הזמנת יצרן") },
  { key: "production_cost", name: ml("Стоимость производства", "Production Cost", "עלות ייצור"), type: "number" },
  { key: "painter", name: ml("Маляр", "Painter", "צבעי") },
  { key: "production_status", name: ml("Статус производства", "Production Status", "סטטוס ייצור"), filterable: true },
  { key: "production_finish_date", name: ml("Дата готовности", "Production Finish Date", "תאריך סיום ייצור"), type: "date" },
  { key: "driver", name: ml("Водитель", "Driver", "נהג") },
  { key: "delivery_status", name: ml("Статус доставки", "Delivery Status", "סטטוס משלוח"), filterable: true },
  { key: "delivery_date", name: ml("Дата доставки", "Delivery Date", "תאריך משלוח"), type: "date" },
  { key: "delivery_cost", name: ml("Стоимость доставки", "Delivery Cost", "עלות משלוח"), type: "number" },
  { key: "epokol_order_number", name: ml("Номер заказа Эпокол", "Epokol Order #", "מספר הזמנת אפוקול") },
  { key: "paint_status", name: ml("Статус покраски", "Paint Status", "סטטוס צביעה"), filterable: true },
  { key: "paint_cost", name: ml("Стоимость покраски", "Paint Cost", "עלות צביעה"), type: "number" },
  { key: "paint_finish_date", name: ml("Дата покраски", "Paint Finish Date", "תאריך סיום צביעה"), type: "date" },
  { key: "quality_certificate", name: ml("Сертификат качества", "Quality Certificate", "תעודת איכות"), type: "file" },
  { key: "comments", name: ml("Комментарии", "Comments", "הערות"), type: "textarea" },
];

// ── Statuses (workflow V1) ───────────────────────────────────────────────────
type StatusDef = { key: string; name: ML; color: string };
const STATUSES: StatusDef[] = [
  { key: "new", name: ml("Новая запись", "New", "חדש"), color: "#6b7280" },
  { key: "sent_to_manufacturer", name: ml("Передано производителю", "Sent to Manufacturer", "נשלח ליצרן"), color: "#f59e0b" },
  { key: "in_production", name: ml("В производстве", "In Production", "בייצור"), color: "#3b82f6" },
  { key: "ready", name: ml("Готово", "Ready", "מוכן"), color: "#8b5cf6" },
  { key: "sent_to_logistics", name: ml("Передано в логистику", "Sent to Logistics", "נשלח ללוגיסטיקה"), color: "#06b6d4" },
  { key: "delivered", name: ml("Доставлено", "Delivered", "נמסר"), color: "#10b981" },
  { key: "installed", name: ml("Смонтировано", "Installed", "הותקן"), color: "#22c55e" },
  { key: "closed", name: ml("Закрыто", "Closed", "סגור"), color: "#1f2937" },
];

const LOGISTICS_FIELD_KEYS = [
  "project_name", "item_name", "order_number", "manufacturer", "manufacturer_order_number",
  "production_status", "production_finish_date", "painter", "paint_status", "paint_finish_date",
  "driver", "delivery_status", "delivery_date", "delivery_cost", "comments",
];
const PRODUCTION_FIELD_KEYS = [
  "project_name", "item_name", "order_number", "drawing_link", "ral_color", "quantity",
  "manufacturer", "manufacturer_order_number", "production_status", "production_finish_date",
  "painter", "comments",
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  await db.transaction(async (tx) => {
    // ── 1. WIPE demo content ────────────────────────────────────────────────
    // FK-safe order; children before parents.
    const wipe = [
      "record_links", "page_record_values", "dashboard_widgets", "entity_records",
      "entity_transitions", "views", "page_fields", "entity_statuses",
      "entity_fields", "relations", "entities", "pages",
    ];
    for (const t of wipe) await tx.execute(sql.raw(`DELETE FROM ${t};`));

    // Best-effort: demo audit/event/trash rows that reference deleted entities.
    for (const t of ["audit_log", "system_events", "deleted_files"]) {
      try {
        await tx.execute(sql.raw(`DELETE FROM ${t};`));
      } catch {
        /* table may not exist in this deployment — ignore */
      }
    }

    // Normalize preserved users so the wipe never leaves dangling references
    // (users.role_id and users.start_page_id are plain integers, not FKs).
    // Any user on a demo role (7/8) is parked on the no-access Гость role (11);
    // any start_page_id pointing at a now-deleted page is cleared.
    await tx.execute(sql.raw(`UPDATE users SET role_id = 11 WHERE role_id IN (7, 8);`));
    await tx.execute(
      sql.raw(`UPDATE users SET start_page_id = NULL WHERE start_page_id IS NOT NULL AND start_page_id NOT IN (SELECT id FROM pages);`),
    );

    // Remove demo-only roles (WF Tester / WF роль 3). Keep all users and the
    // spec roles (1 Администратор, 2 Управляющий, 3 Менеджер, 4 Производитель,
    // 5 Финансовый директор, 11 Гость).
    await tx.execute(sql.raw(`DELETE FROM roles WHERE id IN (7, 8);`));

    console.log("Wiped demo content.");

    // ── 2. Pages + entity ───────────────────────────────────────────────────
    const [mainPage] = await tx
      .insert(pagesTable)
      .values({
        nameJson: ml("Управление проектами", "Project Management", "ניהול פרויקטים"),
        icon: "table",
        path: "/upravlenie-proektami",
        sortOrder: 1,
      })
      .returning({ id: pagesTable.id });

    const [items] = await tx
      .insert(entitiesTable)
      .values({
        entityKey: "items",
        nameJson: ml("Изделия", "Items", "פריטים"),
        icon: "package",
        pageId: mainPage.id,
        sortOrder: 1,
      })
      .returning({ id: entitiesTable.id });
    const entityKey = String(items.id);

    const [logisticsPage] = await tx
      .insert(pagesTable)
      .values({
        nameJson: ml("Логистика", "Logistics", "לוגיסטיקה"),
        icon: "truck",
        path: "/logistika",
        mirrorEntityId: items.id,
        mirrorFieldKeysJson: LOGISTICS_FIELD_KEYS,
        sortOrder: 2,
      })
      .returning({ id: pagesTable.id });

    const [productionPage] = await tx
      .insert(pagesTable)
      .values({
        nameJson: ml("Производство", "Production", "ייצור"),
        icon: "factory",
        path: "/proizvodstvo",
        mirrorEntityId: items.id,
        mirrorFieldKeysJson: PRODUCTION_FIELD_KEYS,
        sortOrder: 3,
      })
      .returning({ id: pagesTable.id });

    // ── 2b. Administration menu (builder pages) ─────────────────────────────
    // These rows make the admin constructor reachable from the sidebar. The
    // sidebar is built entirely from the `pages` table, so the wipe above also
    // removed the admin menu — it must be recreated. Visibility is driven by
    // RBAC caps (adminCapForPath) + superAdmin, not by role.pageIds, so simply
    // having the rows restores the full administration section for admins.
    const [adminGroup] = await tx
      .insert(pagesTable)
      .values({
        nameJson: ml("Администрирование", "Administration", "ניהול"),
        icon: "settings",
        path: null,
        sortOrder: 100,
      })
      .returning({ id: pagesTable.id });

    const ADMIN_PAGES: { name: ML; icon: string; path: string }[] = [
      { name: ml("Страницы", "Pages", "דפים"), icon: "files", path: "/admin/pages" },
      { name: ml("Сущности", "Entities", "ישויות"), icon: "database", path: "/admin/entities" },
      { name: ml("Пользователи", "Users", "משתמשים"), icon: "users", path: "/admin/users" },
      { name: ml("Роли и права", "Roles & Permissions", "תפקידים והרשאות"), icon: "shield", path: "/admin/roles" },
      { name: ml("Переводы", "Translations", "תרגומים"), icon: "languages", path: "/admin/translations" },
      { name: ml("События", "Events", "אירועים"), icon: "activity", path: "/admin/events" },
      { name: ml("Модули", "Modules", "מודולים"), icon: "puzzle", path: "/admin/modules" },
      { name: ml("Корзина файлов", "File Trash", "סל קבצים"), icon: "trash", path: "/admin/file-trash" },
    ];
    await tx.insert(pagesTable).values(
      ADMIN_PAGES.map((p, i) => ({
        nameJson: p.name,
        icon: p.icon,
        path: p.path,
        parentPageId: adminGroup.id,
        sortOrder: 101 + i,
      })),
    );

    console.log(`Created pages (main=${mainPage.id}, logistics=${logisticsPage.id}, production=${productionPage.id}) and entity Items=${items.id}.`);
    console.log(`Created administration menu group (${adminGroup.id}) with ${ADMIN_PAGES.length} builder pages.`);

    // ── 3. Fields ───────────────────────────────────────────────────────────
    await tx.insert(entityFieldsTable).values(
      FIELDS.map((f, i) => ({
        entityId: items.id,
        fieldKey: f.key,
        nameJson: f.name,
        fieldType: f.type ?? "text",
        isRequired: f.required ?? false,
        isFilterable: f.filterable ?? false,
        permissionsJson: (FINANCIAL_HIDDEN_FROM_PRODUCER.has(f.key)
          ? { [String(PRODUCER_ROLE_ID)]: "hidden" }
          : {}) as FieldPermissions,
        userConfigJson: f.userAllowedRoleIds ? { allowedRoleIds: f.userAllowedRoleIds } : {},
        sortOrder: i + 1,
      })),
    );
    console.log(`Created ${FIELDS.length} fields.`);

    // ── 4. Statuses ─────────────────────────────────────────────────────────
    const statusIds: Record<string, number> = {};
    for (let i = 0; i < STATUSES.length; i++) {
      const s = STATUSES[i];
      const isClosed = s.key === "closed";
      const [row] = await tx
        .insert(entityStatusesTable)
        .values({
          entityId: items.id,
          statusKey: s.key,
          nameJson: s.name,
          color: s.color,
          isDefault: i === 0,
          isFinal: isClosed,
          isArchiveTrigger: isClosed,
          archiveAfterDays: isClosed ? 30 : 0,
          sortOrder: i + 1,
        })
        .returning({ id: entityStatusesTable.id });
      statusIds[s.key] = row.id;
    }
    console.log(`Created ${STATUSES.length} statuses.`);

    // ── 5. Transitions (sequential forward chain) ───────────────────────────
    for (let i = 0; i < STATUSES.length - 1; i++) {
      const from = statusIds[STATUSES[i].key];
      const to = statusIds[STATUSES[i + 1].key];
      await tx.insert(entityTransitionsTable).values({
        entityId: items.id,
        fromStatusId: from,
        toStatusId: to,
        nameJson: ml(STATUSES[i + 1].name.ru, STATUSES[i + 1].name.en, STATUSES[i + 1].name.he),
        allowedRoleIds: [],
        requiredFieldKeys: [],
        actionsJson: [],
        sortOrder: i + 1,
      });
    }
    console.log(`Created ${STATUSES.length - 1} transitions.`);

    // ── 6. Producer users (the manufacturer "values" are producer accounts) ──
    const producers = [
      { email: "hamada@erp.local", firstName: "Hamada", lastName: "Производитель" },
      { email: "suleiman@erp.local", firstName: "Suleiman", lastName: "Производитель" },
    ];
    const producerIds: Record<string, number> = {};
    for (const p of producers) {
      const [row] = await tx
        .insert(usersTable)
        .values({
          email: p.email,
          passwordHash: PRODUCER_PW_HASH,
          firstName: p.firstName,
          lastName: p.lastName,
          roleId: PRODUCER_ROLE_ID,
          language: "ru",
          isActive: true,
        })
        .onConflictDoUpdate({
          target: usersTable.email,
          set: {
            passwordHash: PRODUCER_PW_HASH,
            firstName: p.firstName,
            lastName: p.lastName,
            roleId: PRODUCER_ROLE_ID,
            isActive: true,
          },
        })
        .returning({ id: usersTable.id });
      producerIds[p.firstName] = row.id;
    }
    console.log(`Ensured producer users: ${producers.map((p) => p.email).join(", ")}.`);

    // ── 7. Views (per-manufacturer filters on the manufacturer user field) ───
    let viewOrder = 1;
    for (const name of ["Hamada", "Suleiman"]) {
      await tx.insert(viewsTable).values({
        entityId: items.id,
        viewKey: name.toLowerCase(),
        nameJson: ml(name, name, name),
        configJson: {
          filters: [{ field: "manufacturer", operator: "eq", value: producerIds[name] }],
          filterConjunction: "and",
        },
        isDefault: false,
        sortOrder: viewOrder++,
      });
    }
    console.log("Created views: Hamada, Suleiman.");

    // ── 8. Roles permissions ─────────────────────────────────────────────────
    const allPages = [mainPage.id, logisticsPage.id, productionPage.id];
    const fullCaps = { pages: true, entities: true, roles: true, users: true, translations: true, events: true, modules: true, googleDrive: true, settings: true };
    const noCaps = { pages: false, entities: false, roles: false, users: false, translations: false, events: false, modules: false, googleDrive: false, settings: false };

    const adminPerms: RolePermissions = {
      superAdmin: true,
      admin: fullCaps,
      pageIds: allPages,
      records: { [entityKey]: { view: true, create: true, update: true, delete: true, scope: "all" } },
    };
    const managingPerms: RolePermissions = {
      superAdmin: false,
      admin: noCaps,
      pageIds: allPages,
      records: { [entityKey]: { view: true, create: true, update: true, delete: true, scope: "all" } },
    };
    const managerPerms: RolePermissions = {
      superAdmin: false,
      admin: noCaps,
      pageIds: [mainPage.id],
      records: { [entityKey]: { view: true, create: true, update: true, delete: false, scope: "all" } },
    };
    const producerPerms: RolePermissions = {
      superAdmin: false,
      admin: noCaps,
      pageIds: [productionPage.id],
      records: {
        [entityKey]: { view: true, create: false, update: true, delete: false, scope: "own", scopeFieldKeys: ["manufacturer"] },
      },
    };
    const cfoPerms: RolePermissions = {
      superAdmin: false,
      admin: noCaps,
      pageIds: allPages,
      records: { [entityKey]: { view: true, create: false, update: false, delete: false, scope: "all" } },
    };

    const roleUpdates: Array<[number, RolePermissions]> = [
      [1, adminPerms],
      [2, managingPerms],
      [3, managerPerms],
      [4, producerPerms],
      [5, cfoPerms],
      [11, NO_ACCESS_PERMS],
    ];
    for (const [id, perms] of roleUpdates) {
      await tx
        .update(rolesTable)
        .set({ permissionsJson: perms })
        .where(sql`${rolesTable.id} = ${id}`);
    }
    console.log("Reset role permissions (1–5, 11).");
  });

  console.log("\n✅ Production ERP Configuration V1 setup complete.");
  console.log("   Producer logins: hamada@erp.local / suleiman@erp.local");
  console.log("   Temp password was shared out-of-band; producers should reset it on first login.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
