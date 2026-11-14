'use strict';
// =====================================================================================================
// iLife — ОБЩИЙ АККАУНТ (2.8.0). Вход по почте и паролю (Firebase, проект money99774), один аккаунт на все мои сайты:
// My Money, iLife, Геометрия Полки, Мое_коровы, My_topsecret, Мое_наклейки. Сам модуль — src/js/mm-account.js.
// В аккаунт уходит тот же снимок данных, что и в файл iLife/ilife_data.json на Google Диске (идеи, дела, кино, песни,
// ДНД, лекарства, дневник, план на день, настройки и — если включено «Ключи тоже на Диск» — ключи), и сливается так же:
// поштучно, удаления — «надгробиями» (gLocalSnapshot, gMerge, gApply, gKey из src/js/gdrive.js).
// Файлы (картинки, музыка, голосовые, песни, фото и видео Мое_совсек) остаются только на Google Диске.
// Аккаунт и Google Диск работают вместе: правка с телефона доходит до ПК и через аккаунт, и через Диск.
// =====================================================================================================
function initAccount() {
    if (!window.MMAccount) return;
    MMAccount.setup({
        app: 'ilife',
        title: 'iLife',
        mount: '#acct-box',
        toast: t => toast(t),
        note: 'Файлы (картинки, музыка, голосовые, песни, фото и видео) остаются на Google Диске — в аккаунт идут записи и настройки.',
        snapshot: {
            get: () => gLocalSnapshot(),
            merge: (local, remote) => gMerge(local, remote),
            apply: merged => gApply(merged),
            key: s => gKey(s)
        },
        onStatus: st => {
            const b = $('#acct-badge');
            if (!b) return;
            const u = MMAccount.user();
            b.textContent = !u ? 'Не выполнен' : st.state === 'error' ? 'Ошибка' : st.state === 'syncing' ? 'Синхронизация…' : 'Вход выполнен';
        }
    });
}
