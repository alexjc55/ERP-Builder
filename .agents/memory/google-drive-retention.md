---
name: Google Drive retention policy
description: User-approved separation of disconnecting authorization from discarding shared folder configuration.
---

При полном отключении Google Drive пользователь должен выбирать: сохранить
папки для будущего подключения к этому аккаунту или удалить идентификаторы из
ERP. Перед выбором нужно показывать использование папок полями, сущностями,
страницами и записями. Удаление идентификаторов не означает удаление файлов
или папок на самом Google Drive.

**Why:** Пользователь указал, что папки уже привязаны по всей ERP, поэтому
потеря авторизации не должна автоматически уничтожать эти настройки.
Пользователь подтвердил восстановление связи через прежние идентификаторы
папок без переноса файлов.

**How to apply:** Keep authorization lifecycle distinct from folder identity.
Preserve is the safe default; forgetting needs explicit informed confirmation.
Usage counts describe stored references in assigned fields, not physical
folder contents. Never silently substitute the default/new folder when a saved
folder is unavailable. Health-check timestamps are not an OAuth lifecycle
version: a health refresh must not invalidate a pending consent callback.
