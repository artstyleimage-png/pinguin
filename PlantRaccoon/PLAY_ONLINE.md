# PLANT RACCOON: играть в браузере после каждого запроса

После каждого изменения игры GitHub Actions сам собирает Unity-проект под WebGL и выкладывает его на
GitHub Pages. Ссылка всегда одна и та же:

**https://artstyleimage-png.github.io/pinguin/plant-raccoon/**

Сборка занимает примерно 15–40 минут (первая дольше). Ход сборки виден во вкладке **Actions**
репозитория (workflow «PLANT RACCOON WebGL»).

## Одноразовая настройка (нужно сделать один раз)

Бесплатная лицензия Unity Personal подходит. Unity требует, чтобы сборка шла под твоим аккаунтом,
поэтому без этих трёх секретов облако собрать игру не сможет.

### 1. Получить файл лицензии `Unity_lic.ulf` (нужен компьютер, один раз)
1. Установи **Unity Hub** и войди в свой Unity-аккаунт.
2. В Unity Hub открой *Preferences (Настройки) > Licenses > Add > Get a free personal license*.
3. Найди появившийся файл:
   - Windows: `C:\ProgramData\Unity\Unity_lic.ulf`
   - macOS: `/Library/Application Support/Unity/Unity_lic.ulf`
   - Linux: `~/.local/share/unity3d/Unity/Unity_lic.ulf`
4. Открой его блокнотом и скопируй **весь** текст.

### 2. Добавить секреты в GitHub
Открой https://github.com/artstyleimage-png/pinguin/settings/secrets/actions и нажми
*New repository secret* три раза:

| Name | Value |
|---|---|
| `UNITY_LICENSE` | весь текст файла `Unity_lic.ulf` |
| `UNITY_EMAIL` | e-mail Unity-аккаунта |
| `UNITY_PASSWORD` | пароль Unity-аккаунта |

Секреты зашифрованы. Их не видно ни в логах, ни мне.

### 3. Запустить первую сборку
*Actions > PLANT RACCOON WebGL > Run workflow*. Можно и просто написать мне следующий запрос: любой
push в `PlantRaccoon/` запускает сборку.

### 4. Включить GitHub Pages (после первой успешной сборки)
Открой https://github.com/artstyleimage-png/pinguin/settings/pages и выбери
*Source: Deploy from a branch*, ветку **gh-pages**, папку **/ (root)**, затем *Save*.
Через минуту-две игра откроется по ссылке выше.

## Управление в браузере
Кликни по игре, чтобы захватить мышь. WASD двигают, мышь крутит камеру, Space прыжок, Shift бег,
R респаун. Esc отпускает мышь.

## Если сборка упала
Пришли мне ссылку на упавший запуск из вкладки Actions (или просто напиши «сборка упала»).
Я прочитаю лог и исправлю.
