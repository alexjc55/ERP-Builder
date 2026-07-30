-- ============================================================
-- Обновление данных: клиенты / проекты / заказы (по файлу orders-rework)
-- Выполнять на проде: psql <DB> -v ON_ERROR_STOP=1 -f prod-data-update.sql
-- Всё в одной транзакции: при любой ошибке изменения откатятся.
-- ============================================================
BEGIN;

-- ===== 1. Пользователи: переименования =====
UPDATE users SET first_name='שמ רונן', updated_at=now() WHERE id=100;
UPDATE users SET first_name='אקו סיטי אס.אל. בע"מ', updated_at=now() WHERE id=61;

-- ===== 2. Новые клиенты (роль Гость, без пароля) =====
INSERT INTO users (email, first_name, last_name, role_id, language, direction, password_hash) VALUES
  ('guest-davidov@noemail.local', 'דוידוב', '', 11, 'he', 'rtl', NULL),
  ('guest-nova-city@noemail.local', 'נובה סיטי', '', 11, 'he', 'rtl', NULL),
  ('guest-lr-lirom@noemail.local', 'ל.ר לירום ביצוע', '', 11, 'he', 'rtl', NULL),
  ('guest-am-majd@noemail.local', 'א.מ. מג''ד לבניין בע"מ', '', 11, 'he', 'rtl', NULL),
  ('guest-oz-yazamut@noemail.local', 'עוז יזמות נדל''''ן בע"מ', '', 11, 'he', 'rtl', NULL),
  ('guest-vinci@noemail.local', 'וינצ''י הנדסה א.ר 2014 בע"מ', '', 11, 'he', 'rtl', NULL);

-- ===== 3. Слияние клиентов-дублей =====
-- אקו סיטי (60) -> אקו סיטי אס.אל. בע"מ (61)
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb(61)), updated_at=now()
  WHERE entity_id IN (72,73) AND values_json->>'client'='60';
-- שמ. רונן עבודות מתכת (101) -> שמ רונן (100)
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb(100)), updated_at=now()
  WHERE entity_id IN (72,73) AND values_json->>'client'='101';
-- пользователь "הירקון 70" (73) -> נובה סיטי
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb((SELECT id FROM users WHERE email='guest-nova-city@noemail.local')::int)), updated_at=now()
  WHERE entity_id IN (72,73) AND values_json->>'client'='73';
UPDATE users SET is_active=false, updated_at=now() WHERE id IN (60,73,101);

-- ===== 4. Слияние проектов-дублей =====
-- merge project 172 -> 173
UPDATE record_links l SET target_record_id=173 WHERE l.target_record_id=172
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=173);
DELETE FROM record_links WHERE target_record_id=172 OR source_record_id=172;
DELETE FROM page_record_values WHERE record_id=172;
DELETE FROM entity_records WHERE id=172;
-- merge project 266 -> 206
UPDATE record_links l SET target_record_id=206 WHERE l.target_record_id=266
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=206);
DELETE FROM record_links WHERE target_record_id=266 OR source_record_id=266;
DELETE FROM page_record_values WHERE record_id=266;
DELETE FROM entity_records WHERE id=266;
-- merge project 237 -> 259
UPDATE record_links l SET target_record_id=259 WHERE l.target_record_id=237
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=259);
DELETE FROM record_links WHERE target_record_id=237 OR source_record_id=237;
DELETE FROM page_record_values WHERE record_id=237;
DELETE FROM entity_records WHERE id=237;
-- merge project 270 -> 177
UPDATE record_links l SET target_record_id=177 WHERE l.target_record_id=270
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=177);
DELETE FROM record_links WHERE target_record_id=270 OR source_record_id=270;
DELETE FROM page_record_values WHERE record_id=270;
DELETE FROM entity_records WHERE id=270;
-- merge project 251 -> 213
UPDATE record_links l SET target_record_id=213 WHERE l.target_record_id=251
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=213);
DELETE FROM record_links WHERE target_record_id=251 OR source_record_id=251;
DELETE FROM page_record_values WHERE record_id=251;
DELETE FROM entity_records WHERE id=251;
-- merge project 257 -> 213
UPDATE record_links l SET target_record_id=213 WHERE l.target_record_id=257
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=213);
DELETE FROM record_links WHERE target_record_id=257 OR source_record_id=257;
DELETE FROM page_record_values WHERE record_id=257;
DELETE FROM entity_records WHERE id=257;
-- merge project 189 -> 211
UPDATE record_links l SET target_record_id=211 WHERE l.target_record_id=189
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=211);
DELETE FROM record_links WHERE target_record_id=189 OR source_record_id=189;
DELETE FROM page_record_values WHERE record_id=189;
DELETE FROM entity_records WHERE id=189;


-- merge project 227 -> 175 (מינץ 16, оба клиента = Эко Сити)
UPDATE record_links l SET target_record_id=175 WHERE l.target_record_id=227
  AND NOT EXISTS (SELECT 1 FROM record_links k WHERE k.relation_id=l.relation_id AND k.source_record_id=l.source_record_id AND k.target_record_id=175);
DELETE FROM record_links WHERE target_record_id=227 OR source_record_id=227;
DELETE FROM page_record_values WHERE record_id=227;
DELETE FROM entity_records WHERE id=227;

-- ===== 5. Клиенты существующих проектов =====
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb(61::int)), updated_at=now() WHERE id=173;                                                        -- בצלאל 3
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb((SELECT id FROM users WHERE email='guest-nova-city@noemail.local')::int)), updated_at=now() WHERE id=206; -- הירקון 70 -> נובה סיטי
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb(100::int)), updated_at=now() WHERE id=213;                                                       -- הלסינקי 15 -> שמ רונן
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb((SELECT id FROM users WHERE email='guest-am-majd@noemail.local')::int)), updated_at=now() WHERE id=192;   -- בלוך 20 ת"א -> א.מ. מג'ד
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb(78::int)), updated_at=now() WHERE id=217;                                                        -- בני דן 48 -> יגאל אלמי
UPDATE entity_records SET values_json=jsonb_set(values_json,'{client}',to_jsonb(78::int)), updated_at=now() WHERE id=212;                                                        -- מוסינזון 18 -> יגאל אלמי
-- изделия проектов Алми: клиент קבוצת אלמי (95) -> יגאל אלמי (78)
UPDATE entity_records r SET values_json=jsonb_set(values_json,'{client}',to_jsonb(78)), updated_at=now()
  WHERE r.entity_id=72 AND r.values_json->>'client'='95'
  AND EXISTS (SELECT 1 FROM record_links l WHERE l.relation_id=24 AND l.source_record_id=r.id AND l.target_record_id IN (177,217,212));

-- ===== 6. Новые проекты =====
INSERT INTO entity_records (entity_id, values_json)
SELECT 73, jsonb_build_object('name', d.name, 'client', d.client_id)
FROM (VALUES
  ('מחסן', (SELECT id FROM users WHERE email='guest-davidov@noemail.local')::int),
  ('טרומפלדור 33', 85::int),
  ('שם רונן הרצליה', 100::int),
  ('פתחיה 23', 51::int),
  ('סמטת המעלות 3', 68::int),
  ('שטרוק 11', 91::int),
  ('ליפסקי 18 חדש', 68::int),
  ('ארלוזורוב 5-7', 91::int),
  ('ליפסקי 18', 68::int),
  ('משה שרת', 103::int),
  ('בית ספר נרקיסים', 99::int),
  ('חדרה 7-9-11', 91::int),
  ('דוד ילין 9', 68::int),
  ('עוזיאל 151', (SELECT id FROM users WHERE email='guest-oz-yazamut@noemail.local')::int),
  ('אסף 17', 59::int),
  ('פייבל 11', 74::int),
  ('פינלס 10', (SELECT id FROM users WHERE email='guest-am-majd@noemail.local')::int),
  ('פראג 3', (SELECT id FROM users WHERE email='guest-lr-lirom@noemail.local')::int),
  ('המרי 27', 61::int),
  ('בילו 4', (SELECT id FROM users WHERE email='guest-vinci@noemail.local')::int),
  ('בצלאל 5', 61::int)
) AS d(name, client_id);

-- ===== 7. Складские заказы: 3446, 3498, 3478, 3481 -> проект מחסן =====
UPDATE record_links SET target_record_id=(SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')
WHERE relation_id=23 AND source_record_id IN
  (SELECT id FROM entity_records WHERE entity_id=74 AND trim(values_json->>'order_number') IN ('3446','3498','3478','3481'));
-- их изделия: клиент -> דוידוב, проект -> מחסן
UPDATE entity_records r SET values_json=jsonb_set(values_json,'{client}',to_jsonb((SELECT id FROM users WHERE email='guest-davidov@noemail.local')::int)), updated_at=now()
WHERE r.entity_id=72 AND EXISTS (
  SELECT 1 FROM record_links l WHERE l.relation_id=25 AND l.source_record_id=r.id
  AND l.target_record_id IN (SELECT id FROM entity_records WHERE entity_id=74 AND trim(values_json->>'order_number') IN ('3446','3498','3478','3481')));
UPDATE record_links SET target_record_id=(SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')
WHERE relation_id=24 AND source_record_id IN (
  SELECT r.id FROM entity_records r WHERE r.entity_id=72 AND EXISTS (
    SELECT 1 FROM record_links l WHERE l.relation_id=25 AND l.source_record_id=r.id
    AND l.target_record_id IN (SELECT id FROM entity_records WHERE entity_id=74 AND trim(values_json->>'order_number') IN ('3446','3498','3478','3481'))));

-- ===== 8. Новые заказы (83) + привязка к проектам =====
WITH data(order_num, project_id) AS (VALUES
  ('1936', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3179', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='טרומפלדור 33')),
  ('3294', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='טרומפלדור 33')),
  ('3319', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מוזיר 6')),
  ('3356', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='רמברנדט 12')),
  ('3370', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='רמז 36')),
  ('3416', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='שם רונן הרצליה')),
  ('3525', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3536', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='הירקון 70')),
  ('3557', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פתחיה 23')),
  ('3565', 198),
  ('3567', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='לואי מרשל 2-4')),
  ('3571', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מרים החשמונאית 28-30')),
  ('3580', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='סמטת המעלות 3')),
  ('3602', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3619', 198),
  ('3620', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מודליאני 4')),
  ('3640', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בצלאל 3')),
  ('3644', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3645', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3660', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3697', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3822', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='שטרוק 11')),
  ('3833', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מוסינזון 18')),
  ('3936', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('3969', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='טרומפלדור 33')),
  ('3983', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='ליפסקי 18 חדש')),
  ('4064', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מחסן')),
  ('4074', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='ארלוזורוב 5-7')),
  ('4075', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='ליפסקי 18')),
  ('4076', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='סמטת המעלות 3')),
  ('4078', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='משה שרת')),
  ('4079', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מרים החשמונאית 22-24')),
  ('4080', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מרים החשמונאית 22-24')),
  ('4081', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מרים החשמונאית 22-24')),
  ('4082', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בית ספר נרקיסים')),
  ('4083', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בית ספר נרקיסים')),
  ('4084', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='סמטת המעלות 3')),
  ('4085', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='חדרה 7-9-11')),
  ('4087', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='אוסישקין 74')),
  ('4088', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='דוד ילין 9')),
  ('4089', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='עוזיאל 151')),
  ('4090', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בית ספר נרקיסים')),
  ('4091', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בצלאל 3')),
  ('4093', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בני דן 48')),
  ('4094', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בני דן 48')),
  ('4095', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='משה שרת')),
  ('4096', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בני דן 48')),
  ('4097', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='אסף 17')),
  ('4098', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בני דן 48')),
  ('4099', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פייבל 11')),
  ('4101', 191),
  ('4102', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='ליפסקי 18')),
  ('4103', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בודנהיימר 43')),
  ('4106', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='רמברנדט 36')),
  ('4107', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פינלס 10')),
  ('4109', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בית ספר נרקיסים')),
  ('4111', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4112', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4113', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4114', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4116', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4117', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4118', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4119', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4120', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4122', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פראג 3')),
  ('4123', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='מוסינזון 18')),
  ('4124', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='המרי 27')),
  ('4125', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='לואי מרשל 2-4')),
  ('4127', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בלוך 14')),
  ('4132', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בילו 4')),
  ('4133', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בצלאל 9')),
  ('4134', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='ליפסקי 18')),
  ('4135', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בית ספר נרקיסים')),
  ('4137', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בלוך 14')),
  ('4138', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בודנהיימר 43')),
  ('4139', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='משה שרת')),
  ('4141', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='משה שרת')),
  ('4142', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בצלאל 29-31')),
  ('4144', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='בצלאל 5')),
  ('4145', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='פייבל 11')),
  ('7905', (SELECT id FROM entity_records WHERE entity_id=73 AND trim(values_json->>'name')='ליפסקי 18'))
), ins AS (
  INSERT INTO entity_records (entity_id, values_json)
  SELECT 74, jsonb_build_object('order_number', order_num) FROM data
  RETURNING id, values_json->>'order_number' AS num
)
INSERT INTO record_links (relation_id, relation_type, source_record_id, target_record_id)
SELECT 23, 'many_to_one', ins.id, d.project_id FROM ins JOIN data d ON d.order_num = ins.num;

-- ===== Контрольные проверки (ошибка = откат) =====
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM entity_records WHERE entity_id=74 AND NOT EXISTS
    (SELECT 1 FROM record_links l WHERE l.relation_id=23 AND l.source_record_id=entity_records.id);
  IF n > 0 THEN RAISE EXCEPTION 'заказов без проекта: %', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT trim(values_json->>'name') FROM entity_records WHERE entity_id=73
    GROUP BY 1 HAVING count(*) > 1 AND trim(values_json->>'name') NOT IN ('חדרה 10','תל חי 9')
  ) t;
  IF n > 0 THEN RAISE EXCEPTION 'осталось дублей проектов: %', n; END IF;
END $$;

COMMIT;
