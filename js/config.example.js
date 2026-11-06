// ОБРАЗЕЦ файла настроек iLife. Нужен только если вы хотите, чтобы Client ID был сразу на всех устройствах.
// Иначе его можно просто вставить в приложении: Настройки → Google Диск → поле «Client ID» (хранится на этом устройстве).
//
// Как пользоваться этим файлом:
//   1) На GitHub откройте папку js → «Add file» → «Create new file».
//   2) Имя файла: config.js   (именно так, маленькими буквами).
//   3) Вставьте текст ниже, впишите свой Client ID и нажмите «Commit changes».
//   Новые версии iLife файл config.js НЕ содержат, поэтому обновления его не затрут.
//
// googleClientId — «OAuth Client ID» типа «Веб-приложение» из Google Cloud → Google Auth Platform → Clients.
//   Выглядит так: '123456789012-abcdefg1234567.apps.googleusercontent.com'. Это не секрет, его можно хранить в публичном репозитории.
//   Тот же Client ID, что у My Money, подойдёт (если оба сайта на одном адресе github.io — ничего добавлять в Google Cloud не нужно).
//
// Правила: значение в одинарных кавычках '...', без пробелов.
window.ILIFE_CONFIG = {
    googleClientId: 'ВСТАВЬТЕ_СЮДА_CLIENT_ID.apps.googleusercontent.com'
};
