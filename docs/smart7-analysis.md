# Smart7 BT device protocol and Android APK analysis

Scope is the HARIO V60 Auto Pour Over Smart7 BT (EVS-70SV-BT) and Android app `com.hario.smart7.myapplication` version 1.0.6 (version code 8). The analyzed APK has SHA-256 `c194ff22ed7ff096319dabbf714bf1ac0b4de4d922f6925ae81df44d6ea781fd`. Static inspection covered the Android manifest, Java/Dex call paths, and the bundled `libhy_api.so` frame encoder. [EVS-70SV-BT manual](../public/EVS-70SV-BT-manual.pdf) · [HARIO product features](https://smart7.jp/features_kr.html)

## Where the official app used the network

| Feature | Observed in Android 1.0.6 | Current web app |
| --- | --- | --- |
| Pairing and reconnect | `ScanDevicePage`, `BTService`, `PasswordPage`, and `AutoConnectProcess` use local BLE. The device returns the PIN | Browser device picker, on-device PIN check, and optional reconnection to a device already granted to the site |
| Auto Mode and My Recipes | `AutoModePage_Bx` and `ShowAutoDetailPage_B5` read recipe data locally. The water-preparation and heating screens lead to BLE writes | Built-in automatic profiles, local recipe editing and graphs, and direct BLE brewing |
| Maintenance and progress | BLE notifications drive brew progress, busy and overheat alerts, draining, and cleaning. The app also uses timers for the soak and rinse stages | The web client handles these states and supports reading and setting flow calibration |
| Account and profile | Login, registration, token, and profile WebViews use Smart7.jp | Account-free local operation. Posting to the new community uses GitHub sign-in |
| Original shared recipes | The app fetches the remote list and recipe detail. Upload, image upload, and editing use the HARIO service | The app reads new community issues and archived entries through the [community API](api.md). A recipe copied to My Recipes can be brewed locally |
| Storage | SQLite database `CoreDataModel` has recipe, step, and device tables. Recipe records refer to images by filename | Browser storage keeps recipes, order, photos, language, device aliases, and optional remembered PINs. Export and import use recipe JSON |

The official Android app exposed a guest path. The pairing and brewing call chains under that path have no required HTTP response before the device starts heating. On the original sharing path, `URLConstants` points to `smart7.jp`, and the client refers to `login.php`, `member.php`, `token.php`, `recipes.php`, `recipe_detail.php`, `upload.php`, and `image.php`. HARIO announced the end of app distribution. Those endpoint names are historical observations from the APK, and their present availability varies from the status of the public web pages. [HARIO distribution notice](https://smart7.jp/recipe_top.html)

The web app retains a separate public GitHub catalog. When the service worker has cached the application shell, the browser can reopen it and use saved local recipes without an internet connection. Fetching the community catalog and its comments needs internet access. Native app backups and HARIO accounts have no migration path in the current web app. [Service worker](../public/sw.js) · [Browser application](../public/app.js)

## BLE connection and PIN

| Role | GATT UUID |
| --- | --- |
| Primary service | `00001000-0000-1000-8000-00805f9b34fb` |
| Command write | `00001001-0000-1000-8000-00805f9b34fb` |
| Notifications | `00001002-0000-1000-8000-00805f9b34fb` |

1. The web app checks for a secure context and `navigator.bluetooth.requestDevice`. It requests the service as optional in the browser picker and checks the selected name for `EVS-70` with optional separators. The new connection waits 1.5 seconds after selection before opening GATT.
2. Connect, discover the service and characteristics, subscribe to notifications, then wait 500 ms and send command `9`. This follows the connection path in `ScanDevicePage` and `BTService.onServicesDiscovered`.
3. Notification `7` supplies six PIN digits in the low nibbles of its first six bytes. When the web app needs user input, it waits 200 ms and sends command `16` to display the PIN. It compares the user's input with the device-supplied digits and sends `15` to confirm or `17` on cancellation. When an optionally remembered PIN matches, the app sends `15` directly.
4. The web app repeats command `9` after four seconds without a PIN. After 12 seconds, it can reconnect to the same granted device without reopening the picker. The attempt is capped at three GATT connections. This is a web compatibility measure. A user reported successful pairing on their third manual attempt before the retry behavior was added.
5. Device heartbeat `8` gets command `18` after 50 ms. Writes are serialized. The client chooses write without response when the characteristic supports it and falls back to write with response.

## Framing

Values below are bytes unless indicated. Opcode numbers in the tables are decimal.

```text
inner = 99H | command | payload_length | payload | checksum
checksum = (command + payload_length + sum(payload)) mod 256

wire = 54H | ((len(inner) + 1) XOR 54H) | (key XOR 54H) | (inner XOR key)
```

The Android BLE library wraps the inner command using the native encoder. The web app reproduces the wrapper with a random one-byte key, keeps partial notifications until the next chunk, and validates each inner frame. It accepts device PIN and heartbeat frames (`7` and `8`) even when their checksums differ. [Encoder and receive path](../public/protocol.js)

## Brewing and maintenance commands

| Command | Payload | Meaning in the web client |
| --- | --- | --- |
| `3` | `[2]` | Leave or acknowledge drain mode, including preparation before a brew |
| `5` | Empty | Reset recipe steps before sending a new program |
| `1` | `[index, mL / 10, pourSeconds, waitSeconds]` | Upload an individual step, starting at index 1 |
| `10` | `[temperatureC]` | Set the brew temperature |
| `2` | `[1]`, `[2]`, or `[3]` | Start or resume, pause, or stop |
| `3` | `[1]` | Start draining |
| `4` | Empty | Request device status before cleaning |
| `13` | `[1]` or `[0]` | Start cleaning or rinsing in the current workflow, or stop it |
| `11` | `[level]` | Set the flow adjustment to a value from 1 to 9 |
| `12` | `[0]` | Read the flow adjustment |

A brew sends `5`, one `1` per step spaced 200 ms apart, `10` after 100 ms, and `2 [1]` after another 100 ms. Auto Mode and user recipes share this send path.

| Notification | What the web app does |
| --- | --- |
| `2 [2, 1, temperature, …]` | Updates temperature while heating |
| `2 [2, 2, minutes, seconds]` | Shows brew time remaining after heating. If received during initial preparation, it indicates the device is already busy |
| `2 [1, 1, 0, 0]` | Opens the completion summary following heating or brewing |
| `2 [1, 0, …]` | Resets the connection when the device returns to its start screen during an operation |
| `3 [error]` | Handles sensor, insufficient water, hot-water, rejected recipe, and rejected command errors. Hot-water error `3` while starting opens the overheat prompt |
| `2 [3, 1, …]` | Acknowledges drain completion while draining |
| `2 [4, 1, temperature, …]` | Updates temperature during cleaning or rinsing |
| `2 [4, 2, …]` | Moves cleaning to the five-minute soak when the third byte is below 5. In rinse mode, starts the 45-second completion timer |
| `6 [level, …]` | Updates the reported flow adjustment when it is in range |

Busy detection depends on the operation and on the mode and step sent by the device. It can interrupt an in-progress upload, show a prompt, and wait for the user to acknowledge it. The user starts the rinse separately after the soak. Rinse completion is timer-driven after a progress notification. [State handling](../public/protocol.js)

## Verification and limits

- The [protocol tests](../test/protocol.test.js) cover native-derived frame fixtures, split notifications, mock pairing and brewing without HTTP, retries, error handling, completion, and maintenance. The test brewer is a simulated GATT device.
- The physical pairing report covers EVS-70 selection on Android Chrome. Firmware and regional variants, brewing, and maintenance were not all verified on physical hardware.
- The eight [automatic step schedules](../public/recipes.js) match the corresponding normal and fast row definitions in Android's `AutoRecipeItem`. The choices are 270, 410, 530, or 660 mL and 90, 93, or 96 °C. The 270 mL fast sequence also appears in an independent review of the brewer. `MyRecipeItem.init` seeds a single local recipe, `default A`, at 93 °C and 18 g with the 270 mL normal schedule. [HARIO operating guide](https://smart7.jp/pdf/EVS-70_sousa_L.pdf) · [Smart7 BT field review](https://coffee-pharmacist.com/hario-smart7)
