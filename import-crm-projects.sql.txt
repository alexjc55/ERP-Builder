-- Импорт компаний (гости) и проектов из CRM
-- Сгенерировано автоматически из 01-hevrot-and-projects.csv
-- Скрипт идемпотентен: повторный запуск не создаёт дублей.

BEGIN;

-- 1. Поле "Id сделки" в сущности Проекты (если ещё нет)
INSERT INTO entity_fields (entity_id, field_key, name_json, field_type, show_in_table, is_filterable, sort_order)
SELECT e.id, 'crm_deal_id',
       '{"ru":"Id сделки","en":"CRM Deal ID","he":"מזהה עסקה"}'::jsonb,
       'text', false, false,
       COALESCE((SELECT MAX(f.sort_order)+1 FROM entity_fields f WHERE f.entity_id=e.id), 1)
FROM entities e
WHERE e.entity_key='projects'
ON CONFLICT (entity_id, field_key) DO NOTHING;

-- 2. Гости-компании (пароль отсутствует, язык иврит, RTL)
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'aviv@ben-shalom.co.il', NULL, 'בן שלום יהושע לדיור בניין והשקעות בע''''מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'oren@asayag.co.il', NULL, 'אסיאג יזמות ובנייה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'alexander@ecocity.co.i', NULL, 'אקו סיטי', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yehuda-h@ozy.co.il', NULL, 'עוז יזמות נדל''''ן בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'ram@argad-projects.co.il', NULL, 'ארגד ניהול פרויקטים בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'may@levda.com', NULL, 'לב ד.ע. 2003 פרוייקטים מיוחדים בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yeuda@atias.org.il', NULL, 'אטיאס יעקוב ובניו חברה לבניה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'didi@netanel.co.il', NULL, 'נתנאל גרופ בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'meir@mm-e.co.il', NULL, 'מוריה מור הנדסה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'liorr@citypeople.co.il', NULL, 'אנשי העיר מקבוצת רוטשטיין בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'orisrael@boh.co.il', NULL, 'בונים בעיר (בני אפרים 236 ת~א) בוני התיכון בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'eng@egol.co.il', NULL, 'אליהו גול בנין בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'rtevakol@gmail.com', NULL, 'ט.ר.הנדסה אזרחית בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'h38alon@gmail.com', NULL, 'הורייזן 38 בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'bar@phi-eng.co.il', NULL, 'פי הנדסה ובניה בע''''מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yafit@henco.co.il', NULL, 'הנקו בניה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'alonbe@romgc.co.il', NULL, 'רום גבס חיפוי וקירוי (1997) בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'boaz.d@emad.co.il', NULL, 'א.מ מגד לבניין בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'ilanh@shenhavpro.co.il', NULL, 'אילן הורוביץ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'or@decotech.co.il', NULL, 'דקוטק בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'shelli@i-almi.co.il', NULL, 'קבוצת אלמי - יזמות נדל"ן פרימיום', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'norkh2011@gmail.com', NULL, 'א.מ. מג''ד לבניין בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'accounting@michalovich.co.il', NULL, 'מיכאלוביץ ניהול ביצוע ויזמות בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'guy.supervision@gmail.com', NULL, 'בר כחול לבן פיתוח וטיטאן בניה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'jamel@arkan.co.il', NULL, 'ארקאן- הנדסה ובינוי בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'dima@vinci.co.il', NULL, 'וינצ''י הנדסה א.ר 2014 בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yoram@titan-il.com', NULL, 'טיטאן בניה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yuvalf@kedar-mivnim.com', NULL, 'קידר מבנים בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yuval@dor-eng.co.il', NULL, 'חיים מיכאלוביץ ניהול ביצוע ויזמות בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'afona200690@gmail.com', NULL, 'רמט טרום בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'uriel@shalom-nathan.co.il', NULL, 'שלום את נתן', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'dor@yoch-eng.co.il', NULL, 'יוחננוף הנדסה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'nati@eshkol.co.il', NULL, 'אשכול  פרוייקטים(ש.ר.ד) בע"ם', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'avi@avrahamlevi.co.il', NULL, 'אברהם לוי חברה לבנייה', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'tecturas@zahav.net.il', NULL, 'טקטורה פרו בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'bar@ferrum.co.il', NULL, 'פרום בונים יוקרה בע''''מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'bonimpo@hotmail.com', NULL, 'בניה והתחדשות עירונית ג.ס בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'lior@gotlib.co.il', NULL, 'גוטליב אחריות בבניה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'yair@ofek-holdings.com', NULL, 'אופק  ק ד בניה הנדסב בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'dramaty@gmail.com', NULL, 'ד.רמתי חברה קבלנית לבניין בע״מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'amita@etzgroup.com', NULL, 'עץ השקד הנדסה בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'daniele@danya-cebus.co.il', NULL, 'דניה סיבוס בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'aslam.a.m.tavor@gmail.com', NULL, 'א.מ תבור לבנייה ופיתוח בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'dorefirozen@gmail.com', NULL, 'אפי רוזן בניה ויזמות בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'liad@gnproject.co.il', NULL, 'ג.נ. איכות פרוייקטים בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'shalom@brosh.co.il', NULL, 'ברוש ניר עבודות הנדסה ובניין בע''''מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'adiel@ecocity.co.il', NULL, 'אקוסיטי אס.אל. בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'guest-a04e1c13@noemail.local', NULL, 'רם אדרת הנדסה אזרחית בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;
INSERT INTO users (email, password_hash, first_name, last_name, role_id, language, direction)
SELECT 'guest-04220a1a@noemail.local', NULL, 'זוארץ יזמות ופיתוח  בע"מ', '', r.id, 'he', 'rtl'
FROM roles r WHERE r.name_json->>'ru'='Гость'
ON CONFLICT (email) DO NOTHING;

-- 2а. Строки в user_roles для созданных гостей
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, u.role_id FROM users u
WHERE u.email IN (
  'aviv@ben-shalom.co.il',
  'oren@asayag.co.il',
  'alexander@ecocity.co.i',
  'yehuda-h@ozy.co.il',
  'ram@argad-projects.co.il',
  'may@levda.com',
  'yeuda@atias.org.il',
  'didi@netanel.co.il',
  'meir@mm-e.co.il',
  'liorr@citypeople.co.il',
  'orisrael@boh.co.il',
  'eng@egol.co.il',
  'rtevakol@gmail.com',
  'h38alon@gmail.com',
  'bar@phi-eng.co.il',
  'yafit@henco.co.il',
  'alonbe@romgc.co.il',
  'boaz.d@emad.co.il',
  'ilanh@shenhavpro.co.il',
  'or@decotech.co.il',
  'shelli@i-almi.co.il',
  'norkh2011@gmail.com',
  'accounting@michalovich.co.il',
  'guy.supervision@gmail.com',
  'jamel@arkan.co.il',
  'dima@vinci.co.il',
  'yoram@titan-il.com',
  'yuvalf@kedar-mivnim.com',
  'yuval@dor-eng.co.il',
  'afona200690@gmail.com',
  'uriel@shalom-nathan.co.il',
  'dor@yoch-eng.co.il',
  'nati@eshkol.co.il',
  'avi@avrahamlevi.co.il',
  'tecturas@zahav.net.il',
  'bar@ferrum.co.il',
  'bonimpo@hotmail.com',
  'lior@gotlib.co.il',
  'yair@ofek-holdings.com',
  'dramaty@gmail.com',
  'amita@etzgroup.com',
  'daniele@danya-cebus.co.il',
  'aslam.a.m.tavor@gmail.com',
  'dorefirozen@gmail.com',
  'liad@gnproject.co.il',
  'shalom@brosh.co.il',
  'adiel@ecocity.co.il',
  'guest-a04e1c13@noemail.local',
  'guest-04220a1a@noemail.local'
)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 3. Проекты (пропускаются, если Id сделки уже загружен)
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'שפר 13-15 ת"א'::text, 'client', u.id, 'crm_deal_id', '43248113'::text)
FROM entities e
JOIN users u ON u.email = 'aviv@ben-shalom.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '43248113'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'שלום עליכם 29, ת"א'::text, 'client', u.id, 'crm_deal_id', '42976131'::text)
FROM entities e
JOIN users u ON u.email = 'oren@asayag.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42976131'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מודיליאני 15'::text, 'client', u.id, 'crm_deal_id', '42951483'::text)
FROM entities e
JOIN users u ON u.email = 'alexander@ecocity.co.i'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42951483'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'עוזיאל 151 ר"ג'::text, 'client', u.id, 'crm_deal_id', '42942941'::text)
FROM entities e
JOIN users u ON u.email = 'yehuda-h@ozy.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42942941'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'גורדון 32 ת"א'::text, 'client', u.id, 'crm_deal_id', '42491397'::text)
FROM entities e
JOIN users u ON u.email = 'ram@argad-projects.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42491397'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'רשות העתיקות'::text, 'client', u.id, 'crm_deal_id', '42490143'::text)
FROM entities e
JOIN users u ON u.email = 'may@levda.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42490143'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'רמז 27'::text, 'client', u.id, 'crm_deal_id', '42400727'::text)
FROM entities e
JOIN users u ON u.email = 'yeuda@atias.org.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42400727'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ויצמן 49 תל אביב'::text, 'client', u.id, 'crm_deal_id', '42279749'::text)
FROM entities e
JOIN users u ON u.email = 'didi@netanel.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '42279749'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אנטוקולוסקי 10 ת"א'::text, 'client', u.id, 'crm_deal_id', '41634457'::text)
FROM entities e
JOIN users u ON u.email = 'meir@mm-e.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '41634457'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'עמוס 12-10 ת"א'::text, 'client', u.id, 'crm_deal_id', '41600403'::text)
FROM entities e
JOIN users u ON u.email = 'liorr@citypeople.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '41600403'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'רמברנדט 28, ת"א'::text, 'client', u.id, 'crm_deal_id', '41195784'::text)
FROM entities e
JOIN users u ON u.email = 'orisrael@boh.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '41195784'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'נחלת בנימין 83 תל אביב'::text, 'client', u.id, 'crm_deal_id', '41195516'::text)
FROM entities e
JOIN users u ON u.email = 'eng@egol.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '41195516'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מרים חשמונאית 26 ת"א'::text, 'client', u.id, 'crm_deal_id', '41191408'::text)
FROM entities e
JOIN users u ON u.email = 'rtevakol@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '41191408'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'חילו 18'::text, 'client', u.id, 'crm_deal_id', '40911554'::text)
FROM entities e
JOIN users u ON u.email = 'h38alon@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40911554'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'חדרה 11 ת"א'::text, 'client', u.id, 'crm_deal_id', '40908134'::text)
FROM entities e
JOIN users u ON u.email = 'bar@phi-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40908134'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'צפת 6 ת"א'::text, 'client', u.id, 'crm_deal_id', '40903528'::text)
FROM entities e
JOIN users u ON u.email = 'aviv@ben-shalom.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40903528'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ברדינג 22 ת"א'::text, 'client', u.id, 'crm_deal_id', '40848148'::text)
FROM entities e
JOIN users u ON u.email = 'guest-a04e1c13@noemail.local'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40848148'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'פייבל 11 תל אביב'::text, 'client', u.id, 'crm_deal_id', '40845868'::text)
FROM entities e
JOIN users u ON u.email = 'yafit@henco.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40845868'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'דיזנגוף 249 ת"א'::text, 'client', u.id, 'crm_deal_id', '40701792'::text)
FROM entities e
JOIN users u ON u.email = 'alonbe@romgc.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40701792'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'פינלס 10 ת"א'::text, 'client', u.id, 'crm_deal_id', '40700732'::text)
FROM entities e
JOIN users u ON u.email = 'boaz.d@emad.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40700732'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בית פרט גדרה'::text, 'client', u.id, 'crm_deal_id', '40679114'::text)
FROM entities e
JOIN users u ON u.email = 'ilanh@shenhavpro.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40679114'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'סוקולוב 23 ת"א'::text, 'client', u.id, 'crm_deal_id', '40575320'::text)
FROM entities e
JOIN users u ON u.email = 'or@decotech.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40575320'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בן שפרוט 13-15'::text, 'client', u.id, 'crm_deal_id', '40438915'::text)
FROM entities e
JOIN users u ON u.email = 'shelli@i-almi.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40438915'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'עין גדי גבעתיים 14'::text, 'client', u.id, 'crm_deal_id', '40438651'::text)
FROM entities e
JOIN users u ON u.email = 'norkh2011@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40438651'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'רח'' ליפסקי 10,ת"א'::text, 'client', u.id, 'crm_deal_id', '40250307'::text)
FROM entities e
JOIN users u ON u.email = 'accounting@michalovich.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40250307'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'הנביאים 15'::text, 'client', u.id, 'crm_deal_id', '40240975'::text)
FROM entities e
JOIN users u ON u.email = 'guy.supervision@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40240975'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'פומבדיתא 20-22,תא'::text, 'client', u.id, 'crm_deal_id', '40043685'::text)
FROM entities e
JOIN users u ON u.email = 'accounting@michalovich.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '40043685'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בלוך 30 ת"א'::text, 'client', u.id, 'crm_deal_id', '39643118'::text)
FROM entities e
JOIN users u ON u.email = 'jamel@arkan.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '39643118'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ביל"ו 4 תל אביב'::text, 'client', u.id, 'crm_deal_id', '39284461'::text)
FROM entities e
JOIN users u ON u.email = 'dima@vinci.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '39284461'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אדם הכהן 14'::text, 'client', u.id, 'crm_deal_id', '38772080'::text)
FROM entities e
JOIN users u ON u.email = 'yoram@titan-il.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38772080'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'הרצל 33 בת ים'::text, 'client', u.id, 'crm_deal_id', '38771984'::text)
FROM entities e
JOIN users u ON u.email = 'yoram@titan-il.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38771984'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בילטמור 11 ת"א'::text, 'client', u.id, 'crm_deal_id', '38720766'::text)
FROM entities e
JOIN users u ON u.email = 'yuvalf@kedar-mivnim.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38720766'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'איינשטיין 43-45'::text, 'client', u.id, 'crm_deal_id', '38674662'::text)
FROM entities e
JOIN users u ON u.email = 'yafit@henco.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38674662'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ברגסון 13 ת"א'::text, 'client', u.id, 'crm_deal_id', '38575544'::text)
FROM entities e
JOIN users u ON u.email = 'yuval@dor-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38575544'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בית ספר נרקיסים ראשון לציון'::text, 'client', u.id, 'crm_deal_id', '38508942'::text)
FROM entities e
JOIN users u ON u.email = 'afona200690@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38508942'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מינץ 14 ת"א'::text, 'client', u.id, 'crm_deal_id', '38402038'::text)
FROM entities e
JOIN users u ON u.email = 'uriel@shalom-nathan.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38402038'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בני אפרים 236-240 ת"א'::text, 'client', u.id, 'crm_deal_id', '38402004'::text)
FROM entities e
JOIN users u ON u.email = 'orisrael@boh.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38402004'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מנחם בגין 25 ת"א'::text, 'client', u.id, 'crm_deal_id', '38401990'::text)
FROM entities e
JOIN users u ON u.email = 'dor@yoch-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38401990'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בילטמור 3 ת"א'::text, 'client', u.id, 'crm_deal_id', '38232498'::text)
FROM entities e
JOIN users u ON u.email = 'nati@eshkol.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38232498'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'שמעון התרסי 1-7,ת"א'::text, 'client', u.id, 'crm_deal_id', '38150264'::text)
FROM entities e
JOIN users u ON u.email = 'yuval@dor-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38150264'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אדם הכהן 12'::text, 'client', u.id, 'crm_deal_id', '38112920'::text)
FROM entities e
JOIN users u ON u.email = 'jamel@arkan.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38112920'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ויצמן 51'::text, 'client', u.id, 'crm_deal_id', '38103886'::text)
FROM entities e
JOIN users u ON u.email = 'avi@avrahamlevi.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '38103886'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'יהודה המכבי 46-50 מרפסות‎'::text, 'client', u.id, 'crm_deal_id', '37565808'::text)
FROM entities e
JOIN users u ON u.email = 'tecturas@zahav.net.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '37565808'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'החשמונאים 3 רמת גן'::text, 'client', u.id, 'crm_deal_id', '37563442'::text)
FROM entities e
JOIN users u ON u.email = 'bar@ferrum.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '37563442'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'דובנוב 3'::text, 'client', u.id, 'crm_deal_id', '36994871'::text)
FROM entities e
JOIN users u ON u.email = 'yafit@henco.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36994871'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'עזרא הסופר ,14 תל אביב'::text, 'client', u.id, 'crm_deal_id', '36750325'::text)
FROM entities e
JOIN users u ON u.email = 'bonimpo@hotmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36750325'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'פישמן מימון 12'::text, 'client', u.id, 'crm_deal_id', '36745891'::text)
FROM entities e
JOIN users u ON u.email = 'lior@gotlib.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36745891'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ז''בוטינסקי  107'::text, 'client', u.id, 'crm_deal_id', '36721921'::text)
FROM entities e
JOIN users u ON u.email = 'yair@ofek-holdings.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36721921'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'פראג 3 ת"א'::text, 'client', u.id, 'crm_deal_id', '36669051'::text)
FROM entities e
JOIN users u ON u.email = 'dramaty@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36669051'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ז''בוטינסקי 105'::text, 'client', u.id, 'crm_deal_id', '36627739'::text)
FROM entities e
JOIN users u ON u.email = 'yeuda@atias.org.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36627739'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אינשטיין 57-61,ת"א‎'::text, 'client', u.id, 'crm_deal_id', '36591207'::text)
FROM entities e
JOIN users u ON u.email = 'yuval@dor-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36591207'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'רמברנדט 28, ת"א'::text, 'client', u.id, 'crm_deal_id', '36420475'::text)
FROM entities e
JOIN users u ON u.email = 'orisrael@boh.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36420475'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'פנקס 19-23'::text, 'client', u.id, 'crm_deal_id', '36293723'::text)
FROM entities e
JOIN users u ON u.email = 'amita@etzgroup.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '36293723'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בורלא 15-19 תל אביב‎'::text, 'client', u.id, 'crm_deal_id', '35828133'::text)
FROM entities e
JOIN users u ON u.email = 'amita@etzgroup.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35828133'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ז''בוטינסקי 135-137'::text, 'client', u.id, 'crm_deal_id', '35806559'::text)
FROM entities e
JOIN users u ON u.email = 'daniele@danya-cebus.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35806559'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'זכרון יעקוב 16 ת"א'::text, 'client', u.id, 'crm_deal_id', '35629599'::text)
FROM entities e
JOIN users u ON u.email = 'aslam.a.m.tavor@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35629599'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מוסינזון 14-16 ת"א'::text, 'client', u.id, 'crm_deal_id', '35586469'::text)
FROM entities e
JOIN users u ON u.email = 'alexander@ecocity.co.i'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35586469'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ז''בוטינסקי 133'::text, 'client', u.id, 'crm_deal_id', '35541923'::text)
FROM entities e
JOIN users u ON u.email = 'daniele@danya-cebus.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35541923'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בלוך 20 ת"א'::text, 'client', u.id, 'crm_deal_id', '35331525'::text)
FROM entities e
JOIN users u ON u.email = 'norkh2011@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35331525'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'שלומציון 11 רמת גן'::text, 'client', u.id, 'crm_deal_id', '35205189'::text)
FROM entities e
JOIN users u ON u.email = 'guest-04220a1a@noemail.local'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35205189'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מטמון כהן 8-10'::text, 'client', u.id, 'crm_deal_id', '35072553'::text)
FROM entities e
JOIN users u ON u.email = 'bar@phi-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35072553'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בן יהודה 213 תל אביב ‎'::text, 'client', u.id, 'crm_deal_id', '35055669'::text)
FROM entities e
JOIN users u ON u.email = 'guest-04220a1a@noemail.local'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '35055669'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'מקור חיים 64 ת"א'::text, 'client', u.id, 'crm_deal_id', '34718763'::text)
FROM entities e
JOIN users u ON u.email = 'bar@phi-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '34718763'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ארלוזורוב 5-7 בת ים'::text, 'client', u.id, 'crm_deal_id', '34718689'::text)
FROM entities e
JOIN users u ON u.email = 'bar@phi-eng.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '34718689'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בני דן 48'::text, 'client', u.id, 'crm_deal_id', '34325343'::text)
FROM entities e
JOIN users u ON u.email = 'shelli@i-almi.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '34325343'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'הצעת מחיר לפרויקט אסף 17'::text, 'client', u.id, 'crm_deal_id', '33410389'::text)
FROM entities e
JOIN users u ON u.email = 'dorefirozen@gmail.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '33410389'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אלכסנדר ינאי 15-17 ת''''א‎'::text, 'client', u.id, 'crm_deal_id', '33003905'::text)
FROM entities e
JOIN users u ON u.email = 'liad@gnproject.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '33003905'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אוסישקין 74'::text, 'client', u.id, 'crm_deal_id', '32375853'::text)
FROM entities e
JOIN users u ON u.email = 'shalom@brosh.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '32375853'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'ביאליק 34-36 רמת השרון'::text, 'client', u.id, 'crm_deal_id', '32375265'::text)
FROM entities e
JOIN users u ON u.email = 'shalom@brosh.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '32375265'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'דיזינגוף 259'::text, 'client', u.id, 'crm_deal_id', '32248743'::text)
FROM entities e
JOIN users u ON u.email = 'eng@egol.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '32248743'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'כוכבי יצחק 11 תל אביב‎'::text, 'client', u.id, 'crm_deal_id', '30246623'::text)
FROM entities e
JOIN users u ON u.email = 'aviv@ben-shalom.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '30246623'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'אלכסנדר ינאי 15-17 ת''''א‎'::text, 'client', u.id, 'crm_deal_id', '29037951'::text)
FROM entities e
JOIN users u ON u.email = 'liad@gnproject.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '29037951'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'הזהר 7'::text, 'client', u.id, 'crm_deal_id', '29033637'::text)
FROM entities e
JOIN users u ON u.email = 'amita@etzgroup.com'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '29033637'
  );
INSERT INTO entity_records (entity_id, values_json)
SELECT e.id, jsonb_build_object('name', 'בצלאל 3-5'::text, 'client', u.id, 'crm_deal_id', '27743989'::text)
FROM entities e
JOIN users u ON u.email = 'adiel@ecocity.co.il'
WHERE e.entity_key='projects'
  AND NOT EXISTS (
    SELECT 1 FROM entity_records r
    WHERE r.entity_id = e.id AND r.values_json->>'crm_deal_id' = '27743989'
  );

COMMIT;

-- Проверка результата:
SELECT (SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id AND r.name_json->>'ru'='Гость') AS guests,
       (SELECT COUNT(*) FROM entity_records rec JOIN entities e ON e.id=rec.entity_id AND e.entity_key='projects'
        WHERE rec.values_json ? 'crm_deal_id') AS crm_projects;
